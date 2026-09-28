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

Entries are immutable and parent-linked, with a persisted active tip and paginated history. Message/settings snapshots, draft clearing, title updates, and revision increments commit transactionally. Stale writes are rejected; retried message submissions use stable request IDs instead of appending duplicates. Committed changes use WAL with `synchronous=FULL`. Branch navigation, compaction, and tool execution are not implemented yet.

Session rename and deletion are supported by the backend but currently have no UI controls. Deletion durably marks the session deleted, then moves the entire directory into that project's `sessions/.trash/` folder. Interrupted deletions finish on startup; delayed requests cannot recreate or append to deleted sessions. Trash retains the database for manual recovery; there is no restore UI yet. No project source files are deleted.

Session discovery is rebuilt from the individual databases on backend startup. Unsupported versions, unsafe paths, and unreadable databases produce warnings instead of being replaced. On Unix, session directories are private (`0700`) and databases are private (`0600`); symlinks, hard-linked database files, and unexpected ownership are rejected. History/drafts are plaintext, not encrypted, and may contain sensitive user-provided content. Credentials are never copied into session settings.

## Composer

Create or open a session before typing. The composer grows up to a capped height, then scrolls. Shift+Enter inserts a newline. With a model selected, Enter sends the session's active-branch conversation to Codex using its saved thinking level and service tier. Without a model, the button explicitly saves a local message only.

### Responses

Flame makes authenticated Responses API requests directly from its backend, not through a CLI. The provider transport streams internally, but the UI receives **finished paragraphs, list items, and closed code fences**, paced at 400 ms, rather than token-by-token text. The remaining text appears on completion. Text is currently displayed safely as plain text; rich Markdown rendering and syntax highlighting are separate work. The model is explicitly told it has no access to files or commands yet.

The composer send button becomes **Stop response** while a turn runs; typing the next message remains available. Stop cancels the request and preserves partial output with a stopped status. Responses continue across renderer reloads and session switches. App shutdown interrupts them; on restart, durable checkpoints are recovered without replaying the request. A durable per-session turn claim precedes the provider POST, and repeated submission IDs cannot start another request. One turn may run per session, with at most four active turns in the backend. Model changes and session deletion are blocked while its response runs.

Completed assistant messages, provider reasoning context, and terminal state commit atomically. Opaque reasoning is backend-only and reused only for the same account and model. Account changes abort active requests. Errors are sanitized, never automatically retried, and never consume banked resets. If storage fails, Flame reports it rather than claiming the response was saved. Version-1 session databases migrate transactionally, preserving entry IDs, history, drafts, and settings.

Requests have a ten-minute deadline and a 90-second read-idle limit. Assistant text is limited to 1 MiB, retained provider output and assembled conversation input to 8 MiB each. Oversized context is rejected, not silently truncated. Automatic compaction is not available yet.

Session drafts autosave after 400 ms and flush before switching sessions. Failed saves keep local text, display an error, and prevent navigation from silently losing it. Reloading saved state preserves unsaved text so conflicts can be resolved explicitly. Normal unload is blocked while a draft/write is pending; after saving, retry closing/reloading. Forced termination can still lose keystrokes that have not reached SQLite. Each draft/message is limited to 48 KiB after JSON encoding to fit the authenticated RPC transport.

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
