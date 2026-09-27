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

Changes under `src/main/` still require restarting `bun run dev`. This step only enables renderer hot reload.

Use `bun run start` to build and launch without the dev server.

## Check

```sh
bun run typecheck
bun run test
```

The smoke tests open real Electron windows, check isolation, and exercise composer typing, resizing, keyboard behavior, and IME handling. Development tests verify CSS updates, React Fast Refresh with draft preservation, HTML reloads, and submission success/failure with a test-only callback. The debugging pipe is enabled only by the tests.

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

The renderer is sandboxed with context isolation, no Node integration, and a restrictive content security policy. No preload bridge or IPC is exposed yet.
