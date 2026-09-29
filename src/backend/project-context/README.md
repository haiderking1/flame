# Project instruction discovery

The loader uses the session's project directory, not the backend process's working directory. It selects context files by probing exact filenames along the direct ancestor chain; it does not enumerate child directories or run shell searches.

## Selection and ordering

1. Load one global context file from `~/.flame/agent`.
2. Check the working directory and each parent up to filesystem root.
3. Include selected ancestor files from outermost to innermost, after the global file. A global file whose directory also appears in that chain is included once.

Within each directory, precedence is:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. `AGENTS.MD`
4. `CLAUDE.md`
5. `CLAUDE.MD`

The first readable regular file wins. Empty files still shadow same-directory fallbacks. Files in different ancestor directories continue to load. Symlinked regular files are followed; directories and other non-files are skipped. Read errors log a warning and permit the next candidate. Files are read as UTF-8 with a leading BOM removed, without custom size caps, strict-decoding requirements, or content rewriting.

The system prompt includes `project_context` only when files were found. It contains the source paths and complete contents in `project_instructions` blocks. No discovery-status messages, additional scope markup, or special search/tool policies are injected.

## Linked worktrees

Git metadata is inspected only along the direct ancestor chain. A nested linked worktree with its own context file shadows the same-named file at its containing main checkout root. Other ancestors still apply. If the worktree lacks its own context, it inherits normally. Differently named files are not treated as duplicates.

Regular repositories, sibling worktrees, bare-repository layouts, submodules, and missing/corrupt Git metadata retain normal ancestor discovery. Git metadata lookup does not spawn Git or search sibling working directories for context files.

## Agent integration

Each agent run loads context once before its first provider request, using the same project path as the tools. The resulting prompt is reused for all tool follow-ups in that run. New user runs and background continuations load context at their own start. No instruction refresh is performed between tool calls.

Tool targets do not trigger discovery. Nested instructions remain accessible through ordinary tools, and their contents are not automatically promoted into the system prompt. There is no mandatory Read-before-Bash rule, automatic nested instruction loading, changed-instruction gate, or deferred tool execution.

Historical `deferred` results from earlier versions remain displayable as **Not run**, but no new operation produces those results. This preserves truthful saved history without retaining the old execution mechanism.

This loader does not restrict filesystem access. Tools retain their existing OS permissions. Stop still cancels loading/provider/tool work through the normal turn abort signal; it does not roll back completed effects.

Regression sources: `tests/project-context.test.mjs` and `tests/project-context-agent.test.mjs` cover selection, worktree inheritance, prompt injection, and the absence of automatic nested loading or execution gates.
