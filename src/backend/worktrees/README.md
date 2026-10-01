# Session worktrees

Each session works either in its project's checkout or in a Git worktree of it on its own branch, so several agents can change one repository at once without clashing. The behaviour follows T3 Code's worktree threads.

## Where a session works

- The session database (version 10) records `workspace`: the mode, the base branch and "start from origin" of a worktree still to be created, the session's branch, and the worktree path once it exists. User choices go through `worktrees.configure` and advance the session revision; progress the backend records (a created worktree, a renamed branch) does not, so a draft saved meanwhile still lands.
- `roots.ts` resolves a session's folder from the in-memory session index: its worktree, else the project checkout. Bash, the file tools, project instructions, Git status, diffs and actions, and `@` file search all use it, and change revisions (`git/changes.ts`) are kept per folder, so sessions sharing a worktree see the same updates. A session not created yet can name an existing worktree by path; `linked-worktree.ts` accepts it only when the repository still registers that folder as one of its linked worktrees.
- `workspace-config.ts` checks a choice: a new worktree needs, when one is named, a base branch with a commit (outside a repository it falls back to the checkout); an existing worktree must be a linked worktree of the project's repository, and its branch is adopted. A new worktree can be chosen only before the first message.

## Creating a worktree

The first message of a session waiting for a new worktree creates it before the agent runs (`bootstrap.ts`), as stages shown on the setup card:

1. **Fetch base branch**, with "start from origin": fetch the base from origin and start from that commit; otherwise skipped.
2. **Check out files**: `git worktree add -b flame/<8 hex> <folder> <base>` with Git's checkout progress, in `~/.flame/worktrees/<repository>/<branch>`. The base is recorded as the branch's merge base for change requests.
3. **Init submodules**: recursive, top level only, or skipped, by settings. Failure is a warning; the worktree is usable without them.
4. **Run setup script**: the project's script from Settings runs in the worktree with `FLAME_PROJECT_ROOT` and `FLAME_WORKTREE_PATH`. The agent waits for it when the project asks, otherwise they run side by side. A failing script never fails the setup.
5. **Start agent**: from here the setup can no longer be abandoned.

Stopping the response during setup removes what was made (`git worktree remove --force`, retried) and its placeholder branch, and fails the response with "Worktree setup cancelled."; a failure does the same with its reason, keeping the session ready to retry. "Work locally" abandons the setup and lets the same response continue in the project checkout. `setup-tracker.ts` announces every change and saves stage changes at once (progress a few times a second), so the card survives reloads; a restart marks a setup it cut short as failed, or done when the agent had already started (`reconcileInterruptedSetup`).

## While a session works

- While the branch is still the placeholder, the Git text model names it from the message with T3 Code's branch-name prompt (`flame/<words>`, with a free `-N` suffix); failures keep the placeholder.
- After each response the session adopts a branch the agent switched its worktree to, when no other session shares the worktree and it is not a placeholder.
- A worktree whose folder was deleted is recreated from its branch before the next response.
- A session in the checkout records the branch it last ran on, so the composer can offer to switch back when the checkout moved.
- `refs.ts` and `switch-ref.ts` list and switch branches for the branch picker; remote branches get tracking branches.

## Pull requests

`pull-requests.ts` resolves a pull or merge request from its number, URL or `gh pr checkout` / `glab mr checkout` command through the hosting CLI. "Local" force-checks it out in the project. "Worktree" reuses a worktree already on its branch (moving it to the head only when clean with no local commits), or adds one on the head branch (`flame/pr-<n>/<head>` for forks) and lets the CLI check it out there; with a session it records the workspace and runs the setup script, shown on the setup card.

## Removing worktrees

Deleting a session never removes its worktree by itself. When it was the only session in the worktree, the app asks whether to delete the worktree too (`worktrees.remove`, which refuses a worktree another session uses). Otherwise the worktree is remembered for cleanup.

`cleanup.ts` applies the rules from Settings hourly, when settings change, and after a deletion when that rule is on: worktrees of deleted sessions, of sessions inactive for a number of days, with no commits beyond the default branch, or whose change request was merged. Only a worktree one session owned is considered, never one in use, and `cleanup-checks.ts` keeps any worktree that is not a linked worktree inside Flame's folder, holds a project, is on another branch, has changes, or ignores anything but dependency folders (ignored files such as `.env` may be data that exists nowhere else). Everything is checked again just before removal. Sessions keep their branch and path, so the next message recreates the worktree.

Regression sources: `tests/worktree-git.test.mjs`, `tests/worktree-turns.test.mjs`, `tests/worktree-service.test.mjs`, `tests/worktree-logic.test.mjs` and `tests/worktrees-ui.test.mjs`.
