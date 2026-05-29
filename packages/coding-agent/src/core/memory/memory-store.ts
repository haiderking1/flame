import { promises as fs } from "node:fs";
import { atomicWrite } from "./atomic-write.ts";
import { buildDriftError, detectExternalDrift, ENTRY_DELIMITER, parseEntries, serializeEntries } from "./drift.ts";
import { withFileLock } from "./file-lock.ts";
import { getMemoryDir, getMemoryFilePath, type MemoryTarget } from "./paths.ts";
import { firstThreatMessage, scanForThreats } from "./threat-patterns.ts";

export const DEFAULT_MEMORY_CHAR_LIMIT = 2200;
export const DEFAULT_USER_CHAR_LIMIT = 1375;

const SEPARATOR = "═".repeat(46);

export interface MemorySuccess {
	success: true;
	target: MemoryTarget;
	entries: string[];
	usage: string;
	entry_count: number;
	message?: string;
}

export interface MemoryError {
	success: false;
	error: string;
	current_entries?: string[];
	usage?: string;
	matches?: string[];
	drift_backup?: string;
	remediation?: string;
}

export type MemoryResult = MemorySuccess | MemoryError;

export interface MemoryStoreOptions {
	memoryCharLimit?: number;
	userCharLimit?: number;
}

export class MemoryStore {
	memoryEntries: string[] = [];
	userEntries: string[] = [];
	readonly memoryCharLimit: number;
	readonly userCharLimit: number;
	private snapshot: { memory: string; user: string } = { memory: "", user: "" };

	constructor(options: MemoryStoreOptions = {}) {
		this.memoryCharLimit = options.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT;
		this.userCharLimit = options.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT;
	}

	async loadFromDisk(): Promise<void> {
		await fs.mkdir(getMemoryDir(), { recursive: true });
		this.memoryEntries = dedupe(await readEntries(getMemoryFilePath("memory")));
		this.userEntries = dedupe(await readEntries(getMemoryFilePath("user")));

		const sanitizedMemory = this.sanitizeForSnapshot(this.memoryEntries, "MEMORY.md");
		const sanitizedUser = this.sanitizeForSnapshot(this.userEntries, "USER.md");

		this.snapshot = {
			memory: this.renderBlock("memory", sanitizedMemory),
			user: this.renderBlock("user", sanitizedUser),
		};
	}

	formatForSystemPrompt(target: MemoryTarget): string | undefined {
		const block = this.snapshot[target];
		return block ? block : undefined;
	}

	async add(target: MemoryTarget, content: string): Promise<MemoryResult> {
		const trimmed = content.trim();
		if (!trimmed) return { success: false, error: "Content cannot be empty." };

		const scanError = firstThreatMessage(trimmed, "strict");
		if (scanError) return { success: false, error: scanError };

		return withFileLock(getMemoryFilePath(target), async () => {
			const bak = await this.reloadTargetUnderLock(target);
			if (bak) return buildDriftError(getMemoryFilePath(target), bak);

			const entries = this.entriesFor(target);
			if (entries.includes(trimmed)) {
				return this.successResponse(target, "Entry already exists (no duplicate added).");
			}

			const limit = this.charLimit(target);
			const newTotal = serializeEntries([...entries, trimmed]).length;
			if (newTotal > limit) {
				const current = this.charCount(target);
				return {
					success: false,
					error:
						`Memory at ${formatCount(current)}/${formatCount(limit)} chars. ` +
						`Adding this entry (${trimmed.length} chars) would exceed the limit. ` +
						`Replace or remove existing entries first.`,
					current_entries: [...entries],
					usage: `${formatCount(current)}/${formatCount(limit)}`,
				};
			}

			entries.push(trimmed);
			await this.persist(target);
			return this.successResponse(target, "Entry added.");
		});
	}

	async replace(target: MemoryTarget, oldText: string, newContent: string): Promise<MemoryResult> {
		const oldTrim = oldText.trim();
		const newTrim = newContent.trim();
		if (!oldTrim) return { success: false, error: "old_text cannot be empty." };
		if (!newTrim) return { success: false, error: "new_content cannot be empty. Use 'remove' to delete entries." };

		const scanError = firstThreatMessage(newTrim, "strict");
		if (scanError) return { success: false, error: scanError };

		return withFileLock(getMemoryFilePath(target), async () => {
			const bak = await this.reloadTargetUnderLock(target);
			if (bak) return buildDriftError(getMemoryFilePath(target), bak);

			const entries = this.entriesFor(target);
			const matches = entries
				.map((entry, idx) => ({ entry, idx }))
				.filter(({ entry }) => entry.includes(oldTrim));

			if (matches.length === 0) {
				return { success: false, error: `No entry matched '${oldTrim}'.` };
			}
			if (matches.length > 1) {
				const unique = new Set(matches.map((m) => m.entry));
				if (unique.size > 1) {
					return {
						success: false,
						error: `Multiple entries matched '${oldTrim}'. Be more specific.`,
						matches: matches.map((m) => (m.entry.length > 80 ? `${m.entry.slice(0, 80)}...` : m.entry)),
					};
				}
			}

			const idx = matches[0].idx;
			const limit = this.charLimit(target);
			const candidate = [...entries];
			candidate[idx] = newTrim;
			const newTotal = serializeEntries(candidate).length;
			if (newTotal > limit) {
				return {
					success: false,
					error:
						`Replacement would put memory at ${formatCount(newTotal)}/${formatCount(limit)} chars. ` +
						`Shorten the new content or remove other entries first.`,
				};
			}

			entries[idx] = newTrim;
			await this.persist(target);
			return this.successResponse(target, "Entry replaced.");
		});
	}

	async remove(target: MemoryTarget, oldText: string): Promise<MemoryResult> {
		const oldTrim = oldText.trim();
		if (!oldTrim) return { success: false, error: "old_text cannot be empty." };

		return withFileLock(getMemoryFilePath(target), async () => {
			const bak = await this.reloadTargetUnderLock(target);
			if (bak) return buildDriftError(getMemoryFilePath(target), bak);

			const entries = this.entriesFor(target);
			const matches = entries
				.map((entry, idx) => ({ entry, idx }))
				.filter(({ entry }) => entry.includes(oldTrim));

			if (matches.length === 0) {
				return { success: false, error: `No entry matched '${oldTrim}'.` };
			}
			if (matches.length > 1) {
				const unique = new Set(matches.map((m) => m.entry));
				if (unique.size > 1) {
					return {
						success: false,
						error: `Multiple entries matched '${oldTrim}'. Be more specific.`,
						matches: matches.map((m) => (m.entry.length > 80 ? `${m.entry.slice(0, 80)}...` : m.entry)),
					};
				}
			}

			const idx = matches[0].idx;
			entries.splice(idx, 1);
			await this.persist(target);
			return this.successResponse(target, "Entry removed.");
		});
	}

	private async reloadTargetUnderLock(target: MemoryTarget): Promise<string | undefined> {
		const path = getMemoryFilePath(target);
		const drift = await detectExternalDrift(path, this.charLimit(target));
		const fresh = dedupe(await readEntries(path));
		this.setEntries(target, fresh);
		if (drift.driftDetected) return drift.backupPath;
		return undefined;
	}

	private async persist(target: MemoryTarget): Promise<void> {
		const content = serializeEntries(this.entriesFor(target));
		await atomicWrite(getMemoryFilePath(target), content);
	}

	private sanitizeForSnapshot(entries: string[], filename: string): string[] {
		return entries.map((entry) => {
			if (!entry || entry.startsWith("[BLOCKED:")) return entry;
			const findings = scanForThreats(entry, "strict");
			if (findings.length === 0) return entry;
			return (
				`[BLOCKED: ${filename} entry contained threat pattern(s): ${findings.join(", ")}. ` +
				`Removed from system prompt; use memory(action=read) to inspect and memory(action=remove) to delete the original.]`
			);
		});
	}

	private renderBlock(target: MemoryTarget, entries: string[]): string {
		if (entries.length === 0) return "";
		const limit = this.charLimit(target);
		const content = entries.join(ENTRY_DELIMITER);
		const current = content.length;
		const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
		const header =
			target === "user"
				? `USER PROFILE (who the user is) [${pct}% — ${formatCount(current)}/${formatCount(limit)} chars]`
				: `MEMORY (your personal notes) [${pct}% — ${formatCount(current)}/${formatCount(limit)} chars]`;
		return `${SEPARATOR}\n${header}\n${SEPARATOR}\n${content}`;
	}

	private entriesFor(target: MemoryTarget): string[] {
		return target === "user" ? this.userEntries : this.memoryEntries;
	}

	private setEntries(target: MemoryTarget, entries: string[]): void {
		if (target === "user") this.userEntries = entries;
		else this.memoryEntries = entries;
	}

	private charCount(target: MemoryTarget): number {
		const entries = this.entriesFor(target);
		return entries.length === 0 ? 0 : entries.join(ENTRY_DELIMITER).length;
	}

	private charLimit(target: MemoryTarget): number {
		return target === "user" ? this.userCharLimit : this.memoryCharLimit;
	}

	private successResponse(target: MemoryTarget, message?: string): MemorySuccess {
		const entries = this.entriesFor(target);
		const current = this.charCount(target);
		const limit = this.charLimit(target);
		const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
		return {
			success: true,
			target,
			entries: [...entries],
			usage: `${pct}% — ${formatCount(current)}/${formatCount(limit)} chars`,
			entry_count: entries.length,
			message,
		};
	}
}

async function readEntries(path: string): Promise<string[]> {
	try {
		const raw = await fs.readFile(path, "utf-8");
		return parseEntries(raw);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
}

function dedupe(entries: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of entries) {
		if (!seen.has(entry)) {
			seen.add(entry);
			out.push(entry);
		}
	}
	return out;
}

function formatCount(n: number): string {
	return n.toLocaleString("en-US");
}
