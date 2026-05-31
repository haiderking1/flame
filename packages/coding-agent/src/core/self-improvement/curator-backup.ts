/**
 * Curator snapshot + rollback — `<skills>/.curator_backups/<id>/`.
 *
 * Ported from hermes-agent `agent/curator_backup.py`. A snapshot of the skills
 * tree is taken before any mutating curator pass so the run is reversible.
 * Hermes streams a `skills.tar.gz`; to stay dependency-free and cross-platform,
 * flame takes a recursive directory copy instead — same recoverability
 * guarantee. Each snapshot carries a `manifest.json` (reason, time, file count).
 * Old snapshots are pruned to the configured keep count.
 */
import { cpSync, type Dirent, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSkillsDir } from "../skills/paths.ts";

/** Entries under skills/ that must never be rolled into a snapshot. */
const EXCLUDED_ENTRIES = new Set([
	".curator_backups",
	".curator_runs",
	".archive",
	".curator_state",
	".usage.json",
	".skills_prompt_snapshot.json",
]);

const BACKUPS_DIRNAME = ".curator_backups";

export interface SnapshotManifest {
	id: string;
	reason: string;
	createdAt: string;
	skillFileCount: number;
}

function backupsDir(): string {
	return join(getSkillsDir(), BACKUPS_DIRNAME);
}

/** Build a filesystem-safe UTC id like `20260530-001853`, uniquified on collision. */
function utcId(existing: Set<string>): string {
	const d = new Date();
	const pad = (n: number, w = 2) => String(n).padStart(w, "0");
	const base =
		`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
		`-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
	let id = base;
	let suffix = 1;
	while (existing.has(id)) {
		id = `${base}-${suffix++}`;
	}
	return id;
}

function countSkillFiles(dir: string): number {
	let count = 0;
	const walk = (d: string): void => {
		let entries: Dirent[];
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(d, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name === "SKILL.md") {
				count++;
			}
		}
	};
	walk(dir);
	return count;
}

/**
 * Snapshot the skills tree. Returns the snapshot directory path, or undefined
 * when there is nothing to snapshot or the copy failed (best-effort).
 */
export function snapshotSkills(reason: string, keep: number): string | undefined {
	const skillsDir = getSkillsDir();
	if (!existsSync(skillsDir)) {
		return undefined;
	}

	const root = backupsDir();
	try {
		mkdirSync(root, { recursive: true });
	} catch {
		return undefined;
	}

	const existing = new Set(safeReaddir(root));
	const id = utcId(existing);
	const dest = join(root, id);
	const destSkills = join(dest, "skills");

	try {
		mkdirSync(destSkills, { recursive: true });
		for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
			if (EXCLUDED_ENTRIES.has(entry.name)) {
				continue;
			}
			cpSync(join(skillsDir, entry.name), join(destSkills, entry.name), { recursive: true });
		}
		const manifest: SnapshotManifest = {
			id,
			reason,
			createdAt: new Date().toISOString(),
			skillFileCount: countSkillFiles(destSkills),
		};
		writeFileSync(join(dest, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
	} catch {
		try {
			rmSync(dest, { recursive: true, force: true });
		} catch {
			// ignore
		}
		return undefined;
	}

	pruneSnapshots(keep);
	return dest;
}

/** List snapshot ids, newest first. */
export function listSnapshots(): string[] {
	return safeReaddir(backupsDir())
		.filter((name) => existsSync(join(backupsDir(), name, "manifest.json")))
		.sort()
		.reverse();
}

/** Keep only the newest `keep` snapshots; remove the rest. */
export function pruneSnapshots(keep: number): void {
	if (keep < 0) {
		return;
	}
	const snapshots = listSnapshots(); // newest first
	for (const id of snapshots.slice(keep)) {
		try {
			rmSync(join(backupsDir(), id), { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
}

function safeReaddir(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return [];
	}
}

/** Resolve a snapshot's skills directory, if it exists. */
export function snapshotSkillsDir(id: string): string | undefined {
	const dir = join(backupsDir(), id, "skills");
	if (existsSync(dir) && statSync(dir).isDirectory()) {
		return dir;
	}
	return undefined;
}

/** Restore a snapshot by replacing the active skills tree with the snapshot's contents. */
export function restoreSkillsSnapshot(id: string, keep: number = 5): boolean {
	const source = snapshotSkillsDir(id);
	if (!source) {
		return false;
	}
	const skillsDir = getSkillsDir();
	try {
		// Take a safety snapshot of current skills before mutating
		snapshotSkills("rollback-safety", keep);

		// Remove current skill files except exclusions
		if (existsSync(skillsDir)) {
			for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
				if (EXCLUDED_ENTRIES.has(entry.name)) {
					continue;
				}
				rmSync(join(skillsDir, entry.name), { recursive: true, force: true });
			}
		} else {
			mkdirSync(skillsDir, { recursive: true });
		}

		// Copy snapshot files back
		for (const entry of readdirSync(source, { withFileTypes: true })) {
			cpSync(join(source, entry.name), join(skillsDir, entry.name), { recursive: true });
		}
		return true;
	} catch {
		return false;
	}
}
