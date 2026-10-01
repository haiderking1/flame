# Performance baseline and regression checks

## Reproduce

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run benchmark /tmp/flame-performance.json
```

Use Bun 1.4.2. The benchmark uses a production profiling build, three fresh Electron processes with isolated home/profile directories, and a separate real-renderer interaction fixture. It restores the ordinary production renderer afterward. The fixture uses local repositories and deterministic provider responses, not an account or network inference.

Baseline: September 30, 2026, Linux x86_64, Ryzen 5 5600X, 12 logical CPUs, 14.21 GiB RAM. Electron 44.5.0, Chromium 152.0.7977.130, embedded Node 24.21.0; standalone engine measurements use host Node 26.8.2. Headless Electron uses a 1800 × 1100 emulated device, with the app's default 1.728 zoom, giving a 1041 × 636 CSS viewport. These numbers are a baseline for this machine, not a cross-device guarantee.

## Latest verified run

`/tmp/flame-performance.json`, measured at `2026-09-30T10:35:43.343Z`:

| Measurement | Result | Regression threshold |
| --- | ---: | ---: |
| Fresh-process first usable interaction, three trials | 637 / 634 / 631 ms | Each < 2500 ms |
| First optional panel and readable large-file preview | 556 ms | < 4000 ms |
| Mixed input-to-next-frame p95 | 37.6 ms | < 50 ms |
| Synchronous timeline commit boundary p95 | 3.6 ms | < 20 ms |
| Two-frame history scroll response p95 | 32.8 ms | < 75 ms |
| Saved-history DOM elements | 107 | < 1500 |
| Visible history with a highlighted 128-line code block | 1474 | < 1500 |
| Large-file shadow DOM elements | 205 | < 15,000 |
| Renderer JS heap after idle release and explicit GC | 17.06 MiB | < 96 MiB |
| Draft writes during 30 consecutive input updates | 1 | Exactly 1 |
| Visible history anchor drift during streaming | 0 px | < 8 px |

The input probe uses trusted Chromium text insertion/deletion and registers its frame callback before input. It includes composer, file filtering, model filtering, and folder-path interactions. Synthetic value setters are not a substitute for native input scheduling.

The mixed-input p95 is not a maximum-latency promise. One folder-filter transition took about 180 ms in this run. Long-animation-frame reporting recorded that frame with zero script blocking; no >50 ms main-thread long tasks were observed during the scenario. Startup also produced two long animation frames without script blocking. The report keeps frame timing, script attribution, and event-to-frame phases so rendering/scheduling tails are visible rather than concealed by a fast typing average. Folder filtering is memoized and automatic scrolling is tied to rendered results, not every urgent keystroke.

React `actualDuration` is recorded separately as render cost. Commit timing runs from React's `commitTime` to an end-of-task microtask, conservatively including synchronous layout effects. It is not GPU presentation time or a private React commit hook. Profiling asserts that a streamed response updates changed/newly exposed rows, not the whole saved history.

The integrated workload includes 300 saved messages, history prepends and flow-to-windowed transitions, selected text, a Rust fence growing in eight chunks, 180 file-tool calls plus 60 commentary messages, expanded tool output, 200 model choices, 220 folders, rapid file switches, complete-source copying, and short panel open/close cycles. A 40,000-line source exercises the explicit plain-rendering policy and end-of-file navigation. Existing paragraph/closed-fence streaming is unchanged; this does not benchmark an incremental tokenizer.

## Highlighting measurements and policy

Each language gets a cold highlighter request followed by 20 warm tokenizations. Lower-level WASM initialization is shared within the process, so later language trials do not represent a fresh OS process. Warm numbers measure tokenization, not cache lookup.

| Sample | Source bytes | Cold request | Warm median |
| --- | ---: | ---: | ---: |
| Rust | 3240 | 59.0 ms | 2.40 ms |
| TSX | 4360 | 76.1 ms | 6.92 ms |
| JSON | 3240 | 4.48 ms | 1.54 ms |
| Shell | 3200 | 11.3 ms | 3.82 ms |

Warm median must stay below 25 ms for every sample. Pathological TSX lines in repeated runs cost roughly 35–45 ms at 1000 characters, 136–166 ms at 2000, and 13–16 seconds at 20,000. This is why both chat and file tokenization use a 1000-character line limit and why chat highlighting also runs in a worker.

Chat falls back to complete plain text above 128 Ki UTF-16 code units, 5000 lines, any over-limit line, or 16,000 returned tokens. It loads languages on demand and stops admitting additional loads once 64 loaded/pending language registrations are present; an admitted grammar can bring embedded dependencies. File/diff review uses plain rendering above 15,000 logical lines or 512 Ki UTF-16 code units per side. These are coloring limits, not display/copy truncation. Backend text previews separately reject files above 4 MiB per side; binary/non-UTF-8 source has an explicit fallback.

Parsing a 12,000-line addition took 25.4 ms in the standalone test, with an estimated 1.27 MiB result. In-app parsing is off the renderer thread. Worker round-trip records include startup, queueing, tokenization, and message transfer, not just CPU execution: initialization was about 72 ms initially and 49 ms after deliberate failure/retry; sampled small diff jobs took 6–11 ms, large parses about 35–104 ms, and the first completed chat fence about 61 ms. First readable preview timing does not wait for all background coloring.

## Resource budgets and tradeoffs

- Chat tokens: at most 128 completed entries and an estimated 4 MiB, including keys and token/string overhead. Failed results are not cached. Cache identity includes theme, pipeline format, language, and source, without delimiter ambiguity.
- File/diff ASTs: 12 entries per cache, sharing an estimated 16 MiB across both caches. Replacement, invalidation, and oversized results update the same budget.
- Parsed diffs: 16 entries / estimated 8 MiB, including filename, original filename, scope, and source identity.
- File highlighting: one worker on low/unknown resources, at most two when CPU and reported memory permit. Chat highlighting and diff parsing each have a separate supervised worker.
- Worker requests have bounded concurrency and deadlines. Short panel closures reuse the pool; unused workers release after 30 seconds. Rejected initialization promises are cleared by tracked dependency patches, with real failed-WASM retry coverage.
- Large lists use measured windowing; small lists stay in normal flow. Focus and selected ranges can intentionally retain additional rows. Tool disclosure state belongs to the session, not a transient virtual row.
- Draft persistence delays serialization and storage writes by 400 ms; accepted-message/submission identities bypass debounce. Navigation, pagehide/hidden visibility, explicit retry, and unload guards protect that durability window.

Byte accounting is conservative, not an exact V8 allocation measurement. Oversized color results bypass caches instead of evicting useful entries just to retain a single giant result. Coloring caps avoid predicting an AST's size only after it has already been allocated and transferred.

Renderer process working set was about 362 MiB before idle cleanup and 200 MiB afterward, with a 456 MiB peak. This includes native allocations and worker isolates; it is not the 17 MiB renderer JS heap. The report also records browser, GPU, and utility process memory. Individual worker heaps are not queried through attached CDP sessions because that instrumentation can interfere with worker lifecycle. Process snapshots, worker lifecycle assertions, wall-clock requests, and separate engine measurements are used instead.

Regression checks reject missing profiling/worker evidence as well as budget overruns. Unit tests exercise the thresholds; production tests cover stale replies, runtime/message errors, real engine initialization failure and retry, cache invalidation, and source preservation.

## Dependency baseline

The registry/release audit selected Electron 44.5.0, Vite 8.3.1, TypeScript 7.0.2, React 19.3.0, and Shiki 4.4.3, with `@pierre/diffs` 1.5.1 and TanStack React Virtual 3.14.13. Bun 1.4.2 was downloaded and checksum-verified for validation; the host's existing Bun 1.4.0 installation was not replaced.

Effect remains on the existing compatible `4.0.0-rc.115` family. The `rc.118` upgrade was evaluated and reverted because it changed APIs used by the backend, including the HTTP modules. This is a checked and tested compatibility baseline, not a claim that every dependency is on its latest prerelease. A framework API migration is separate work.
