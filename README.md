# Flame

An Electron coding workspace with project-owned SQLite sessions, direct Codex conversations, file tools, managed Bash jobs, and background Git actions.

## Requirements

- Bun 1.4.2
- Node.js 22.12+ on a release supported by Vite (Node 24+ recommended)
- A graphical desktop session to launch the app; interaction tests and benchmarks use headless Electron

## Run

```sh
bun install
bun run dev
```

`dev` builds the Electron main process and opens the window against a local Vite server. CSS updates apply without a page reload, React Fast Refresh preserves component state for compatible edits, and HTML edits reload the page automatically. Closing the app or pressing Ctrl+C also stops the dev server.

Changes under `src/main/`, `src/backend/`, or `src/contracts/` require restarting `bun run dev`. Only the renderer supports hot reload.

Use `bun run start` to build and launch without the dev server.

## Check

```sh
bun run typecheck
bun run test
```

CI runs both on every push to main and every pull request, split across four runners; each runner still runs its tests one at a time, because the Electron UI tests time real windows. CI also packages Linux x64's AppImage and smoke-tests it. It builds the installers for every platform (see Packaging and releases) when a change touches packaging: `package.json`, `bun.lock`, `patches/`, `resources/`, `scripts/desktop/`, `src/main/` or `.github/`. Run CI manually to build them all for any commit.

The tests use real Electron renderers, check isolation, and exercise composer typing, resizing, keyboard behavior, IME handling, Git lifecycle, diff workers, virtual history and nested tool lists, search, and draft durability. Failure tests cover interrupted Git claims, storage failures, worker recovery, and actual failed WASM initialization. Development tests verify CSS updates, React Fast Refresh with draft preservation, HTML reloads, and submission success/failure with a test-only callback. The debugging pipe is enabled only by the tests.

## Packaging and releases

```sh
bun run dist:desktop                      # installers for this OS into release/
bun run dist:desktop -- --target AppImage # only some formats
bun run smoke:desktop                     # check the packaged app
```

electron-builder packages Flame per OS: Linux gets an AppImage and a .deb, macOS a .dmg and a .zip, Windows an NSIS installer. Each OS builds its own installers, because Flame's native dependencies (the file search library and its FFI binding) are installed per platform; they ship unpacked beside `app.asar`. On Arch, the .deb needs `libxcrypt-compat` for electron-builder's bundled packager. Local builds are unsigned; `--signed` uses the `CSC_*` and `APPLE_API_*` variables that electron-builder reads. `smoke:desktop` runs a copy of the unpacked app outside the repository and checks file search, the image worker and SQLite from inside the archive, that the window reaches its backend, and on Linux that the AppImage adds Flame to the app launcher with its icon.

package.json's version is the next stable release. The Release workflow publishes to GitHub Releases:

- **Stable**: push a tag `vX.Y.Z` matching package.json; bump package.json afterwards.
- **Nightly**: every day when `main` changed, or on demand, as `X.Y.Z-nightly.YYYYMMDD.N`. A nightly installs beside the stable app as Flame (Nightly).
- **Preview**: on demand, as `X.Y.Z-preview.<run>`; it never offers itself as an update.

Each release builds Linux, macOS and Windows for x64 and arm64 while the tests run, smoke-checks the Linux builds, publishes only once both pass, and merges the per-architecture update manifests. Signing and notarization run when the repository has the `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` secrets; without them the installers are unsigned, and macOS cannot install updates.

Installed builds check for updates 15 seconds after starting and every 4 minutes. Downloading and installing wait for you: the sidebar shows an update button while an update is available, downloading, ready or failed, and **Settings → About** shows the version, the update button and the update track (Stable or Nightly). **Help → Check for Updates…** (the Flame menu on macOS) checks at once. Installing asks first, stops the backend and restarts Flame on the new version. On Linux, updates work for the AppImage and the .deb; the AppImage adds itself to the app launcher with its icon so Wayland bars show it. Set `FLAME_DISABLE_AUTO_UPDATE=1` to turn updates off.

## OpenAI sign-in

Open **Settings → Providers**, where OpenAI has two rows: **ChatGPT** (official) and **Codex** (legacy). **Sign in** on either row opens your default browser; you can cancel from Flame. Once connected, that row's status dot turns green, it shows the account, and its toggle signs out. Flame holds one OpenAI sign-in at a time; signing in on the other row replaces it.

- **Sign in with ChatGPT** is OpenAI's sign-in for apps that use a ChatGPT plan. The first sign-in registers Flame for your account and workspace; ChatGPT then lists Flame under **Settings → Usage**, where you can limit how much of your plan it may use. Flame verifies the ID token against OpenAI's published keys, requires the plan-usage permission, and sends responses and model requests to the public API (`api.openai.com/v1`). Its loopback callback takes any free port on `127.0.0.1`. Signing in again after the session expires reuses the registration; after signing out, the next sign-in registers anew. Flame keeps a random installation ID, which OpenAI ties registrations to, across sign-outs.
- **Legacy Codex sign-in** uses the Codex CLI's registration and ChatGPT's Codex backend, as before. Its loopback callback uses port 1455; another Codex sign-in must not be using that port.

Credentials are stored in `~/.flame/agent/auth.json`. On Unix, Flame restricts the directories to `0700` and the file to `0600`, rejects symlinks and unexpected ownership, and replaces the file atomically. This is plaintext credential storage, protected by filesystem permissions, not encryption. Never share or commit this file. Sign-out removes Flame's saved credentials; it does not revoke sessions on OpenAI's website.

The backend restores saved account state without a loading screen and refreshes expiring tokens in the background. It keeps credentials out of renderer RPC responses. Models and supported thinking levels/service tiers are discovered from OpenAI and cached locally. Codex inference and the tool loop run directly in Flame's backend.

## Codex usage

With **Sign in with ChatGPT**, only ChatGPT shows how much of the plan Flame has used: **Settings → Usage** links to ChatGPT's usage settings, and a response that hits the plan's limit says so. The rest of this section applies to the legacy Codex sign-in.

**Settings → Usage** shows weekly usage, reset time, and available banked resets. Account-scoped snapshots are cached in SQLite, refreshed in the background while viewed, and retained if a read fails. Missing provider data is shown as unavailable, not zero.

**Use a banked reset** opens a Yes/No confirmation with No focused. Only Yes submits the selected credit. Submission is recorded durably before the single network attempt; double-clicks, reconnects, and application restarts cannot replay it. A lost response or interrupted submission leaves an unknown outcome and blocks further spending from Flame. Check ChatGPT usage instead of trying another reset. Reading or refreshing usage never spends credits.

## Sessions

Each project owns multiple sessions. Each session has its **own SQLite database**, not a shared transcript table:

```text
<Electron userData>/data/projects/<project-id>/sessions/<session-id>/session.sqlite
```

On Linux, the base is normally `~/.config/flame/data/projects/`. Stable project IDs keep storage independent of display names and working-directory names. Session data is outside the project's source tree. SQLite may create adjacent WAL/SHM files; close Flame before copying a session directory for backup.

Use **New thread** to choose a project and create a session. The sidebar searches session titles/project names and respects the project filter. Opening a session restores its history, draft, and model/thinking/service-tier settings. The last open session resumes after a restart. Account model defaults seed new sessions; changing an existing session does not change other sessions or those defaults.

Entries are immutable and parent-linked, with a persisted active tip and paginated history. Message/settings snapshots, draft clearing, title updates, and revision increments commit transactionally. Stale writes are rejected; retried message submissions use stable request IDs instead of appending duplicates. Committed changes use WAL with `synchronous=FULL`. Branch navigation is not implemented yet. Compaction checkpoints preserve the full transcript while reducing the conversation sent to the model.

Use **Settle** on a thread's hover controls or context menu to move it into the **Settled** section. Its header stays visible even at zero; expanded settled rows are compact. **Unsettle** restores a thread to the active list. Settlement is stored in the session database and survives restarts; it never deletes history or drafts. Opening or editing a draft does not reactivate the thread, but sending a new message does. Running turns and claimed/running Bash jobs block settlement; if a pending background completion starts a continuation later, that thread becomes active again. Search includes settled threads and expands matching results. There is no inactivity timer or automatic settling.

Session cards show the project, title, relative update time, and provider icon. Right-click a card or open its options menu to rename inline or delete with confirmation (Cancel is focused by default). F2 also starts renaming; Enter saves and Escape cancels. These actions work on unopened sessions without replacing the current draft. Deletion durably marks the session deleted, then moves the entire directory into that project's `sessions/.trash/` folder. Interrupted deletions finish on startup; delayed requests cannot recreate or append to deleted sessions. Trash retains the database for manual recovery; there is no restore UI yet. No project source files are deleted.

Session discovery is rebuilt from the individual databases on backend startup. Unsupported versions, unsafe paths, and unreadable databases produce warnings instead of being replaced. On Unix, session directories are private (`0700`) and databases are private (`0600`); symlinks, hard-linked database files, and unexpected ownership are rejected. History/drafts are plaintext, not encrypted, and may contain sensitive user-provided content. Credentials are never copied into session settings.

## Subagents

A thread's agent can lead a team of subagents with the collaboration tools Codex uses: `spawn_agent` starts an agent on a task, `send_message` passes a running agent a note, `followup_task` gives an agent a new task (starting a run if it is idle), `wait_agent` waits for news (30 seconds by default, 10 seconds to an hour), `interrupt_agent` stops an agent's run, and `list_agents` lists the team. Agents are named by path from `/root`, the thread's own agent, as in `/root/review_api`, and get a scientist's nickname. Subagents have the same tools, including starting their own agents.

- **When it delegates:** only when you, or AGENTS.md or other instructions, ask for subagents, delegation or parallel agent work. At **Ultra** reasoning effort it delegates on its own whenever that saves time or improves quality.
- **What an agent knows:** the conversation so far (your messages and the final answers, never reasoning or tool records), unless `fork_turns` shares none or only the latest turns, plus its task. It uses its parent's model and effort unless the model asks for another one in the catalog.
- **Where it works:** in the thread's folder, alongside every other agent; agents are told to own separate files and not to undo each other's edits. Nothing locks files.
- **Limits:** four agents of a thread work at once, the thread's own included; starting or restarting another fails until one finishes. Subagents do not count toward the four responses threads may run at once.
- **Results:** an agent's final answer, or why it failed, is mailed to the agent that gave it the task, and read at that agent's next step or when `wait_agent` returns. Mail does not wake an idle thread agent; it is read with your next message.

In the chat, a run's agents show as one row, "Kicked off 2 subagents" while any works and "Ran 2 subagents" after, opening to each agent and its task. The **Agents** button (beside the diff toggle, with how many are working) opens the Agents panel: each agent's status, name and role, elapsed time, latest activity or answer, model, effort and tokens. Choose an agent to read its whole transcript. While agents work after the thread's agent has finished, the sidebar shows the thread as **Working**, and a banner above the composer offers **View** and **Stop**. Stopping the thread's agent stops its team too.

Each agent is a session of its own, stored like a thread but never listed as one, with a mailbox for messages from its team; agents survive restarts and keep their history. Deleting a thread deletes its agents.

## Composer

Create or open a session before typing. The composer grows up to a capped height, then scrolls. Shift+Enter inserts a newline. With a model selected, Enter sends the session's active-branch conversation to Codex using its saved thinking level and service tier. Without a model, the button explicitly saves a local message only.

### Responses

Flame makes authenticated Responses API requests directly from its backend, not through a CLI. The provider transport streams internally, but the UI receives **finished paragraphs, list items, and closed code fences**, paced at 400 ms, rather than token-by-token text. The remaining text appears on completion. Answers and progress messages render Markdown, including headings, nested lists, task lists, tables, quotes, links, and fenced code with copy/wrap controls. Syntax highlighting runs lazily in a shared worker with bounded caching and a readable plain-text fallback. Raw HTML stays inert; image sources are explicit links rather than automatic network requests. Only HTTP(S) links can open in the system browser. The model can invoke Read, Edit, Write, and Bash to inspect or change the selected project. Tools run directly in YOLO mode, without approval prompts.

The composer send button becomes **Stop response** while a turn runs; typing the next message remains available. Stop cancels the request and preserves partial output with a stopped status. Responses continue across renderer reloads and session switches. App shutdown interrupts them; on restart, durable checkpoints are recovered without replaying the request. A durable per-session turn claim precedes the provider POST, and repeated submission IDs cannot start another request. One turn may run per session, with at most four active turns in the backend. Model changes and session deletion are blocked while its response runs.

Completed assistant messages, provider reasoning context, and terminal state commit atomically. Opaque reasoning is backend-only and reused only for the same account and model. Account changes abort active requests. Errors are sanitized and never consume banked resets. A recognized context-window overflow permits one compaction and retry per turn; other failures are not automatically retried. If storage fails, Flame reports it rather than claiming the response was saved. Older session databases migrate through transactional migrations to version 9, preserving entry IDs, history, drafts, and settings.

Provider HTTP requests have a ten-minute deadline and a 90-second read-idle limit. These limits do not apply to Bash commands. Assistant text is limited to 1 MiB and ordinary provider response/text input to 8 MiB. Image input has a separate 64 MiB payload budget. Durable full-turn output has a 256 MiB bound. Conversation history can exceed one request; compaction reduces the active projection before submission. If the latest indivisible message or tool exchange cannot fit, Flame reports the failure and preserves history.

Session drafts autosave after 400 ms and flush before switching sessions. Pre-session project drafts also delay serialization and persistence by 400 ms, flushing on navigation, hidden visibility, and pagehide. Submission IDs and accepted-message markers remain immediately durable. Failed saves keep local text, display an error, and prevent navigation from silently losing it. Reloading saved state preserves unsaved text so conflicts can be resolved explicitly. Normal unload is blocked while a draft/write is pending; after saving, retry closing/reloading. Forced termination can still lose keystrokes that have not reached SQLite. Each draft/message is limited to 48 KiB after JSON encoding to fit the authenticated RPC transport.

### Conversation compaction

Flame automatically compacts at **90% of the selected model’s context window**, before a request or between complete tool exchanges. The composer shows estimated usage and the threshold; validated provider usage supersedes text estimates, including cached input and reasoning tokens. Model catalog context-window metadata determines the limit, with a conservative 128,000-token fallback for older catalogs.

Type `/` in the composer to browse slash commands. Typing `/com` filters to **`/compact`**: **Enter runs the selected command immediately**, **Tab completes its text**, arrow keys change the selection, and Escape dismisses the list. You can also click a command to run it. The context circle is display-only; its tooltip includes the automatic threshold. Use **`/compact`** to summarize earlier conversation manually. Compaction uses the selected model without tools, produces a structured checkpoint, and preserves recent conversation with intact tool-call/result groups. Long histories are summarized in bounded chunks. Previous summaries, goals, approvals, progress, unresolved work, exact paths, and file operations inform each checkpoint. Fresh operation ledgers remain available independently.

Summaries are lossy: expand a checkpoint marker to inspect it. Full messages and tool records remain in SQLite and the history UI. Checkpoints survive restart; account/model switches remove incompatible opaque reasoning. Manual compaction consumes only the accepted command text, preserves pending attachments and any draft typed afterward, and creates no assistant message. Unavailable or rejected commands remain editable and are never sent as chat messages. Slash-prefixed paths such as `/tmp/project.txt` remain ordinary messages. Stop cancels compaction. Failed summaries or storage writes preserve the previous context; interrupted partial-turn checkpoints fall back safely without replaying tools.

The approach follows [Pi’s compaction implementation](https://github.com/earendil-works/pi/tree/6a4af07d6145c88dad4e3472acebe75cc57af88f), adapted to Flame’s transactional SQLite storage and turn lifecycle.

### Project instructions

Flame loads global instructions from `~/.flame/agent`, followed by the selected project's direct ancestor chain from filesystem root down to the project directory. Each directory selects the first readable regular file among `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, and `CLAUDE.MD`. Symlinked files are supported; read failures warn and allow the next candidate. Nested linked worktrees avoid loading the main checkout's shadowed, same-named context file twice.

Discovery does not walk child directories, sibling repositories, or dependency trees. Nested instructions can be read with normal tools, but are not automatically loaded based on tool targets. The context is loaded once at the start of each agent run and stays unchanged throughout its tool follow-ups. No tool pauses or instruction-review gates are added. This is instruction handling, **not filesystem isolation**. See [`src/backend/project-context/README.md`](src/backend/project-context/README.md).

### Image attachments

Paste, drop, or choose PNG/JPEG/WebP/GIF images with the composer's paperclip. Plain removable square thumbnails persist with the draft. Failed background uploads are retried when you press Send. Uploading starts when you attach; Send reuses ready images and waits only for unfinished uploads. Image-only messages work too. Clicking a draft or saved image opens the full-size viewer with zoom/pan, previous/next controls, Escape/background close, and focus restoration. Composer thumbnails are cached 256px center crops, separate from full-size originals.

Originals and model-prepared images live in private session-owned storage. The backend validates and prepares images with Photon in worker threads, then sends real Codex image input alongside text. Images fit within 2000×2000 and a 4.5 MiB base64 payload; uploads are limited to 20 MiB/40 megapixels and ten images per message. Saved history exposes metadata rather than provider payloads, and reload never resends accepted messages. Stop and failed uploads retain truthful outcomes. See [`src/backend/images/README.md`](src/backend/images/README.md) for lifecycle and limits.

### File tools

Every agent request includes the session's project directory in a `<cwd>` system-prompt section, including tool follow-ups and background continuations. It uses the same project-path lookup as the tools, not the backend process's working directory.

- **List (`ls`)** lists one directory, non-recursively: sorted names, dotfiles, and `/` for directories. Defaults to 500 entries with a 50 KiB listing bound and explicit truncation notices. The model is instructed to prefer it over recursive `find` for directory discovery.
- **Read** inspects UTF-8 text with line ranges, bounded output, a continuation offset, and a raw-content SHA-256. PNG/JPEG/WebP/GIF files return actual visual tool input, with a saved image preview and full-size viewer. Image snapshots survive source-file changes/deletion and reload; line ranges apply only to text.
- **Edit** applies unique, non-overlapping exact replacements against the original file. All replacements validate before any target bytes change; BOM and uniform CRLF are preserved.
- **Write** creates files and parent directories or atomically replaces a whole file. Replacing an existing file requires the hash from Read, preventing overwrites of an observed newer version.

Mutations are serialized per canonical path across sessions and use same-directory atomic replacement with fsync. Symlinks are preserved; multiply hard-linked files and special files are rejected. Text files are limited to 16 MiB, text read output to 2000 lines / 64 KiB, and encoded tool arguments to 1 MiB. Image reads use the same 20 MiB/40 megapixel processing limits as attachments. Unsupported binary/non-UTF-8 files receive explicit errors rather than lossy conversion. There are 1024 saved file operations per session.

Operation claims and results are durable. Interrupted operations are never automatically replayed; saved results remain inspectable in expandable tool rows after reload. Stop does not claim a completed replacement was undone. Like Bash, these tools are **not a sandbox**. External writers still have a narrow check-to-rename race, and atomic replacement does not preserve extended filesystem metadata such as ACLs/xattrs. See [`src/backend/file-tools/README.md`](src/backend/file-tools/README.md) for guarantees and limits.

### Bash jobs

The model can run foreground commands or managed background jobs. There are **no command timeouts and no automatic command reruns**. Commands execute in a fresh shell rooted at the selected project; shell directory changes do not persist between calls. Background completion is saved and delivered to the model without polling, including waking an idle session. Progress messages stay readable in the conversation, with consecutive tool calls shown as quiet rows between them. Each row expands directly to its details with one click, without an outer group dropdown or duplicated command label. Only tool output scrolls inside a bounded area; narration is never buried in a nested log panel. The final answer stays separate. Commands expand on demand for output, and running jobs retain Stop controls. Thinking uses a soft left-to-right white shimmer, disabled for reduced motion. Composer Stop cancels the loop and that session's running jobs.

Claims and process identities are committed before a command is allowed to execute. Ordinary child processes share an owned process group. Shell failures report without waiting forever for inherited output handles. Output retains the last 64 KiB, explicitly marking truncation. Four jobs may run across the backend, with 256 saved jobs per session and 32 model steps per turn. Session deletion is blocked while jobs run.

Shutdown interrupts jobs; crash recovery reports uncertain outcomes instead of replaying commands. Linux verifies process identity before attempting orphan cleanup. Deliberately escaped children and kernel-uninterruptible processes are not guaranteed to be contained or terminated. Windows execution is not yet supported; no systemd dependency is required.

**YOLO mode is not a sandbox.** Commands have your user account's filesystem and network privileges, including access to sensitive files. Provider tokens are not injected into the shell environment. See [`src/backend/bash/README.md`](src/backend/bash/README.md) for lifecycle and recovery details.

## Git and file review

Select a project, then use the split Git control at the top right. The primary button opens confirmation for initialize, commit, or push based on repository state; the chevron opens all available actions and the latest operation receipt. Actions run in the background backend, not through chat or the model:

- **Initialize repository** creates Git metadata with the confirmed initial branch. It does not stage or commit files.
- **Commit** uses your message and defaults to already-staged changes. **All repository changes** is an explicit alternative that stages additions, edits, and deletions before committing.
- **Commit and push** preserves the created commit if pushing fails. The result includes its commit ID.
- **Push** sends only the checked-out branch to the same-name branch on the selected existing remote. Setting its upstream is explicit. Force, mirroring, pruning, automatic tag pushes, and recursive submodule pushes are disabled.

Mutations require the selected project to be the repository root. Normal hooks and signing still apply. Terminal password prompts are disabled, so configure credentials or use an existing credential/signing agent. Errors include useful Git diagnostics without URL credentials. A failed or cancelled action is not a rollback: staging, commits, or a remote update may already have happened. Inspect status and the remote before retrying.

Claims are stored before execution in private `git.sqlite` beside the project catalog. Stable request IDs prevent duplicate execution, including reconnects and restarts. In-flight claims become interrupted on restart and are never automatically replayed. Each operation stays tied to its original project, with a repository lock and at most four simultaneous mutations. Progress-write failure blocks further mutations, reports an uncertain result and any known commit, and leaves the original durable claim intact. Git storage failure does not prevent chat or session writes.

The **Diff** panel reads real repository changes and distinguishes staged and working content. Its compact toolbar controls unified/split layout, full-file viewing, wrapping, complete-source copy, and an optional right-hand file tree with filtering. Collapsible file headers show staged/working line statistics before loading source on selection; both the review document and file navigation are windowed. Binary files and unavailable counts are labeled explicitly instead of showing fabricated zeros. Untracked counting is bounded to 128 files, 4 MiB per file, and a 16 MiB aggregate read budget per status request. Renamed paths retain their original language metadata. Binary/non-UTF-8 files have an explicit fallback; regular file previews are limited to 4 MiB per side instead of silently truncating source. Optional panels load separately, with their own loading/error boundaries.

Large histories, activity/tool groups, file views, and selection lists use measured windowing. Focus and selection anchors remain mounted; tool disclosure state survives virtual unmounts. Prepending history preserves the visible message, including the switch from normal flow to windowing. Streamed output follows the bottom only while you are there. Paragraph/closed-fence delivery is unchanged.

## Performance checks

```sh
bun run benchmark                      # writes /tmp/flame-performance.json
bun run benchmark /tmp/my-results.json
```

This builds a production profiling bundle, measures three fresh-process startups separately from first panel open, exercises real Git/worker/history/search/persistence interactions, waits for idle worker release, and benchmarks representative and pathological highlighting. It restores the ordinary production renderer afterward. No provider account or network inference is used.

See [`PERFORMANCE.md`](PERFORMANCE.md) for the hardware baseline, measurements, cache/worker budgets, regression thresholds, and tradeoffs. The normal build does not record profiling traces. Two small, lockfile-backed dependency patches release rejected shared-highlighter/WASM initialization promises so actual initialization failures can retry; the retry regression test uses the real engine.

## Layout

- `src/main/main.ts`: app lifecycle and permission policy
- `src/main/window.ts`: window creation and navigation policy
- `src/renderer/App.tsx`: workspace layout
- `src/renderer/components/composer/`: composer, autosizing hook, and styles
- `vite.config.mjs`: shared React renderer build configuration
- `scripts/dev-server.mjs`: local Vite server and development-only CSP adjustments
- `scripts/dev.mjs`: development process lifecycle
- `tests/window.test.mjs`: Electron and hot-reload smoke tests

The renderer is sandboxed with context isolation, no Node integration, and a restrictive content security policy. Local generated code-view styles are allowed, including inline style elements/attributes; scripts still forbid inline execution and JavaScript eval, with only the required WASM evaluation permission. A narrow preload exposes only the authenticated loopback RPC connection. Project and authentication operations run in a separate backend process.
