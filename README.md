# Flame Agent Harness Mono Repo

Flame is a self-extensible coding agent harness. This monorepo houses the agent, its runtime, the multi-provider LLM API, and the terminal UI.

* **[@earendil-works/flame-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@earendil-works/flame-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@earendil-works/flame-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

## All Packages

| Package | Description |
|---------|-------------|
| **[@earendil-works/flame-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/flame-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/flame-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/flame-tui](packages/tui)** | Terminal UI library with differential rendering |

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./flame-test.sh      # Run flame from sources (can be run from any directory)
```

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `FLAME_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before publishing.
- Local release installs, documented npm installs, and `flame update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

MIT
