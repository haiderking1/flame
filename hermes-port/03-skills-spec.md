# Flame Port: Pillar 3 — Skills

Spec for porting hermes-agent's Skills pillar into flame natively in TypeScript.

Source: `C:\Users\Administrator\Desktop\projects\hermes-agent` @ MIT, v0.14.x (shallow clone).
Reference files studied:
- `agent/skill_utils.py` — frontmatter, platform gating, external dirs, config vars, discovery helpers
- `agent/skill_commands.py` — slash-command discovery, `/skill-name` invocation, reload diff, preloading
- `agent/skill_preprocessing.py` — `${HERMES_SKILL_DIR}` / inline-shell expansion
- `agent/skill_bundles.py` — multi-skill slash bundles
- `agent/prompt_builder.py` — `SKILLS_GUIDANCE`, `build_skills_system_prompt`, disk snapshot cache
- `agent/system_prompt.py` — stable-tier injection of skills index + `SKILLS_GUIDANCE`
- `agent/agent_init.py` — `_skill_nudge_interval`, `_iters_since_skill` wiring
- `agent/background_review.py` — background skill-review prompts (Pillar 5 coupling)
- `agent/conversation_loop.py` — skill nudge gate after each turn
- `tools/skills_tool.py` — `skills_list`, `skill_view`, discovery, injection warnings
- `tools/skill_manager_tool.py` — `skill_manage` CRUD
- `tools/skills_guard.py` — hub/agent-created security scanner
- `tools/registry.py` — tool registration (`registry.register(...)`)
- Exemplar skills: `skills/github/github-code-review/SKILL.md`, `skills/devops/kanban-worker/SKILL.md`, `skills/software-development/test-driven-development/SKILL.md`
- Flame: `packages/coding-agent/src/core/skills.ts`, `resource-loader.ts`, `system-prompt.ts`, `agent-session.ts`, docs, tests

## 0. Decisions locked (binding for implementation)

User answered the open questions:

1. **No bundled skills.** Hermes' 571 prebuilt skills are NOT ported and NOT distributed with flame. The user explicitly rejected this: "half of them useless tbh so nah just keep the model creating its skills and self improvment loop that the real deal tbh from my testing". Drop §13's bundled-skills options entirely; ignore any text in this spec implying a seed command or bundle directory.
2. **Global only.** `<FLAME_HOME>/skills/` is the sole skills location. The existing `.flame/skills/` per-project layer is **REMOVED** from flame as part of this pillar. Match hermes' global-only behavior. Update tests and docs to reflect the deletion; the project-scope collision precedence in §10 no longer applies.
3. **Primary path:** `<FLAME_HOME>/skills/<category>/<name>/SKILL.md` (dir-form, hermes-aligned). No flat-form creates from `skill_manage`. Legacy flame `agent/skills/` paths may remain scan-only for backward compat but the recommended migration is symlink or delete.
4. **`skill_manage` self-write IS in Pillar 3.** Background review thread defers to Pillar 5.
5. **Windows shell preprocessing:** default OFF on win32 unless WSL is detected. Implementation may treat this as a setting flag with that default.
6. **`formatSkillsForPrompt` fate:** when skill tools are loaded, the default prompt switches to the hermes-style index; the legacy XML helper stays available for extension-only / `--no-skills-tool` mode.

These decisions override anything in §§2, 10, 13 below that suggests otherwise. The reconciliation strategy in §10 ("extend, not replace") still stands — flame's existing `Skill` type and loader code are extended, not duplicated. But the project-scope feature is removed.

The bigger-picture preference behind decision (1): per [[feedback-self-improvement]] (auto-memory), the user believes **Pillar 5 carries the real value**. Pillar 3 ships the mechanism; the agent grows its own skill library through Pillar 5. Do not over-invest in Pillar 3 polish.

## 1. Goal & scope (this pillar only)

Ship these behaviors in flame, behaving identically to hermes where noted:

1. **Progressive disclosure** — metadata (name + description) in the system prompt; full `SKILL.md` body loaded on demand via a dedicated tool (not by flooding the prompt).
2. **On-disk skill library** — directory-per-skill with `SKILL.md` + optional `references/`, `templates/`, `scripts/`, `assets/`.
3. **`skills_list` tool** — tier-1 metadata listing (name, description, category).
4. **`skill_view` tool** — tier-2/3 load of `SKILL.md` body or supporting files, with path security, platform gating, setup detection, linked-file discovery.
5. **`skill_manage` tool** — agent self-write surface: `create`, `edit`, `patch`, `delete`, `write_file`, `remove_file`.
6. **System-prompt skills index** — hermes-style categorical index inside `<available_skills>` with mandatory-load guidance (not flame's current minimal XML catalog).
7. **`SKILLS_GUIDANCE`** — injected in stable tier when `skill_manage` is loaded (foreground self-improvement nudges).
8. **Slash skill commands** — `/skill:name` (flame convention) or equivalent, loading full skill content into the user turn with preprocessing, config injection, supporting-file hints.
9. **Skill bundles** — YAML bundles that load multiple skills under one slash command; bundle wins over single-skill name collision.
10. **Discovery & caching** — scan at session start; two-layer prompt-index cache (in-process LRU + disk snapshot validated by mtime manifest).
11. **Platform / disable / conditional gating** — `platforms` frontmatter, config `skills.disabled`, tool/toolset conditions in `metadata.hermes`.

**Explicitly out of scope for Pillar 3** (defer to later pillars or separate work):

- **Background self-improvement fork** (`agent/background_review.py` daemon thread) — document mechanics here; implement in **Pillar 5** alongside curator.
- **Curator lifecycle** (`agent/curator.py`, `tools/skill_usage.py` pin/archive/consolidation) — telemetry hooks from `skill_manage` may stub; full curator is Pillar 5.
- **Skills Hub install CLI** (`tools/skills_hub.py`, `hermes skills install`) — port guard scanner primitives, not the hub UX.
- **Plugin-provided skills** (`plugin:skill` qualified names) — defer unless flame gains a plugin skill registry.
- **Secret capture / gateway setup flows** in `skill_view` — simplify to setup notes; full interactive capture is gateway-specific.
- **Env passthrough / credential file mounting** for remote sandboxes — defer until flame has equivalent backends.
- **571 bundled hermes skills content** — decision required (§13); spec defines layout and seeding hook, not content import.
- **Replacing flame's `read`-based skill activation** in one shot — reconciliation strategy phases this (§10).

We build the **builtin path** (local dirs + tools + prompt index). Hub, curator, and background review plug in later.

## 2. On-disk layout

### 2.1 Path resolution

| Concept | Hermes | Flame today | Flame target (Pillar 3) |
|---|---|---|---|
| Home | `$HERMES_HOME` → `~/.hermes/` | `$FLAME_HOME` → `~/.flame/` (memory pillar) | Same |
| Primary skills dir | `<HERMES_HOME>/skills/` | `<agentDir>/skills/` → `~/.flame/agent/skills/` | **`<FLAME_HOME>/skills/`** (hermes-aligned write target) |
| Project skills | *(none — hermes is global-only)* | `.flame/skills/` in cwd | **Keep** — flame extension; scan after global, lower precedence than global for same name |
| Bundles | `<HERMES_HOME>/skill-bundles/*.yaml` | *(none)* | `<FLAME_HOME>/skill-bundles/*.yaml` |
| Prompt index cache | `<HERMES_HOME>/.skills_prompt_snapshot.json` | *(none)* | `<FLAME_HOME>/.skills_prompt_snapshot.json` |
| Skill config | `<HERMES_HOME>/config.yaml` → `skills.*` | `settings.json` `skills` array | Extend flame settings with `skills.disabled`, `skills.external_dirs`, etc. |
| Bundled source (repo) | `hermes-agent/skills/` (~571 skills) | *(none in flame package)* | Optional seed source — see §13 |

**Backward compatibility:** During migration, discovery MUST scan **both** `<FLAME_HOME>/skills/` and `<agentDir>/skills/` (legacy). Writes via `skill_manage` go only to `<FLAME_HOME>/skills/`. If legacy dir exists and primary does not, one-time migration copy is an open question (§13).

### 2.2 Directory structure (per skill)

Hermes layout (canonical):

```
<FLAME_HOME>/skills/
├── github/                          # category (optional grouping)
│   ├── DESCRIPTION.md               # optional category blurb (frontmatter description)
│   └── github-code-review/
│       ├── SKILL.md                 # required
│       ├── references/
│       ├── templates/
│       ├── scripts/
│       └── assets/
├── devops/
│   └── kanban-worker/
│       └── SKILL.md
└── my-custom-skill/                 # uncategorized (category = "general")
    └── SKILL.md
```

**Bundled vs user vs agent-written:** Hermes does **not** use separate on-disk trees. All skills live under `~/.hermes/skills/`:
- **Bundled** — shipped in the git repo under `skills/`; copied/seeds into home on install.
- **Hub-installed** — land under `skills/` (often `.hub/` quarantine path before promotion).
- **User / agent-created** — `skill_manage(action='create')` writes to the same tree.

Provenance is tracked via sidecar telemetry (`tools/skill_provenance.py`, `tools/skill_usage.py`), not separate directories.

### 2.3 Repo-only paths (not runtime skill roots)

| Path | Purpose |
|---|---|
| `hermes-agent/skills/index-cache/*.json` | **Legacy hub catalog snapshots** for website/docs extraction — source-controlled cache, **not** the agent runtime index. See `website/scripts/extract-skills.py`. |
| `hermes-agent/skills/.hub/` | Hub quarantine/install staging — excluded from skill scans via `EXCLUDED_SKILL_DIRS`. |

Runtime index cache is **`<FLAME_HOME>/.skills_prompt_snapshot.json`**, not `skills/index-cache/`.

### 2.4 Char / token budgets

| Item | Limit | Source |
|---|---|---|
| `name` | 64 chars | agentskills.io + hermes |
| `description` | 1024 chars (validation); **60 chars** in prompt index via `extract_skill_description()` | `agent/skill_utils.py:518-526`, `prompt_builder.py` |
| `skill_manage` write (`SKILL.md`) | **100,000 chars** | `tools/skill_manager_tool.py:164` |
| Supporting file | **1 MiB** | `tools/skill_manager_tool.py:165` |
| Inline shell output in preprocessing | **4,000 chars** | `agent/skill_preprocessing.py:20` |
| agentskills.io recommended `SKILL.md` body | < 500 lines / < ~5000 tokens | standard — advisory only in hermes |

### 2.5 Excluded directories (never scan for skills)

From `agent/skill_utils.py:27-44` — port verbatim set:

```
.git, .github, .hub, .archive, .venv, venv, node_modules, site-packages,
__pycache__, .tox, .nox, .pytest_cache, .mypy_cache, .ruff_cache
```

## 3. Skill data model

### 3.1 Frontmatter schema

Hermes `SKILL.md` format (`tools/skills_tool.py:28-46` + exemplars):

```yaml
---
name: github-code-review              # required; max 64
description: "Review PRs: ..."        # required; max 1024
version: 1.1.0                        # optional
author: Hermes Agent                  # optional (hermes convention)
license: MIT                          # optional (agentskills.io)
platforms: [linux, macos, windows]    # optional — omit = all platforms
prerequisites:                        # optional legacy → normalized to required_environment_variables
  env_vars: [API_KEY]
  commands: [curl, jq]
compatibility: Requires X             # optional (agentskills.io)
metadata:                             # optional map
  hermes:
    tags: [GitHub, Code-Review]
    related_skills: [github-auth]
    config:                           # optional — keys stored in config.yaml under skills.config.*
      - key: wiki.path
        description: ...
        default: "~/wiki"
    requires_tools: [...]             # conditional visibility
    requires_toolsets: [...]
    fallback_for_tools: [...]
    fallback_for_toolsets: [...]
---
```

**Body:** Markdown after closing `---`. Required non-empty for `skill_manage` create/edit validation (`tools/skill_manager_tool.py:249-251`).

### 3.2 Identifiers

| Identifier | Rule |
|---|---|
| **Skill name** | Directory name is fallback; frontmatter `name` is canonical for listing. Hermes `_find_skill()` matches **`skill_md.parent.name == name`**, not frontmatter name — **conflict**: two skills could share frontmatter name but differ by directory; collision detection in `skill_view` uses multiple strategies. |
| **Category** | Relative path under skills root: `github/github-code-review` → category `github`. Top-level skill → `"general"`. |
| **Qualified name** | `namespace:skill` for plugins; bare `category:skill` falls through to on-disk `category/skill` path (`tools/skills_tool.py:933-998`). |
| **Versioning** | Optional `version:` field — informational only; no semver enforcement. |

### 3.3 Flame `Skill` type vs Hermes metadata

Flame today (`packages/coding-agent/src/core/skills.ts`):

```typescript
interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo: SourceInfo;
  disableModelInvocation: boolean;
}
```

**Extend** (non-breaking additions):

```typescript
interface Skill {
  // ...existing fields...
  category?: string;
  platforms?: string[];
  tags?: string[];
  relatedSkills?: string[];
  /** Hermes metadata.hermes conditions — filter prompt index */
  conditions?: SkillConditions;
  /** Full description for tools; prompt index may truncate separately */
  descriptionFull?: string;
}
```

Keep `disableModelInvocation` — maps to agentskills.io `disable-model-invocation`; hermes has no direct equivalent (disabled via config instead).

### 3.4 Name validation conflict

| System | Pattern |
|---|---|
| agentskills.io / flame load | `^[a-z0-9-]+$`, no leading/trailing/consecutive hyphens |
| hermes `skill_manage` | `^[a-z0-9][a-z0-9._-]*$` — **allows dots and underscores** |

**Resolution:** Accept both on read (lenient discovery). **`skill_manage` writes** use hermes pattern for hermes parity. Warn on load if name violates agentskills.io stricter rules.

## 4. Skill discovery & indexing

### 4.1 Scan algorithm

At session start (and on explicit reload):

1. Collect dirs: `[getSkillsDir(), ...externalDirs]` — local first (`agent/skill_utils.py:327-335`).
2. Walk each dir with `iter_skill_index_files(dir, "SKILL.md")` — sorted by relative path, excludes `EXCLUDED_SKILL_DIRS`.
3. Parse frontmatter (YAML with simple-key fallback — `agent/skill_utils.py:88-122`).
4. Filter: platform match, not disabled, conditional tool/toolset rules (`prompt_builder.py:953-981`).
5. **Collision:** first wins per `frontmatter.name` / directory name; local dir beats external (`skills_tool.py:569-591`, `prompt_builder.py:1107-1137`).

Flame today (`loadSkills()`): Map by name, first wins, symlink dedupe by canonical path — **compatible** with hermes local-first if scan order is `[global, project, packages, cli paths]`.

### 4.2 Lazy vs eager

| Phase | What's loaded | When |
|---|---|---|
| Eager | name, description, category, conditions, platforms | Session start → prompt index + `skills_list` |
| Lazy | Full `SKILL.md` body, supporting files | `skill_view`, `/skill:name`, user `read` |
| Cached | Prompt index string | Stable tier for session lifetime |

### 4.3 In-memory cache shapes

**Prompt index cache** (`prompt_builder.py:830-832`):
- `_SKILLS_PROMPT_CACHE`: LRU `OrderedDict`, key = `(skills_dir, external_dirs, sorted tools, sorted toolsets, platform_hint, sorted disabled names)`.
- Max size: `_SKILLS_PROMPT_CACHE_MAX` (read from source at implement time).

**Slash command cache** (`agent/skill_commands.py:23-25`):
- `_skill_commands`: `Map<"/slug", {name, description, skill_md_path, skill_dir}>`.
- Rescan when platform scope changes (`HERMES_PLATFORM` / `HERMES_SESSION_PLATFORM`).

**Bundle cache** (`agent/skill_bundles.py:62-63`):
- Invalidated on bundle dir mtime change.

### 4.4 Disk snapshot (prompt index)

Path: `<FLAME_HOME>/.skills_prompt_snapshot.json`

```json
{
  "version": 1,
  "manifest": { "github/github-code-review/SKILL.md": [mtime_ns, size], ... },
  "skills": [{ "skill_name", "category", "frontmatter_name", "description", "platforms", "conditions" }],
  "category_descriptions": { "github": "..." }
}
```

- Valid when `manifest` matches live filesystem (`prompt_builder.py:863-878`).
- Rewritten on cold scan (`prompt_builder.py:1100-1105`).
- Cleared on successful `skill_manage` mutation (`tools/skill_manager_tool.py:868-871`).

**Important:** `reload_skills()` rescans slash commands but **does NOT** invalidate the prompt cache (`agent/skill_commands.py:351-355`) — prefix-cache stability tradeoff.

### 4.5 On-demand expansion (`skill_view`)

Flow (`tools/skills_tool.py:850-1436`):

1. Resolve skill by: direct path, `category/name`, recursive parent-dir name, legacy flat `name.md`.
2. **Ambiguity:** if >1 candidate across dirs → error with `matches[]` (no guessing).
3. Optional `file_path` → read supporting file with traversal guard.
4. Return JSON: `content` (preprocessed body), `linked_files`, `skill_dir`, setup fields, tags, etc.
5. Preprocessing when `preprocess=true`: template vars + optional inline shell (`agent/skill_preprocessing.py`).

**Injection warning (non-blocking):** log warning if content matches `_INJECTION_PATTERNS` (`tools/skills_tool.py:134-144`):

```
ignore previous instructions
ignore all previous
you are now
disregard your
forget your instructions
new instructions:
system prompt:
<system>
]]>
```

These are **warnings only** in `skill_view` — content still returned. Distinct from `skills_guard` blocking on write.

## 5. The `skill_manage` tool

### 5.1 Schema

Port from `tools/skill_manager_tool.py:900-1012` — rename paths `Hermes` → `Flame`, `~/.hermes/skills/` → `<FLAME_HOME>/skills/`.

```json
{
  "name": "skill_manage",
  "description": "<verbatim from SKILL_MANAGE_SCHEMA description — see skill_manager_tool.py:902-930>",
  "parameters": {
    "type": "object",
    "properties": {
      "action": { "enum": ["create", "patch", "edit", "delete", "write_file", "remove_file"] },
      "name": { "type": "string" },
      "content": { "type": "string" },
      "old_string": { "type": "string" },
      "new_string": { "type": "string" },
      "replace_all": { "type": "boolean" },
      "category": { "type": "string" },
      "file_path": { "type": "string" },
      "file_content": { "type": "string" },
      "absorbed_into": { "type": "string" }
    },
    "required": ["action", "name"]
  }
}
```

**Note:** There is no `install`/`uninstall` action on `skill_manage` — hub install is CLI (`hermes skills install`). Agent surface is CRUD only.

### 5.2 Action behaviors

| Action | Behavior |
|---|---|
| **create** | Validate name, category, frontmatter, size → mkdir → atomic write `SKILL.md` → optional security scan → invalidate prompt cache. Collision if name exists anywhere. |
| **edit** | Full `SKILL.md` replace; backup + rollback on scan failure. |
| **patch** | Fuzzy find-replace (`tools/fuzzy_match.py` port or reuse flame patch helper); default target `SKILL.md`; optional `file_path` for supporting files; re-validate frontmatter if patching `SKILL.md`. |
| **delete** | `shutil.rmtree` skill dir; refuse if pinned; validate `absorbed_into` target exists when non-empty; prune empty category dir. |
| **write_file** | Only under `references/`, `templates/`, `scripts/`, `assets/`; 1 MiB limit; path traversal blocked. |
| **remove_file** | Same path rules; lists `available_files` on miss. |

Success response: JSON `{ success, message, path, ... }`. Errors: `{ success: false, error, ... }` with previews on patch miss.

### 5.3 Security gates

**Not the same as memory threat patterns.** Skills use `tools/skills_guard.py`:

- **Hub installs:** always scanned.
- **Agent-created (`skill_manage`):** scanned only when `skills.guard_agent_created` is **true** (default **false**) — `tools/skill_manager_tool.py:59-75`.

When enabled, blocked scan returns error and rolls back write. Verdict policy for `agent-created` source (`tools/skills_guard.py:41-51`):

```python
"agent-created": ("allow", "allow", "ask"),  # dangerous → block with report
```

On block, return verbatim scan report from `format_scan_report()`.

**Memory-style strict threat scan** does NOT apply to skill content in hermes. Do not conflate with `packages/coding-agent/src/core/memory/threat-patterns.ts`.

### 5.4 Pin guard

`delete` refuses pinned skills (`tools/skill_manager_tool.py:137-161`) — patch/edit still allowed.

### 5.5 Side effects on success

1. `clear_skills_system_prompt_cache(clear_snapshot=True)`
2. Best-effort telemetry: `bump_patch`, `forget`, `mark_agent_created` (stub in Pillar 3)

## 6. The `skill_view` and `skills_list` tools

### 6.1 `skills_list`

Schema: `tools/skills_tool.py:1491-1503`.

Returns JSON:

```json
{
  "success": true,
  "skills": [{ "name", "description", "category" }],
  "categories": ["github", "devops", ...],
  "count": 120,
  "hint": "Use skill_view(name) to see full content..."
}
```

Optional `category` filter. Creates skills dir if missing (empty library message).

### 6.2 `skill_view`

Schema: `tools/skills_tool.py:1506-1522`.

Parameters: `name` (required), `file_path` (optional).

Success payload (main skill): see §4.5 — includes `content`, `raw_content` for slash-command path, `linked_files`, `skill_dir`, setup/env metadata.

Telemetry: on success, `bump_view` + `bump_use` (`tools/skills_tool.py:1535-1557`) — stub in Pillar 3.

### 6.3 Flame today: `read` tool activation

Flame's `formatSkillsForPrompt()` instructs:

> Use the read tool to load a skill's file when the task matches its description.

Hermes instructs:

> load it with skill_view(name)

**Reconciliation (§10):** Phase 1 adds `skill_view`; Phase 2 switches prompt text to hermes mandatory-load wording when skills tools are present; keep `read` as fallback for filesystem agents.

### 6.4 Slash-command loading (user turn, not tool)

`agent/skill_commands.py` builds user message via `_build_skill_message()`:
- Activation banner (`[IMPORTANT: The user has invoked the "..." skill...]`)
- Preprocessed content
- `[Skill directory: abs/path]` + relative path guidance
- `[Skill config: ...]` from `metadata.hermes.config`
- Setup notes, supporting-file listing with `skill_view` hints

Flame today (`agent-session.ts:1212-1230`): `/skill:name` reads file, wraps in `<skill name="" location="">` XML — **no preprocessing, no linked files, no config injection**.

Port hermes `_build_skill_message()` behavior into flame session input expansion.

## 7. System-prompt injection

### 7.1 Tier placement (hermes)

From `agent/system_prompt.py`:

| Tier | Skills content |
|---|---|
| **stable** | `SKILLS_GUIDANCE` (if `skill_manage` loaded) + full skills index from `build_skills_system_prompt()` (if any of `skills_list`, `skill_view`, `skill_manage` loaded) |
| **context** | *(none)* |
| **volatile** | *(none — skills are NOT in volatile tier unlike memory)* |

Flame today: skills XML appended **before** `volatileBlocks` (memory/user) in `system-prompt.ts:192-202`. **Target:** move skills index to **stable/cacheable** section; keep memory in volatile.

### 7.2 `SKILLS_GUIDANCE` (verbatim — port with s/Hermes/Flame/)

From `agent/prompt_builder.py:166-173`:

```
After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a non-trivial workflow, save the approach as a skill with skill_manage so you can reuse it next time.
When using a skill and finding it outdated, incomplete, or wrong, patch it immediately with skill_manage(action='patch') — don't wait to be asked. Skills that aren't maintained become liabilities.
```

Inject only when `skill_manage` ∈ loaded tools (`agent/system_prompt.py:109-110`).

### 7.3 Skills index block (hermes format)

From `agent/prompt_builder.py:1179-1205` — port prose verbatim (replace `hermes-agent` skill reference with `flame` equivalent doc pointer):

```
## Skills (mandatory)
Before replying, scan the skills below. If a skill matches or is even partially relevant to your task, you MUST load it with skill_view(name) and follow its instructions.
...
<available_skills>
  category: category description
    - skill-name: description
</available_skills>
Only proceed without loading a skill if genuinely none are relevant to the task.
```

**Not** flame's current XML per-skill block from `formatSkillsForPrompt()` — different structure and guidance strength.

### 7.4 Prefix-cache invariants

- Skills index string is **stable for the session** — rebuilt only when cache invalidated.
- Invalidation triggers: successful `skill_manage` mutation; optional manual reload command.
- **Not** invalidated by `reload_skills()` slash rescan (hermes deliberate choice).
- Skills index depends on loaded tool/toolset set — cache key includes sorted tool names.
- Date/session line stays in volatile tier (memory pillar) — unchanged.

### 7.5 Conditional filtering

Skill hidden from index when (`prompt_builder.py:953-981`):
- `metadata.hermes.fallback_for_toolsets` matches loaded toolset → hide (primary available)
- `metadata.hermes.fallback_for_tools` matches loaded tool → hide
- `metadata.hermes.requires_toolsets` not satisfied → hide
- `metadata.hermes.requires_tools` not satisfied → hide

## 8. Self-write / self-improvement mechanics

### 8.1 Foreground (Pillar 3)

| Mechanism | Trigger | Action |
|---|---|---|
| `SKILLS_GUIDANCE` | Every turn (stable prompt) | Nudge to save/patch after complex work |
| `skill_manage` tool description | Tool schema | Detailed when-to-create/update/delete guidance |
| Skills index footer | Stable prompt | "patch immediately", "offer to save after difficult tasks" |
| User confirmation | Tool description | "Confirm with user before creating/deleting" |
| `_skill_nudge_interval` | After turn completes | If ≥ N tool iterations since last `skill_manage`/`skill_view` use → queue background review |

Config: `skills.creation_nudge_interval` (default **10**) — `agent/agent_init.py:1178-1183`.

Reset `_iters_since_skill` on `skill_manage` call (`agent/tool_executor.py:93-94`).

### 8.2 Background review (Pillar 5 — spec only)

After each turn, if iteration threshold met and `skill_manage` available, spawn daemon thread (`agent/conversation_loop.py:4252-4277`):
- Fork agent with **parent's cached system prompt** (prefix cache preserved)
- Tool whitelist: memory + skill tools only
- Prompt: `_SKILL_REVIEW_PROMPT` / `_COMBINED_REVIEW_PROMPT` (`agent/background_review.py:45-148`)

Key skill-review rules (summarize for implementers):
1. Prefer **patch loaded skill** → patch umbrella → add support file → create class-level umbrella.
2. User frustration / format corrections → embed in **skill**, not just memory.
3. Class-level names only — no session-specific skill names.
4. Protected: bundled + hub-installed (no edit); pinned blocks delete only.
5. Do not save environment-transient failures as durable rules.

Reference doc `references/self-improvement-loop.md` cited in hermes source — **not present in shallow clone**; behavior captured above from `background_review.py`.

### 8.3 Deduplication & overlap

| Scenario | Behavior |
|---|---|
| Same skill name on create | Error — skill exists (`skill_manager_tool.py:496-502`) |
| Duplicate names across dirs | First scanned wins; `skill_view` ambiguity error if lookup matches multiple |
| Overlapping skills content | Background review: "note it in your reply — curator handles consolidation" |
| Delete with merge intent | `absorbed_into=<umbrella>` must exist before delete |
| Prompt index dedupe | Within category, dedupe by name (`prompt_builder.py:1168-1173`) |

## 9. agentskills.io compatibility

### 9.1 What the standard requires

([agentskills.io/specification](https://agentskills.io/specification))

- Directory layout: `<skill-name>/SKILL.md` + optional `scripts/`, `references/`, `assets/`
- Required frontmatter: `name`, `description` with strict name rules (must match parent directory)
- Progressive disclosure: metadata at startup → full body on activation → resources on demand
- Integration XML format for catalog (`<available_skills>` with `<name>`, `<description>`, `<location>`)

### 9.2 What hermes adds

- `platforms`, `prerequisites`, `metadata.hermes.*`, `version`, `author`
- Category directories + `DESCRIPTION.md`
- Hermes-specific tools: `skill_view`, `skill_manage`, `skills_list`
- Categorical text index instead of pure XML (still wraps `<available_skills>`)
- Looser name validation on read; writes allow `[a-z0-9._-]`
- Template vars `${HERMES_SKILL_DIR}`, `${HERMES_SESSION_ID}` → flame: `${FLAME_SKILL_DIR}`, `${FLAME_SESSION_ID}`

### 9.3 What flame must do

| Requirement | Approach |
|---|---|
| Load standard skills from Claude/Codex dirs | **Already supported** via settings `skills` paths (`docs/skills.md`) |
| Emit agentskills.io XML **or** hermes index | **Hermes index in stable tier** when skill tools loaded; retain `formatSkillsForPrompt()` for read-only/no-tool mode |
| `disable-model-invocation` | Keep — hide from prompt, force `/skill:name` |
| Validate on load | Keep warnings; missing description → skip |
| Interop with hermes skill files | Accept `metadata.hermes` block; ignore unknown fields |

## 10. Reconciliation with flame's existing skill system

### 10.1 What flame does today

| Aspect | Behavior |
|---|---|
| **Module** | `packages/coding-agent/src/core/skills.ts` |
| **Discovery** | `loadSkills()` / `loadSkillsFromDir()` — recursive `SKILL.md`, root `.md` in flame dirs |
| **Sources** | `agentDir/skills`, `.flame/skills`, packages, settings, CLI `--skill` via `DefaultResourceLoader` |
| **Collision** | First wins + diagnostic `collision` type |
| **Prompt** | `formatSkillsForPrompt()` — XML + "use read tool" (`system-prompt.ts:192-194`) |
| **Activation** | Model reads file OR `/skill:name` expands to inline XML block (`agent-session.ts`) |
| **Self-write** | **None** — no `skill_manage` |
| **Caching** | No prompt index cache |
| **Tests** | `test/skills.test.ts`, `test/sdk-skills.test.ts`, collision regression |

### 10.2 Overlap vs divergence

| Topic | Overlap | Divergence |
|---|---|---|
| File format | `SKILL.md` + YAML frontmatter | Hermes richer frontmatter |
| Discovery | Recursive dir walk | Hermes adds platform/disable/conditions, snapshot cache |
| Prompt catalog | Both use `<available_skills>` tag | **XML per skill vs categorical bullet list** |
| Activation | Progressive disclosure intent | **read vs skill_view** |
| Paths | Both support extra dirs | **`<FLAME_HOME>/skills` vs `agent/skills`** |
| Project scope | Flame has project skills | Hermes global-only |
| Self-write | — | Hermes `skill_manage` only |
| Security | — | Hermes `skills_guard` on write (optional) |

**Naming conflict:** Both use `Skill` type — same concept, different richness. **Extend** flame interface; do not rename.

### 10.3 Recommended strategy: **Extend** (not parallel, not replace)

| Option | Verdict |
|---|---|
| **Parallel hermes system** | Duplicates discovery, divergent prompts, double maintenance — reject |
| **Full replace** | Breaks SDK, docs, tests, agentskills.io XML consumers — reject |
| **Extend existing module** | ✅ Add hermes behaviors as layers on `skills.ts` + new `core/skills/` tools |

**Why:** Flame's loader, collision diagnostics, agentskills.io validation, and SDK hooks are production-tested. Hermes adds tools, categorical index, self-write, and caching — orthogonal extensions.

### 10.4 Migration path

1. **Phase A — Foundation:** Add `<FLAME_HOME>/skills/`, extend `Skill` type, dual-path discovery (home + legacy `agent/skills`).
2. **Phase B — Tools:** Ship `skills_list`, `skill_view`, `skill_manage` in `core/skills/`.
3. **Phase C — Prompt:** Add `buildSkillsSystemPrompt()` + `SKILLS_GUIDANCE`; wire stable-tier cache in agent session (mirror memory snapshot discipline — skills index stable, not volatile).
4. **Phase D — Slash commands:** Upgrade `/skill:name` expansion to hermes message format + preprocessing.
5. **Phase E — Bundles + settings:** `skill-bundles/`, `skills.disabled`, `external_dirs`.
6. **Phase F — Deprecation:** Switch default prompt from `formatSkillsForPrompt` to hermes index when skill tools present; keep XML helper for `--no-skills-tool` / extension-only mode.

**Preserve existing tests** — extend fixtures; add parallel hermes-behavior test suite under `core/skills/__tests__/`.

**Docs:** Update `docs/skills.md` with `skill_view` / `skill_manage` story; keep agentskills.io section; note `<FLAME_HOME>/skills/` write path.

**SDK example `04-skills.ts`:** Add comment showing `skillsOverride` still works; optional second example for skill tools once registered.

## 11. TypeScript module layout (proposed)

Mirror memory pillar layout under `packages/coding-agent/src/core/skills/`:

```
packages/coding-agent/src/core/skills/
  index.ts                          # public exports
  types.ts                          # Skill, SkillConditions, SkillFrontmatter (extend existing)
  paths.ts                          # getSkillsDir(), getSkillBundlesDir(), getFlameHome alignment
  frontmatter.ts                    # parseFrontmatter — move/share with utils or wrap existing
  discovery.ts                      # iterSkillIndexFiles, loadAllSkills, platform/disable/conditions
  prompt-index.ts                   # buildSkillsSystemPrompt(), snapshot read/write, LRU cache
  prompt-strings.ts                 # SKILLS_GUIDANCE, index header/footer prose
  preprocessing.ts                  # template vars, inline shell (config-gated)
  skill-view-tool.ts                # skill_view handler + schema
  skills-list-tool.ts               # skills_list handler + schema
  skill-manage-tool.ts              # skill_manage handler + schema
  skill-manage-actions.ts           # create/edit/patch/delete/write_file/remove_file
  slash-commands.ts                 # scanSkillCommands, buildSkillInvocationMessage
  bundles.ts                        # getSkillBundles, buildBundleInvocationMessage
  guard.ts                          # port skills_guard scan (subset or full)
  fuzzy-patch.ts                    # patch matching for skill_manage (or import from existing patch util)
  collision.ts                      # skill_view ambiguity detection
  __tests__/
    discovery.test.ts
    prompt-index.test.ts
    skill-manage.test.ts
    skill-view.test.ts
    preprocessing.test.ts
    guard.test.ts
    slash-commands.test.ts
    bundles.test.ts
```

**Keep** `packages/coding-agent/src/core/skills.ts` as thin re-export barrel initially to avoid breaking imports — migrate callers gradually.

**Reuse from memory pillar:**
- `core/memory/atomic-write.ts`
- `core/memory/file-lock.ts` (if skill_manage needs cross-process safety — hermes uses atomic write without lock; match hermes unless flame requires lock)
- `utils/flame-home.ts`

**Wire tools** in `packages/coding-agent/src/core/tools/` registry alongside `memory` tool.

**System prompt:** Extend `agent-session.ts` / future three-tier builder to call `buildSkillsSystemPrompt()` into stable section.

## 12. Order of implementation

Each step ships green tests before the next.

1. **`paths.ts` + tests** — `<FLAME_HOME>/skills/`, bundles dir, snapshot path; dual-scan legacy `agentDir/skills`.
2. **`types.ts` + extend discovery** — port `iter_skill_index_files`, exclusions, platform match, extend `loadSkills()` without breaking existing tests.
3. **`prompt-index.ts` + tests** — manifest snapshot, LRU cache, categorical index text, conditional filtering.
4. **`prompt-strings.ts`** — `SKILLS_GUIDANCE` + index prose (flame-adapted hermes-agent pointer).
5. **`skill-view-tool.ts` + tests** — resolution strategies, path security, injection warnings, linked files.
6. **`skills-list-tool.ts` + tests** — metadata listing, category filter.
7. **`preprocessing.ts` + tests** — `${FLAME_SKILL_DIR}` substitution; inline shell behind config flag (default off on Windows).
8. **`skill-manage-tool.ts` + tests** — all six actions, validation, atomic write, size limits, cache invalidation.
9. **`guard.ts` + tests** — port `skills_guard` patterns; wire `skills.guardAgentCreated` setting (default false).
10. **`slash-commands.ts` + tests** — upgrade `/skill:name` in `agent-session.ts` to hermes message shape.
11. **`bundles.ts` + tests** — bundle scan, invocation, conflict resolution (bundle beats skill).
12. **System prompt integration** — stable-tier skills index + guidance; conditional on loaded tools; preserve `formatSkillsForPrompt` fallback.
13. **Integration tests** — `test/suite/` harness: create skill → appears in index next session; skill_view loads body; patch updates disk.
14. **Docs pass** — `docs/skills.md`, SDK snippet.

## 13. Open questions to resolve before implementation

- **Primary skills path:** ✅ Recommend `<FLAME_HOME>/skills/<category>/<name>/SKILL.md` (hermes-aligned). Legacy `~/.flame/agent/skills/` scanned read-only until migrated. Confirm with user.
- **Dir-form vs flat:** Hermes uses **dir-form only** for `skill_manage` creates (`<skills>/<category?>/<name>/SKILL.md`). Flame's root `.md` skills (in agent/skills) remain load-only legacy — **no new flat creates**.
- **Bundled 571 skills:** Ship as (a) separate `@flame/skills` npm package, (b) postinstall seed into `<FLAME_HOME>/skills/`, (c) opt-in `flame skills seed`, or (d) not at all? Default recommendation: **(c) opt-in seed command** — keeps flame package small, matches hermes "seed on install" spirit without bloating npm.
- **Project-scoped skills:** Flame has `.flame/skills/`; hermes does not. **Keep as flame extension** — project skills lose to global on name collision (existing test #2781 precedent for user > package; extend to global > project).
- **`FLAME_HOME` vs `agentDir`:** Memory uses `FLAME_HOME`; skills docs say `agent/skills`. **Unify writes on `FLAME_HOME/skills`**; document symlink `agent/skills` → `../skills` for backward compat?
- **Background review thread:** Pillar 3 or Pillar 5? Recommend **Pillar 5** with foreground `SKILLS_GUIDANCE` + manual `skill_manage` in Pillar 3.
- **Inline shell preprocessing on Windows:** Hermes runs `bash -c` — default **off** on win32 unless WSL detected?
- **`formatSkillsForPrompt` fate:** Deprecate from default prompt when skill tools loaded, or keep dual emission temporarily?

## 14. Migration table (Python → TypeScript)

| Hermes (Python) | Flame (TypeScript) | Note |
|---|---|---|
| `pathlib.Path` | `node:path` + `node:fs/promises` | async I/O |
| `yaml.safe_load` / CSafeLoader | `yaml` npm package or reuse `parseFrontmatter` in `utils/frontmatter.ts` | keep simple-key fallback |
| `OrderedDict` LRU cache | `Map` + manual LRU or `lru-cache` package | check deps first |
| `atomic_json_write` / `atomic_replace` | reuse `core/memory/atomic-write.ts` | snapshot JSON |
| `tempfile.mkstemp` + `os.replace` | `atomic-write.ts` | skill_manage writes |
| `shutil.rmtree` | `fs.rm({ recursive: true })` | delete skill |
| `re` module | RegExp literals | guard patterns 1:1 |
| `subprocess.run(["bash","-c",...])` | `child_process.spawn` with bash | gate on platform |
| `fcntl`/file locks | not used by hermes skill_manage | optional for flame |
| `tools/fuzzy_match.fuzzy_find_and_replace` | port or share with flame edit/patch tool | patch action |
| `tools/path_security.validate_within_dir` | port small helper | skill_view + write_file |
| `tools/registry.registry.register` | flame tool registry pattern (`core/tools/*.ts`) | mirror memory-tool |
| `json.dumps` tool returns | `JSON.stringify` | string-typed tool results |
| `gateway.session_context.get_session_env` | flame session platform env (defer) | platform_disabled |
| `hermes_cli.config.load_config` | `SettingsManager` / settings.json | skills section |
| `EXCLUDED_SKILL_DIRS` frozenset | `Set<string>` constant | shared discovery |
| `PLATFORM_MAP` | same map in `discovery.ts` | Termux note optional |
| `_INJECTION_PATTERNS` list | string[] verbatim | warn-only in skill_view |
| `THREAT_PATTERNS` in skills_guard | `guard.ts` regex array | block on agent-created when enabled |
| `skill_commands._SKILL_INVALID_CHARS` | same regex | slash slug normalization |
| Plugin `namespace:skill` | defer | qualified names |
| `inspect`/dynamic imports | static imports only | flame AGENTS.md erasable TS rule |

---

## Appendix A — Tool registry (`tools/registry.py`)

`skill_commands.py` imports `SKILLS_DIR` and `skill_view` from `tools/skills_tool.py` — not registry. Registry usage:

- `tools/skills_tool.py:1525-1567` — registers `skills_list`, `skill_view` on toolset `"skills"`.
- `tools/skill_manager_tool.py:1018-1034` — registers `skill_manage` on toolset `"skills"`.

Flame: register all three on a `"skills"` tool group; gate loading via existing toolset / extension mechanism.

## Appendix B — Exemplar frontmatter patterns

**GitHub skill** (`skills/github/github-code-review/SKILL.md`): `platforms`, `metadata.hermes.tags`, `related_skills`, long procedural body with bash setup blocks.

**DevOps skill** (`skills/devops/kanban-worker/SKILL.md`): meta-skill explaining relationship to auto-injected `KANBAN_GUIDANCE`; pitfalls/examples structure.

**Software-development skill** (`skills/software-development/test-driven-development/SKILL.md`): class-level workflow skill with "When to Use", iron laws, RED-GREEN-REFACTOR — target shape for `skill_manage` creates.

## Appendix C — Flame file references

| File | Role |
|---|---|
| `packages/coding-agent/src/core/skills.ts` | Current Skill type + discovery + XML prompt |
| `packages/coding-agent/src/core/resource-loader.ts:505-526` | `updateSkillsFromPaths()` → `loadSkills()` |
| `packages/coding-agent/src/core/system-prompt.ts:192-194` | Injects `formatSkillsForPrompt` when `read` tool present |
| `packages/coding-agent/src/core/agent-session.ts:906,957,1212` | Loads skills into prompt; `/skill:` expansion |
| `packages/coding-agent/docs/skills.md` | User-facing skill story |
| `packages/coding-agent/test/skills.test.ts` | Validation + XML format tests |
