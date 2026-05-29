# Flame Port: Pillar 1 + 2 — Memory & Soul

Spec for porting hermes-agent's Memory + Soul pillars into flame natively in TypeScript.

Source: `C:\Users\Administrator\Desktop\projects\hermes-agent` @ MIT, v0.14.x.
Reference files studied:
- `agent/memory_manager.py` (orchestrator)
- `agent/system_prompt.py` (3-tier assembly)
- `agent/prompt_builder.py` (DEFAULT_AGENT_IDENTITY, MEMORY_GUIDANCE, load_soul_md)
- `tools/memory_tool.py` (MemoryStore + memory tool, the authoritative builtin)

## 1. Goal & scope (this pillar only)

Ship these three behaviors in flame, behaving identically to hermes:

1. **SOUL.md** loaded at session start as the agent's identity, slotted first in the system prompt. Falls back to a default identity if missing.
2. **MEMORY.md** — agent's personal notes (env facts, project conventions, lessons learned). Char-budgeted, entry-delimited, threat-scanned, frozen-snapshot pattern.
3. **USER.md** — what the agent knows about the user. Same mechanics, smaller budget.
4. One `memory` tool with actions `add`/`replace`/`remove` × targets `memory`/`user`.
5. Three-tier system prompt assembly (`stable` / `context` / `volatile`) with prefix-cache-friendly invariants.

**Explicitly out of scope for this pillar** (deferred to later pillars):
- External memory providers (the `MemoryManager` orchestrator with plugins).
- `<memory-context>` fence tags and `StreamingContextScrubber` (only needed when external providers inject prefetched context).
- `session_search` tool.
- Kanban, profiles, cron — separate pillars.
- Skill system (Pillar 3).
- Self-improvement loop (Pillar 5).

We build the **builtin path only**, fully. The provider plumbing comes later when we add Pillar 5.

## 2. On-disk layout

| Path | Purpose | Char budget |
|---|---|---|
| `<FLAME_HOME>/SOUL.md` | Identity, prompt slot #1 | Soft cap via context-file truncation (~24KB per hermes default; see §7) |
| `<FLAME_HOME>/memories/MEMORY.md` | Agent notes | **2200 chars** (hard) |
| `<FLAME_HOME>/memories/USER.md` | User profile | **1375 chars** (hard) |
| `<FLAME_HOME>/memories/MEMORY.md.lock` | flock target for RMW safety | — |
| `<FLAME_HOME>/memories/MEMORY.md.bak.<ts>` | Drift backup (created on detected external mutation) | — |

`<FLAME_HOME>` resolution (**decision locked**: global only, mirrors hermes):
- Env: `$FLAME_HOME` if set
- Else: `~/.flame/` (mirrors `~/.hermes/`, `~/.claude/`)
- **No per-project override in Pillar 1+2.** One memory across all projects — agent learns about the user, not each codebase separately. This is hermes' actual behavior. A per-project layer can be added later as a flame-specific extension if it earns its keep.

Entry delimiter (in MEMORY.md / USER.md): `\n§\n` (newline-section-sign-newline). Entries can be multiline. Empty raw file = zero entries.

## 3. MemoryStore data model

Two parallel states per store instance:

- **Live state** (`memoryEntries: string[]`, `userEntries: string[]`) — mutated by tool calls, persisted to disk after every write, returned in tool responses.
- **Frozen snapshot** (`snapshot: { memory: string, user: string }`) — set exactly once at `loadFromDisk()`, used for system-prompt injection, **never mutated mid-session**. This is the prefix-cache invariant.

```
load_from_disk() called once at session start:
  raw bytes → parse entries → dedupe (keep first) → live state
                                                 → threat-scan each entry → sanitized list → render block → snapshot
mid-session memory(action=add, …):
  acquire file lock → re-read disk → detect drift (round-trip + entry-size) → drift? bail + back up
                                  → no drift: append entry → atomic write → release lock
                                  → tool response shows LIVE state
  SNAPSHOT IS NOT TOUCHED.
next session start:
  full reload, fresh snapshot captured.
```

**Why the frozen snapshot?** Provider prefix-cache (Anthropic, OpenAI, etc.) hashes the exact bytes of the system prompt. If memory content changes mid-session, every turn after the change pays full input cost. Hermes accepts the trade — your add-this-turn write isn't visible until next session — to keep the cache hot. Flame inherits this discipline.

## 4. Tool surface — `memory`

One tool. Schema:

```json
{
  "name": "memory",
  "description": "<see hermes MEMORY_SCHEMA, port verbatim with s/Hermes/Flame/ if needed — guidance is critical and tuned>",
  "parameters": {
    "type": "object",
    "properties": {
      "action":  { "type": "string", "enum": ["add", "replace", "remove"] },
      "target":  { "type": "string", "enum": ["memory", "user"] },
      "content": { "type": "string" },
      "old_text":{ "type": "string" }
    },
    "required": ["action", "target"]
  }
}
```

Behavioral rules (from `MemoryStore.add/replace/remove`):

- **add**:
  - reject empty content
  - threat-scan content (strict scope) — return error string verbatim if hit
  - acquire file lock
  - re-read disk, detect drift → on drift: backup + refuse with drift-error structure
  - reject exact duplicates (return success-no-op)
  - precompute new total chars; if > limit → return error with current/limit + entries
  - append + atomic write
- **replace**:
  - reject empty old_text / new_content
  - threat-scan new_content (strict scope)
  - file lock + drift check
  - find entries where `old_text` is substring
  - 0 matches → error
  - >1 matches with non-identical text → error with previews (max 80 chars each + ellipsis)
  - >1 matches all identical → operate on first
  - check replacement doesn't blow budget → error if it does
  - swap + atomic write
- **remove**:
  - reject empty old_text (no threat scan needed — we're deleting)
  - file lock + drift check
  - same multi-match resolution as replace
  - pop + atomic write

Success response shape:
```json
{
  "success": true,
  "target": "memory",
  "entries": ["...", "..."],
  "usage": "47% — 1,047/2,200 chars",
  "entry_count": 8,
  "message": "Entry added."
}
```

Error response shape varies; always has `success: false` and `error: string`. Drift errors also include `drift_backup: string` and `remediation: string`.

## 5. System-prompt assembly — three tiers

`buildSystemPromptParts(agent, systemMessage?)` returns `{ stable, context, volatile }`. `buildSystemPrompt(...)` joins with `\n\n` and caches on `agent._cachedSystemPrompt`.

### 5.1 `stable` tier (cached across the whole session)

In order:
1. **Identity** — `loadSoulMd()` result, or `DEFAULT_AGENT_IDENTITY` if SOUL.md missing/empty.
2. **`HERMES_AGENT_HELP_GUIDANCE`** equivalent — flame's version pointing to flame docs. (We rewrite this for flame; not a verbatim copy.)
3. **Tool-aware guidance blocks** (joined with single space):
   - `MEMORY_GUIDANCE` — only if `memory` tool is loaded.
   - (Future: `SESSION_SEARCH_GUIDANCE`, `SKILLS_GUIDANCE`, etc.)
4. **Tool-use enforcement block** — only injected for matching model families (`gpt`, `codex`, `gemini`, `gemma`, `grok`, `glm`, `qwen`, `deepseek`). Configurable: `auto` (default) / `true` (always) / `false` (never) / `string[]` (custom substring match).
5. **Model-family operational guidance** — `OPENAI_MODEL_EXECUTION_GUIDANCE` for gpt/codex/grok; `GOOGLE_MODEL_OPERATIONAL_GUIDANCE` for gemini/gemma. Only when enforcement was injected.
6. **Environment hints** — WSL/Termux/native (`buildEnvironmentHints()`).
7. **Active-profile hint** — names the active flame profile. For now flame doesn't have profiles → emit "Active flame profile: default" with a short note that other profiles can exist; defer the full multi-profile guard to a later pass.
8. **Platform hint** — looked up from a `PLATFORM_HINTS` table keyed by `agent.platform`.

### 5.2 `context` tier (cached across the session unless cwd context files change)

1. **Caller-supplied `systemMessage`** if provided.
2. **Context files** under `TERMINAL_CWD` (or cwd): `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc. — `buildContextFilesPrompt(cwd, skipSoul=<true if soul loaded above>)`. SOUL.md must NOT be injected twice.

### 5.3 `volatile` tier (changes per session/turn — never cached)

1. **MEMORY block** — `memoryStore.formatForSystemPrompt("memory")`, returns frozen snapshot.
2. **USER block** — `memoryStore.formatForSystemPrompt("user")`, frozen snapshot.
3. **(deferred)** External memory provider block.
4. **Timestamp/session/model/provider line**:
   ```
   Conversation started: <Weekday, Month DD, YYYY>
   Session ID: <id>            (if passSessionId && sessionId set)
   Model: <model>              (if model set)
   Provider: <provider>        (if provider set)
   ```
   **Date-only, not minute-precision** — critical for prefix-cache stability across the whole day. PR #20451 credit.

Block rendering for memory/user:
```
══════════════════════════════════════════════
MEMORY (your personal notes) [<pct>% — <current>/<limit> chars]
══════════════════════════════════════════════
<entries joined by ENTRY_DELIMITER>
```
46-char `═` separators above and below the header. USER block header: `USER PROFILE (who the user is) [<pct>% — <current>/<limit> chars]`.

### 5.4 Cache invariants

- Cache assembled prompt on `agent._cachedSystemPrompt`. Reuse for every turn.
- **Invalidate only on context compression.** On invalidation: clear cache + call `memoryStore.loadFromDisk()` (refreshes snapshot from any writes this session).
- Volatile tier still recomputes every rebuild — but rebuilds only happen at compression boundaries.

## 6. Identity loading — `loadSoulMd()`

```
1. soulPath = <FLAME_HOME>/SOUL.md
2. if !exists → return undefined
3. content = read utf-8, strip()
4. if empty → return undefined
5. content = scanContextContent(content, "SOUL.md")   // strict threat scan
6. content = truncateContent(content, "SOUL.md")      // 24KB default
7. return content
```

The default identity used when SOUL.md is missing (flame-rewritten from hermes' version):

```
You are Flame, an extensible coding agent. You are helpful, knowledgeable, and direct.
You assist with software engineering tasks — answering questions, writing and editing
code, analyzing information, and executing actions via your tools. You communicate
clearly, admit uncertainty when appropriate, and prioritize being genuinely useful
over being verbose unless otherwise directed below. Be targeted and efficient in
your exploration and investigations.
```

## 7. Integrity & safety

### 7.1 Concurrency — file locks

- Lock file per memory file: `<path>.lock`. Acquire shared exclusive lock around the **entire** RMW (re-read → mutate → write).
- TypeScript impl: use `proper-lockfile` (already battle-tested cross-platform) or implement `O_EXCL` lockfile dance directly. Native fcntl/msvcrt isn't necessary — file existence + retry is fine on the timescale memory operates at.

### 7.2 Atomic writes

- Write to tmp file in same directory (`.mem_XXXX.tmp`), fsync, then `fs.rename()`. Same filesystem = atomic on POSIX and on Windows (NTFS).
- On any failure: clean up tmp file, rethrow.

### 7.3 Drift detection

The store is meant to be the only writer to MEMORY.md/USER.md. External mutations (manual edit, patch tool, shell append, sister session) can sneak in. Before every write:

1. Re-read file.
2. Parse entries.
3. Re-serialize. If `parsed.join(DELIMITER) !== raw.strip()` → **round-trip mismatch** → drift.
4. If any single parsed entry exceeds the store's whole-file char limit → **entry-size overflow** → drift (someone appended freeform content the parser merged into one giant entry).

On drift:
- Back up the raw file to `<path>.bak.<unix_ts>`.
- Refuse the mutation; return drift-error with backup path + remediation text.
- The model then either rewrites the file or moves the appended content out manually.

### 7.4 Threat scanning

Two-layer defense:

1. **Pre-write** (`_scan_memory_content`): scan incoming content against the strict-scope threat pattern set. Reject the write outright.
2. **Snapshot-build** (`_sanitize_entries_for_snapshot`): scan each entry when building the system-prompt snapshot. Bad entries are replaced in the snapshot with `[BLOCKED: <FILE> entry contained threat pattern(s): <ids>. Removed from system prompt; use memory(action=read) to inspect and memory(action=remove) to delete the original.]`. Live state keeps the raw text so the user can see + remove the entry; the system prompt is safe.

For flame: port the strict scope pattern set verbatim from `tools/threat_patterns.py` (small file). This is a security-critical port — do not abbreviate.

## 8. TypeScript module layout (proposed for flame)

Slots into `packages/coding-agent/src/core/` (flame's existing structure):

```
packages/coding-agent/src/core/memory/
  index.ts                       # public exports
  memory-store.ts                # MemoryStore class
  memory-tool.ts                 # tool handler + schema
  memory-paths.ts                # getFlameHome(), getMemoryDir(), per-project resolution
  threat-patterns.ts             # ported strict scope patterns
  drift.ts                       # detectExternalDrift + driftError builder
  file-lock.ts                   # cross-platform lockfile wrapper
  atomic-write.ts                # tmp+rename helper
  system-prompt-block.ts         # render block (the ═══ ASCII art header)
  soul.ts                        # loadSoulMd + DEFAULT_AGENT_IDENTITY
  prompt-strings.ts              # MEMORY_GUIDANCE, etc.
  __tests__/
    memory-store.test.ts
    drift.test.ts
    snapshot.test.ts
    threat-patterns.test.ts
    soul.test.ts
```

System prompt assembly lives where flame already builds prompts — likely `packages/coding-agent/src/core/system-prompt.ts` (exists). We add the three-tier structure there if it isn't already; if flame already has a system-prompt module, we **extend** rather than replace, and wire memory/soul into it.

Tool registration plugs into flame's existing tool registry alongside the other tools in `packages/coding-agent/src/core/tools/`.

## 9. Test plan

Unit (vitest, no real provider, no network):

- **memory-store**: add/replace/remove happy paths, char budget rejection, duplicate rejection, empty input rejection, multi-match disambiguation (mixed + all-identical), persistence across reload.
- **drift**: round-trip mismatch detection, entry-overflow detection, backup file created with correct content, mutation refused.
- **snapshot**: frozen across mutations, refreshed on `loadFromDisk()`, threat-scan replaces poisoned entries with placeholder, live state retains raw entries.
- **threat-patterns**: every pattern in the ported strict set has at least one positive case and one negative.
- **soul**: missing → default; empty → default; truncated when over budget; threat-scanned; profile-aware path resolution.
- **system-prompt assembly**: tier ordering, cache hit when nothing changed, cache invalidation on compression reloads memory, date-only timestamp byte-stable, MEMORY_GUIDANCE injected iff memory tool present.
- **file-lock + atomic-write**: concurrent writer test, crash mid-write leaves file intact.

Integration (flame's harness via faux provider in `packages/coding-agent/test/suite/`):
- Session 1: agent calls `memory(add, memory, "User prefers concise responses")` → file on disk has the entry; system-prompt snapshot still empty (frozen).
- Session 2 (fresh): system prompt now includes the entry in the MEMORY block.
- SOUL.md present → identity reflects it; SOUL.md missing → DEFAULT identity used.

Interactive smoke (tmux per flame's AGENTS.md §"Testing pi Interactive Mode with tmux", adapted):
- Start flame, write something to memory, restart, verify it's recalled.

## 10. Migration notes (Python → TypeScript decisions)

| Hermes (Python) | Flame (TypeScript) | Note |
|---|---|---|
| `pathlib.Path` | `node:path` + `node:fs/promises` | use async I/O everywhere |
| `fcntl`/`msvcrt` lockfile | `proper-lockfile` or hand-rolled `O_EXCL` | check flame's existing deps first; reuse if anything compatible exists |
| `atomic_replace()` | `fs.rename()` after tmp write | atomic on POSIX/NTFS |
| `tempfile.mkstemp` | `crypto.randomUUID()` suffix in same dir | |
| `json.dumps(...)` | `JSON.stringify(...)` | tool returns string-typed |
| `re` module | TypeScript regex literals | port threat patterns 1:1 |
| `logging` module | flame's existing logger | match log levels (warning/debug) |
| `inspect.signature` for `on_memory_write` adapter | not needed (Pillar 1+2 has no external providers) | defer to Pillar 5 |

Erasable TS only (flame AGENTS.md rule): no enums, no parameter properties, no namespaces. Explicit field declarations + constructor assignments. Top-level imports only — no dynamic `await import()`.

## 11. Order of implementation (Task #2)

1. `memory-paths.ts` + tests — establish FLAME_HOME resolution first; everything else depends on this.
2. `threat-patterns.ts` + tests — port the strict scope set.
3. `atomic-write.ts` + `file-lock.ts` + tests — primitives.
4. `drift.ts` + tests — detection + backup.
5. `memory-store.ts` + tests — full CRUD + snapshot + char budgets.
6. `soul.ts` + tests — identity loader.
7. `prompt-strings.ts` — MEMORY_GUIDANCE + DEFAULT_AGENT_IDENTITY constants (flame-rewritten).
8. `system-prompt-block.ts` + tests — the ASCII-bordered renderer.
9. `memory-tool.ts` + tests — wire to flame's tool registry.
10. System-prompt integration into flame's existing prompt builder — wire stable/context/volatile tiers; ensure caching invariants hold.
11. Integration tests in `packages/coding-agent/test/suite/`.
12. Interactive smoke via tmux.

Each step ships green tests before the next starts. No skipping ahead.

## 12. Open questions to resolve before Task #2 starts

- **FLAME_HOME default**: ✅ Locked: `~/.flame/` global, no per-project override in Pillar 1+2.
- **Per-project memory**: ✅ Deferred. May add later as a flame-specific extension.
- **Existing flame state**: research at start of Task #2 — grep for current system-prompt assembler and home-dir helpers; extend rather than replace.
- **Tool registration shape**: research at start of Task #2 — mirror an existing flame tool (e.g. `read.ts`, `bash.ts`) for registration idiom.
