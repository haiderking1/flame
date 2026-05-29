# Pillar 1+2: Integration Plan (continuation of Task #2)

Status: foundation module is implemented and typecheck-clean. This doc captures the integration steps still required to land Pillar 1+2 end-to-end. Pick this up as the first thing in the next session.

## State at end of last session

**Module written, typecheck passes** (`npx tsgo --noEmit` exit 0):

```
packages/coding-agent/src/utils/flame-home.ts          ✅
packages/coding-agent/src/core/memory/
  index.ts                                             ✅  barrel exports
  paths.ts                                             ✅  getMemoryDir / getSoulPath / getMemoryFilePath
  threat-patterns.ts                                   ✅  port of hermes tools/threat_patterns.py
  atomic-write.ts                                      ✅  tmp+fsync+rename
  file-lock.ts                                         ✅  cross-platform lockfile dance
  drift.ts                                             ✅  detectExternalDrift + parseEntries + serializeEntries
  memory-store.ts                                      ✅  MemoryStore class with add/replace/remove + snapshot + budgets
  soul.ts                                              ✅  loadSoulMd + DEFAULT_AGENT_IDENTITY
  prompt-strings.ts                                    ✅  MEMORY_GUIDANCE
  memory-tool.ts                                       ✅  createMemoryTool(store) + createMemoryToolDefinition(store)
```

## Integration steps remaining

### Step A — extend `BuildSystemPromptOptions`

File: `packages/coding-agent/src/core/system-prompt.ts`

Add two optional fields to the interface and use them in `buildSystemPrompt`:

```ts
export interface BuildSystemPromptOptions {
  // ... existing fields ...
  /** SOUL.md content, replaces the hardcoded "You are Flame…" identity when present. */
  identity?: string;
  /** Memory + USER profile blocks. Inserted after context files & skills, before date/cwd. */
  volatileBlocks?: string[];
}
```

In `buildSystemPrompt`:
- If `identity` is set and `customPrompt` is not set, **replace** the leading `"You are Flame, an expert coding assistant. You help users by..."` paragraph with `identity`. (The rest of the prompt — Available tools, Guidelines, Flame documentation — stays.)
- After the skills section (line ~175 in the existing file) and before the final date/cwd append, inject each non-empty `volatileBlocks` entry joined by `\n\n`.

This minimally invasive surgery keeps existing flame behavior intact when neither field is passed.

### Step B — own the MemoryStore on AgentSession

File: `packages/coding-agent/src/core/agent-session.ts`

1. Imports — top of file alongside other core imports:

```ts
import { loadSoulMd, MEMORY_GUIDANCE, MemoryStore, createMemoryToolDefinition } from "./memory/index.ts";
```

2. Fields — alongside the other private fields (around line 322):

```ts
private _memoryStore: MemoryStore = new MemoryStore();
private _soulContent: string | undefined;
private _memoryReady: Promise<void>;
```

3. Constructor (line 325) — kick off load before `_buildRuntime`:

```ts
this._memoryReady = Promise.all([
  this._memoryStore.loadFromDisk(),
  loadSoulMd().then((soul) => { this._soulContent = soul; }),
]).then(() => undefined);
```

This fire-and-forgets the load. The very first `_rebuildSystemPrompt` may see empty snapshot/no soul if the disk read hasn't completed yet — that's acceptable because subsequent rebuilds (compaction, extension reload) will pick it up. For deterministic-startup paths (CLI startup) the caller can `await session.ready()` (see step E).

4. `_rebuildSystemPrompt` (line 886) — populate the new options:

```ts
const memoryBlock = this._memoryStore.formatForSystemPrompt("memory");
const userBlock = this._memoryStore.formatForSystemPrompt("user");
const volatileBlocks = [memoryBlock, userBlock].filter((b): b is string => !!b);

const memoryGuidance = validToolNames.includes("memory") ? MEMORY_GUIDANCE : undefined;
// Append memory guidance into promptGuidelines if loaded
if (memoryGuidance) promptGuidelines.push(memoryGuidance);

this._baseSystemPromptOptions = {
  // ... existing fields ...
  identity: this._soulContent,
  volatileBlocks,
};
```

### Step C — register memory in `tools/index.ts`

File: `packages/coding-agent/src/core/tools/index.ts`

Touches:
- Add `export { createMemoryTool, createMemoryToolDefinition, type MemoryToolDetails, type MemoryToolInput } from "../memory/memory-tool.ts";` to the top exports.
- Add `"memory"` to `ToolName` union (line 122).
- Add `"memory"` to `allToolNames` Set (line 135).
- Add `"memory"` to `DEFAULT_ACTIVE_TOOL_NAMES` (line 149).
- Add `memory` slot to `ToolsOptions` (it's a special case — takes a `MemoryStore` instance, not options). Two ways to handle:
  - **(a)** Accept `memory?: { store: MemoryStore }` in ToolsOptions, switch on it in `createToolDefinition` / `createTool`.
  - **(b)** Don't register memory through this central factory — register it directly on AgentSession via `setActiveToolsByName` after constructing the store.
- **Choose (a)** for parity with other tools; (b) is a fallback if (a) clashes with extension assumptions.

### Step D — call sites that pass tool options

If you go with (a) above, also update `agent-session.ts` `_buildRuntime`:

```ts
const baseToolDefinitions = this._baseToolsOverride
  ? /* ... existing ... */
  : createAllToolDefinitions(this._cwd, {
      read: { autoResizeImages },
      bash: { commandPrefix: shellCommandPrefix, shellPath },
      process: { commandPrefix: shellCommandPrefix, shellPath },
      memory: { store: this._memoryStore },  // NEW
    });
```

### Step E — expose readiness

File: `packages/coding-agent/src/core/agent-session.ts`

Add:

```ts
async ready(): Promise<void> {
  await this._memoryReady;
}
```

CLI entry (`packages/coding-agent/src/main.ts`) can `await session.ready()` before the first turn to guarantee memory is loaded on session start.

### Step F — compaction reload

Hermes invalidates the system prompt cache + reloads memory from disk after compaction. Find flame's compaction completion handler (likely in `core/compaction/compaction.ts` or wherever `_lastAssistantMessage` is flushed) and add:

```ts
await this._memoryStore.loadFromDisk();
this._soulContent = await loadSoulMd();
this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
this.agent.state.systemPrompt = this._baseSystemPrompt;
```

This refreshes the snapshot from any writes that landed mid-session, so the next prefix-cache window starts with the up-to-date memory.

## Outstanding edge cases to handle during integration

1. **Default-tool-set churn.** Adding "memory" to `DEFAULT_ACTIVE_TOOL_NAMES` means every existing flame session will have the memory tool active by default. That's the intent, but it means existing snapshots / e2e tests will see an extra tool. Audit `packages/coding-agent/test/` for fixtures that count tools or check default sets.

2. **`base toolsOverride` path** — if a caller passes `baseToolsOverride`, we currently won't include memory. Decide: should the override extend rather than replace? Likely keep current replace semantics — callers who pass override know what they want.

3. **Settings gate.** Hermes lets users disable memory via config. Add a `memory.enabled` setting to flame's settings-manager (default true) and skip both the tool registration and the volatileBlocks injection when disabled.

4. **CLI smoke test before declaring done.** Per flame's AGENTS.md §"Testing pi Interactive Mode with tmux" (adapted to `flame-test.sh`):
   ```bash
   tmux new-session -d -s flame-test -x 80 -y 24
   tmux send-keys -t flame-test "./flame-test.sh" Enter
   sleep 3 && tmux capture-pane -t flame-test -p
   tmux send-keys -t flame-test "save: I prefer terse responses" Enter
   ```
   Confirm a MEMORY.md appears under `~/.flame/memories/`. Restart flame and confirm system prompt now contains the MEMORY block (use `--debug` or whatever flame's prompt-dump knob is — check CLI flags).

## Tests to write next (Task #3)

Location: `packages/coding-agent/test/memory/`

1. `memory-store.test.ts` — add/replace/remove/budget/duplicate/dedupe round-trip.
2. `drift.test.ts` — round-trip mismatch, entry-overflow, backup creation.
3. `snapshot.test.ts` — frozen across mutations, refreshes on reload, threat-scanned placeholder.
4. `threat-patterns.test.ts` — every pattern positive + negative.
5. `soul.test.ts` — missing, empty, truncated, threat-flagged.
6. `system-prompt-integration.test.ts` — identity injection, volatileBlocks injection, MEMORY_GUIDANCE injection only when tool present, date-only timestamp byte-stable across re-renders.

Use vitest at `node ../../node_modules/vitest/dist/cli.js --run test/memory/*.test.ts` per AGENTS.md.
