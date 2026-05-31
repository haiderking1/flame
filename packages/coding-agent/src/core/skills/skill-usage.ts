/**
 * Skill usage telemetry + provenance tracking for the Curator.
 *
 * Faithful port of hermes-agent `tools/skill_usage.py`. Per-skill metadata
 * lives in a sidecar JSON file (`<skills>/.usage.json`) keyed by skill name.
 * Counters are bumped by the skill tools (`skill_view`, `skill_manage`); the
 * curator reads the derived activity timestamp to decide lifecycle transitions.
 *
 * Design notes (matching hermes):
 *  - Sidecar, not frontmatter — keeps operational telemetry out of user-authored
 *    SKILL.md content. The JSON keys are snake_case so the file is wire-compatible
 *    with hermes' `.usage.json`.
 *  - Atomic writes via temp-file + rename (see {@link atomicWrite}).
 *  - All counter bumps are best-effort: failures are swallowed and never break
 *    the underlying tool call.
 *  - Provenance: only skills explicitly marked `created_by: "agent"` (i.e. created
 *    by the background self-improvement review fork) are curator-managed.
 *    Foreground `skill_manage(create)` is user-directed and stays off-limits.
 *    Flame ships no bundled/hub skills, so there is no additional exclusion set.
 *
 * Lifecycle states: active (default) → stale (unused > staleAfterDays) →
 * archived (unused > archiveAfterDays; moved to `.archive/`). `pinned` is an
 * orthogonal opt-out flag.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../memory/atomic-write.ts";
import { discoverAllSkills } from "./discovery.ts";
import { getSkillsDir } from "./paths.ts";

export const STATE_ACTIVE = "active";
export const STATE_STALE = "stale";
export const STATE_ARCHIVED = "archived";
export type SkillState = typeof STATE_ACTIVE | typeof STATE_STALE | typeof STATE_ARCHIVED;
const VALID_STATES = new Set<string>([STATE_ACTIVE, STATE_STALE, STATE_ARCHIVED]);

/** One per-skill usage record. Keys are snake_case for hermes wire-compatibility. */
export interface UsageRecord {
	created_by: string | null;
	use_count: number;
	view_count: number;
	last_used_at: string | null;
	last_viewed_at: string | null;
	patch_count: number;
	last_patched_at: string | null;
	created_at: string;
	state: SkillState;
	pinned: boolean;
	archived_at: string | null;
}

export type UsageMap = Record<string, UsageRecord>;

/** A report row: the record plus its derived activity fields. */
export interface UsageReportRow extends UsageRecord {
	name: string;
	last_activity_at: string | null;
	activity_count: number;
}

function usageFilePath(): string {
	return join(getSkillsDir(), ".usage.json");
}

function archiveDir(): string {
	return join(getSkillsDir(), ".archive");
}

function nowIso(): string {
	return new Date().toISOString();
}

function emptyRecord(): UsageRecord {
	return {
		created_by: null,
		use_count: 0,
		view_count: 0,
		last_used_at: null,
		last_viewed_at: null,
		patch_count: 0,
		last_patched_at: null,
		created_at: nowIso(),
		state: STATE_ACTIVE,
		pinned: false,
		archived_at: null,
	};
}

/** Parse an ISO timestamp defensively; returns NaN-safe ms or undefined. */
function parseIso(value: unknown): number | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Newest real-activity timestamp (used/viewed/patched). Creation time is
 * intentionally excluded so callers can distinguish never-active skills.
 */
export function latestActivityAt(record: Partial<UsageRecord>): string | null {
	let latestMs = -1;
	let latestRaw: string | null = null;
	for (const key of ["last_used_at", "last_viewed_at", "last_patched_at"] as const) {
		const raw = record[key];
		const ms = parseIso(raw);
		if (ms === undefined) {
			continue;
		}
		if (ms > latestMs) {
			latestMs = ms;
			latestRaw = raw as string;
		}
	}
	return latestRaw;
}

/** Total observed activity across use/view/patch events. */
export function activityCount(record: Partial<UsageRecord>): number {
	let total = 0;
	for (const key of ["use_count", "view_count", "patch_count"] as const) {
		const v = record[key];
		if (typeof v === "number" && Number.isFinite(v)) {
			total += v;
		}
	}
	return total;
}

/** Read the entire `.usage.json` map. Returns `{}` on missing/corrupt. */
export function loadUsage(): UsageMap {
	const path = usageFilePath();
	if (!existsSync(path)) {
		return {};
	}
	try {
		const data = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (typeof data !== "object" || data === null || Array.isArray(data)) {
			return {};
		}
		const clean: UsageMap = {};
		for (const [k, v] of Object.entries(data)) {
			if (typeof v === "object" && v !== null && !Array.isArray(v)) {
				clean[k] = v as UsageRecord;
			}
		}
		return clean;
	} catch {
		return {};
	}
}

/** Write the usage map atomically. Best-effort — errors are swallowed. */
export async function saveUsage(data: UsageMap): Promise<void> {
	try {
		// Stable key order for clean diffs, mirroring hermes' sort_keys=True.
		const sorted: UsageMap = {};
		for (const name of Object.keys(data).sort()) {
			sorted[name] = data[name]!;
		}
		await atomicWrite(usageFilePath(), `${JSON.stringify(sorted, null, 2)}\n`);
	} catch {
		// Best-effort persistence.
	}
}

/** Return the record for `name`, backfilling missing keys; fresh if absent. */
export function getRecord(name: string): UsageRecord {
	const data = loadUsage();
	const rec = data[name];
	const base = emptyRecord();
	if (!rec) {
		return base;
	}
	return { ...base, ...rec };
}

/** True when a record opts a skill into curator management. */
function isCuratorManaged(record: UsageRecord | undefined): boolean {
	return record?.created_by === "agent";
}

/**
 * Whether `name` is eligible for usage tracking at all. Flame has no bundled or
 * hub skills, so every skill is trackable — kept for parity with hermes.
 */
export function isAgentCreated(_name: string): boolean {
	return true;
}

/** Load → apply `mutator(record)` in place → save. Best-effort. */
async function mutate(name: string, mutator: (rec: UsageRecord) => void): Promise<void> {
	if (!name) {
		return;
	}
	try {
		if (!isAgentCreated(name)) {
			return;
		}
		const data = loadUsage();
		const rec = data[name] ?? emptyRecord();
		mutator(rec);
		data[name] = rec;
		await saveUsage(data);
	} catch {
		// Telemetry failures never surface.
	}
}

/** Bump view_count + last_viewed_at. Called from skill_view. */
export async function bumpView(name: string): Promise<void> {
	await mutate(name, (rec) => {
		rec.view_count = (rec.view_count ?? 0) + 1;
		rec.last_viewed_at = nowIso();
	});
}

/**
 * Bump use_count + last_used_at. Called from skill_view too — loading a skill to
 * act on it counts as use, and the curator's stale timer keys off last_used_at.
 */
export async function bumpUse(name: string): Promise<void> {
	await mutate(name, (rec) => {
		rec.use_count = (rec.use_count ?? 0) + 1;
		rec.last_used_at = nowIso();
	});
}

/** Bump patch_count + last_patched_at. Called from skill_manage patch/edit. */
export async function bumpPatch(name: string): Promise<void> {
	await mutate(name, (rec) => {
		rec.patch_count = (rec.patch_count ?? 0) + 1;
		rec.last_patched_at = nowIso();
	});
}

/**
 * Opt a skill into curator management. Only the background self-improvement
 * review fork calls this; foreground skill_manage(create) does not, so
 * user-created skills are never auto-curated.
 */
export async function markAgentCreated(name: string): Promise<void> {
	await mutate(name, (rec) => {
		rec.created_by = "agent";
	});
}

/** Set lifecycle state. No-op for invalid states. */
export async function setState(name: string, state: string): Promise<void> {
	if (!VALID_STATES.has(state)) {
		return;
	}
	await mutate(name, (rec) => {
		rec.state = state as SkillState;
		if (state === STATE_ARCHIVED) {
			rec.archived_at = nowIso();
		} else if (state === STATE_ACTIVE) {
			rec.archived_at = null;
		}
	});
}

export async function setPinned(name: string, pinned: boolean): Promise<void> {
	await mutate(name, (rec) => {
		rec.pinned = pinned;
	});
}

/** Convenience wrappers used by the `/curator pin|unpin` commands. */
export async function pinSkill(name: string): Promise<void> {
	await setPinned(name, true);
}
export async function unpinSkill(name: string): Promise<void> {
	await setPinned(name, false);
}

/** Drop a skill's usage entry entirely. Called when a skill is deleted. */
export async function forget(name: string): Promise<void> {
	if (!name) {
		return;
	}
	try {
		const data = loadUsage();
		if (name in data) {
			delete data[name];
			await saveUsage(data);
		}
	} catch {
		// Best-effort.
	}
}

/** Locate a skill's directory by its frontmatter name, excluding the archive. */
function findSkillDir(name: string): string | undefined {
	for (const skill of discoverAllSkills()) {
		if (skill.name !== name) {
			continue;
		}
		const normalized = skill.filePath.split("\\").join("/");
		if (normalized.includes("/.archive/")) {
			continue;
		}
		return join(skill.filePath, "..");
	}
	return undefined;
}

/** Skill names explicitly authored by the agent (curator-managed). */
export function listAgentCreatedSkillNames(): string[] {
	const usage = loadUsage();
	const names = new Set<string>();
	for (const skill of discoverAllSkills()) {
		const normalized = skill.filePath.split("\\").join("/");
		if (normalized.includes("/.archive/")) {
			continue;
		}
		if (isCuratorManaged(usage[skill.name])) {
			names.add(skill.name);
		}
	}
	return [...names].sort();
}

/** Per-skill report rows (name + record + derived activity) for the curator/CLI. */
export function agentCreatedReport(): UsageReportRow[] {
	const data = loadUsage();
	const rows: UsageReportRow[] = [];
	for (const name of listAgentCreatedSkillNames()) {
		const base = emptyRecord();
		const rec = { ...base, ...(data[name] ?? {}) } as UsageRecord;
		rows.push({
			name,
			...rec,
			last_activity_at: latestActivityAt(rec),
			activity_count: activityCount(rec),
		});
	}
	return rows;
}

/** Names of skills currently in `<skills>/.archive/` (flat layout). */
export function listArchivedSkillNames(): string[] {
	const root = archiveDir();
	if (!existsSync(root)) {
		return [];
	}
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

/** Move an agent-created skill dir into `<skills>/.archive/`. Never deletes. */
export async function archiveSkill(name: string): Promise<{ ok: boolean; message: string }> {
	const skillDir = findSkillDir(name);
	if (!skillDir) {
		return { ok: false, message: `skill '${name}' not found` };
	}
	const root = archiveDir();
	try {
		mkdirSync(root, { recursive: true });
	} catch (e) {
		return { ok: false, message: `failed to create archive dir: ${String(e)}` };
	}
	let dest = join(root, name);
	if (existsSync(dest)) {
		dest = join(
			root,
			`${name}-${new Date()
				.toISOString()
				.replace(/[-:.TZ]/g, "")
				.slice(0, 14)}`,
		);
	}
	try {
		renameSync(skillDir, dest);
	} catch (e) {
		return { ok: false, message: `failed to archive: ${String(e)}` };
	}
	await setState(name, STATE_ARCHIVED);
	return { ok: true, message: `archived to ${dest}` };
}

/** Move an archived skill back to `<skills>/`. Restores flat (no category nesting). */
export async function restoreSkill(name: string): Promise<{ ok: boolean; message: string }> {
	const root = archiveDir();
	if (!existsSync(root)) {
		return { ok: false, message: "no archive directory" };
	}
	let src: string | undefined;
	const exact = join(root, name);
	if (existsSync(exact) && statSync(exact).isDirectory()) {
		src = exact;
	} else {
		// Fall back to the newest timestamped duplicate (`<name>-<ts>`).
		const dupes = listArchivedSkillNames()
			.filter((n) => n.startsWith(`${name}-`))
			.sort()
			.reverse();
		if (dupes[0]) {
			src = join(root, dupes[0]);
		}
	}
	if (!src) {
		return { ok: false, message: `skill '${name}' not found in archive` };
	}
	const dest = join(getSkillsDir(), name);
	if (existsSync(dest)) {
		return { ok: false, message: `destination already exists: ${dest}` };
	}
	try {
		renameSync(src, dest);
	} catch (e) {
		return { ok: false, message: `failed to restore: ${String(e)}` };
	}
	await setState(name, STATE_ACTIVE);
	return { ok: true, message: `restored to ${dest}` };
}
