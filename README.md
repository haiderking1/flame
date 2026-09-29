# Flame

An Electron coding workspace with project-owned SQLite sessions and direct Codex conversations. Tools and the agent loop are not connected yet.

## Requirements

- Bun 1.4.0
- Node.js 22.12+ on a release supported by Vite (Node 24+ recommended)
- A graphical desktop session to launch the app or run the window test

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

The smoke tests use real Electron renderers (headless for interaction tests), check isolation, and exercise composer typing, resizing, keyboard behavior, and IME handling. Development tests verify CSS updates, React Fast Refresh with draft preservation, HTML reloads, and submission success/failure with a test-only callback. The debugging pipe is enabled only by the tests.

## OpenAI sign-in

Open **Settings → Providers**, then use the Codex toggle to sign in through your default browser. The loopback callback uses port 1455; another Codex sign-in must not be using that port. You can cancel from Flame. Once connected, the logo's status dot turns green and the toggle signs out.

Credentials are stored in `~/.flame/agent/auth.json`. On Unix, Flame restricts the directories to `0700` and the file to `0600`, rejects symlinks and unexpected ownership, and replaces the file atomically. This is plaintext credential storage, protected by filesystem permissions, not encryption. Never share or commit this file. Sign-out removes Flame's saved credentials; it does not revoke sessions on OpenAI's website.

The backend restores saved account state without a loading screen and refreshes expiring tokens in the background. It keeps credentials out of renderer RPC responses. Models and supported thinking levels/service tiers are discovered from OpenAI and cached locally. Codex inference runs directly in Flame's backend. Tools and the agent loop are not connected yet.

## Codex usage

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

## Composer

Create or open a session before typing. The composer grows up to a capped height, then scrolls. Shift+Enter inserts a newline. With a model selected, Enter sends the session's active-branch conversation to Codex using its saved thinking level and service tier. Without a model, the button explicitly saves a local message only.

### Responses

Flame makes authenticated Responses API requests directly from its backend, not through a CLI. The provider transport streams internally, but the UI receives **finished paragraphs, list items, and closed code fences**, paced at 400 ms, rather than token-by-token text. The remaining text appears on completion. Answers and progress messages render Markdown, including headings, nested lists, task lists, tables, quotes, links, and fenced code with copy/wrap controls. Syntax highlighting runs lazily in a shared worker with bounded caching and a readable plain-text fallback. Raw HTML stays inert; image sources are explicit links rather than automatic network requests. Only HTTP(S) links can open in the system browser. The model can invoke Read, Edit, Write, and Bash to inspect or change the selected project. Tools run directly in YOLO mode, without approval prompts.

The composer send button becomes **Stop response** while a turn runs; typing the next message remains available. Stop cancels the request and preserves partial output with a stopped status. Responses continue across renderer reloads and session switches. App shutdown interrupts them; on restart, durable checkpoints are recovered without replaying the request. A durable per-session turn claim precedes the provider POST, and repeated submission IDs cannot start another request. One turn may run per session, with at most four active turns in the backend. Model changes and session deletion are blocked while its response runs.

Completed assistant messages, provider reasoning context, and terminal state commit atomically. Opaque reasoning is backend-only and reused only for the same account and model. Account changes abort active requests. Errors are sanitized and never consume banked resets. A recognized context-window overflow permits one compaction and retry per turn; other failures are not automatically retried. If storage fails, Flame reports it rather than claiming the response was saved. Older session databases migrate through transactional migrations to version 8, preserving entry IDs, history, drafts, and settings.

Provider HTTP requests have a ten-minute deadline and a 90-second read-idle limit. These limits do not apply to Bash commands. Assistant text is limited to 1 MiB and ordinary provider response/text input to 8 MiB. Image input has a separate 64 MiB payload budget. Durable full-turn output has a 256 MiB bound. Conversation history can exceed one request; compaction reduces the active projection before submission. If the latest indivisible message or tool exchange cannot fit, Flame reports the failure and preserves history.

Session drafts autosave after 400 ms and flush before switching sessions. Failed saves keep local text, display an error, and prevent navigation from silently losing it. Reloading saved state preserves unsaved text so conflicts can be resolved explicitly. Normal unload is blocked while a draft/write is pending; after saving, retry closing/reloading. Forced termination can still lose keystrokes that have not reached SQLite. Each draft/message is limited to 48 KiB after JSON encoding to fit the authenticated RPC transport.

### Conversation compaction

Flame automatically compacts at **90% of the selected model’s context window**, before a request or between complete tool exchanges. The composer shows estimated usage and the threshold; validated provider usage supersedes text estimates, including cached input and reasoning tokens. Model catalog context-window metadata determines the limit, with a conservative 128,000-token fallback for older catalogs.

Type `/` in the composer to browse slash commands. Typing `/com` filters to **`/compact`**: **Enter runs the selected command immediately**, **Tab completes its text**, arrow keys change the selection, and Escape dismisses the list. You can also click a command to run it. The context circle is display-only; its tooltip includes the automatic threshold. Use **`/compact`** to summarize earlier conversation manually. Compaction uses the selected model without tools, produces a structured checkpoint, and preserves recent conversation with intact tool-call/result groups. Long histories are summarized in bounded chunks. Previous summaries, goals, approvals, progress, unresolved work, exact paths, and file operations inform each checkpoint. Fresh operation ledgers remain available independently.

Summaries are lossy: expand a checkpoint marker to inspect it. Full messages and tool records remain in SQLite and the history UI. Checkpoints survive restart; account/model switches remove incompatible opaque reasoning. Manual compaction consumes only the accepted command text, preserves pending attachments and any draft typed afterward, and creates no assistant message. Unavailable or rejected commands remain editable and are never sent as chat messages. Slash-prefixed paths such as `/tmp/project.txt` remain ordinary messages. Stop cancels compaction. Failed summaries or storage writes preserve the previous context; interrupted partial-turn checkpoints fall back safely without replaying tools.

The approach follows [Pi’s compaction implementation](https://github.com/earendil-works/pi/tree/6a4af07d6145c88dad4e3472acebe75cc57af88f), adapted to Flame’s transactional SQLite storage and turn lifecycle.

### Project instructions

Flame loads global instructions from `~/.flame/agent`, followed by the selected project's direct ancestor chain from filesystem root down to the project directory. Each directory selects the first readable regular file among `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, and `CLAUDE.MD`. Symlinked files are supported; read failures warn and allow the next candidate. Nested linked worktrees avoid loading the main checkout's shadowed, same-named context file twice.

Discovery does not walk child directories, sibling repositories, or dependency trees. Nested instructions can be read with normal tools, but are not automatically loaded based on tool targets. The context is loaded once at the start of each agent run and stays unchanged throughout its tool follow-ups. No tool pauses or instruction-review gates are added. This is instruction handling, **not filesystem isolation**. See [`src/backend/project-context/README.md`](src/backend/project-context/README.md).

### Image attachments

Paste, drop, or choose PNG/JPEG/WebP/GIF images with the composer's paperclip. Removable square thumbnails persist with the draft; image-only messages work too. Clicking a draft or saved image opens the full-size viewer with zoom/pan, previous/next controls, Escape/background close, and focus restoration. Composer thumbnails are cached 256px center crops, separate from full-size originals.

Originals and model-prepared images live in private session-owned storage. The backend validates and prepares images with Photon in worker threads, then sends real Codex image input alongside text. Images fit within 2000×2000 and a 4.5 MiB base64 payload; uploads are limited to 20 MiB/40 megapixels and ten images per message. Saved history exposes metadata rather than provider payloads, and reload never resends accepted messages. Stop and failed uploads retain truthful outcomes. See [`src/backend/images/README.md`](src/backend/images/README.md) for lifecycle and limits.

### File tools

Every agent request includes the session's project directory in a `<cwd>` system-prompt section, including tool follow-ups and background continuations. It uses the same project-path lookup as the tools, not the backend process's working directory.

- **List (`ls`)** lists one directory, non-recursively: sorted names, dotfiles, and `/` for directories. Defaults to 500 entries with a 50 KiB listing bound and explicit truncation notices. The model is instructed to prefer it over recursive `find` for directory discovery.
- **Read** inspects UTF-8 text with line ranges, bounded output, a continuation offset, and a raw-content SHA-256.
- **Edit** applies unique, non-overlapping exact replacements against the original file. All replacements validate before any target bytes change; BOM and uniform CRLF are preserved.
- **Write** creates files and parent directories or atomically replaces a whole file. Replacing an existing file requires the hash from Read, preventing overwrites of an observed newer version.

Mutations are serialized per canonical path across sessions and use same-directory atomic replacement with fsync. Symlinks are preserved; multiply hard-linked files and special files are rejected. Files are limited to 16 MiB, read output to 2000 lines / 64 KiB, and encoded tool arguments to 1 MiB. Binary/non-UTF-8 files receive explicit errors rather than lossy conversion. There are 1024 saved file operations per session.

Operation claims and results are durable. Interrupted operations are never automatically replayed; saved results remain inspectable in expandable tool rows after reload. Stop does not claim a completed replacement was undone. Like Bash, these tools are **not a sandbox**. External writers still have a narrow check-to-rename race, and atomic replacement does not preserve extended filesystem metadata such as ACLs/xattrs. See [`src/backend/file-tools/README.md`](src/backend/file-tools/README.md) for guarantees and limits.

### Bash jobs

The model can run foreground commands or managed background jobs. There are **no command timeouts and no automatic command reruns**. Commands execute in a fresh shell rooted at the selected project; shell directory changes do not persist between calls. Background completion is saved and delivered to the model without polling, including waking an idle session. Progress messages stay readable in the conversation, with consecutive tool calls shown as quiet rows between them. Each row expands directly to its details with one click, without an outer group dropdown or duplicated command label. Only tool output scrolls inside a bounded area; narration is never buried in a nested log panel. The final answer stays separate. Commands expand on demand for output, and running jobs retain Stop controls. Thinking uses a soft left-to-right white shimmer, disabled for reduced motion. Composer Stop cancels the loop and that session's running jobs.

Claims and process identities are committed before a command is allowed to execute. Ordinary child processes share an owned process group. Shell failures report without waiting forever for inherited output handles. Output retains the last 64 KiB, explicitly marking truncation. Four jobs may run across the backend, with 256 saved jobs per session and 32 model steps per turn. Session deletion is blocked while jobs run.

Shutdown interrupts jobs; crash recovery reports uncertain outcomes instead of replaying commands. Linux verifies process identity before attempting orphan cleanup. Deliberately escaped children and kernel-uninterruptible processes are not guaranteed to be contained or terminated. Windows execution is not yet supported; no systemd dependency is required.

**YOLO mode is not a sandbox.** Commands have your user account's filesystem and network privileges, including access to sensitive files. Provider tokens are not injected into the shell environment. See [`src/backend/bash/README.md`](src/backend/bash/README.md) for lifecycle and recovery details.

## Layout

- `src/main/main.ts`: app lifecycle and permission policy
- `src/main/window.ts`: window creation and navigation policy
- `src/renderer/App.tsx`: workspace layout
- `src/renderer/components/composer/`: composer, autosizing hook, and styles
- `vite.config.mjs`: shared React renderer build configuration
- `scripts/dev-server.mjs`: local Vite server and development-only CSP adjustments
- `scripts/dev.mjs`: development process lifecycle
- `tests/window.test.mjs`: Electron and hot-reload smoke tests

The renderer is sandboxed with context isolation, no Node integration, and a restrictive content security policy. A narrow preload exposes only the authenticated loopback RPC connection. Project and authentication operations run in a separate backend process.
