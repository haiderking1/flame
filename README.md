# Flame

An Electron app with a React message composer. No agent is connected yet.

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

The backend restores saved account state without a loading screen and refreshes expiring tokens in the background. It keeps credentials out of renderer RPC responses. Authentication alone does not enable sending messages: model discovery, inference, tools, and the agent loop are not implemented yet.

## Codex usage

**Settings → Usage** shows weekly usage, reset time, and available banked resets. Account-scoped snapshots are cached in SQLite, refreshed in the background while viewed, and retained if a read fails. Missing provider data is shown as unavailable, not zero.

**Use a banked reset** opens a Yes/No confirmation with No focused. Only Yes submits the selected credit. Submission is recorded durably before the single network attempt; double-clicks, reconnects, and application restarts cannot replay it. A lost response or interrupted submission leaves an unknown outcome and blocks further spending from Flame. Check ChatGPT usage instead of trying another reset. Reading or refreshing usage never spends credits.

## Composer

The composer grows up to a capped height, then scrolls. Shift+Enter inserts a newline; Enter submits only when a send handler is connected. Sending is disabled in the app until an agent is wired up. Drafts are currently held in memory, not persisted across restarts or full page reloads.

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
