import { promises as fs } from "node:fs";

export const ENTRY_DELIMITER = "\n§\n";

export interface DriftResult {
	driftDetected: boolean;
	backupPath?: string;
}

export function parseEntries(raw: string): string[] {
	if (!raw.trim()) return [];
	return raw
		.split(ENTRY_DELIMITER)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function serializeEntries(entries: string[]): string {
	return entries.length > 0 ? entries.join(ENTRY_DELIMITER) : "";
}

export async function detectExternalDrift(filePath: string, charLimit: number): Promise<DriftResult> {
	let raw: string;
	try {
		raw = await fs.readFile(filePath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return { driftDetected: false };
		}
		throw err;
	}
	if (!raw.trim()) return { driftDetected: false };

	const parsed = parseEntries(raw);
	const roundtrip = serializeEntries(parsed);
	const maxEntryLen = parsed.reduce((max, entry) => Math.max(max, entry.length), 0);

	const roundtripMismatch = raw.trim() !== roundtrip;
	const entryOverflow = maxEntryLen > charLimit;

	if (!roundtripMismatch && !entryOverflow) {
		return { driftDetected: false };
	}

	const ts = Math.floor(Date.now() / 1000);
	const backupPath = `${filePath}.bak.${ts}`;
	try {
		await fs.writeFile(backupPath, raw, "utf-8");
	} catch {
		return { driftDetected: true, backupPath: `${backupPath} (BACKUP FAILED — file unchanged on disk)` };
	}
	return { driftDetected: true, backupPath };
}

export function buildDriftError(
	filePath: string,
	backupPath: string,
): { success: false; error: string; drift_backup: string; remediation: string } {
	return {
		success: false,
		error:
			`Refusing to write ${filePath.split(/[\\/]/).pop() ?? filePath}: file on disk has content that ` +
			`wouldn't round-trip through the memory tool (likely added by an external write — patch tool, ` +
			`shell append, manual edit, or a concurrent session). A snapshot was saved to ${backupPath}. ` +
			`Resolve the drift first — either rewrite the file as a clean §-delimited list of entries, or move ` +
			`the extra content out — then retry. This guard exists to prevent silent data loss.`,
		drift_backup: backupPath,
		remediation:
			`Open the .bak file, integrate the missing entries into the memory tool one at a time via ` +
			`memory(action=add, content=...), then remove or rewrite the original file to a clean state.`,
	};
}
