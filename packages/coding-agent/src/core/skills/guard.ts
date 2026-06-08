import { readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join, relative } from "node:path";
import { INVISIBLE_CHARS } from "../memory/threat-patterns.ts";
import { SKILL_GUARD_THREAT_PATTERNS, type SkillGuardSeverity } from "./guard-patterns.ts";

export {
	getSkillGuardThreatPatternCount,
	HERMES_THREAT_PATTERN_COUNT,
	SKILL_GUARD_THREAT_PATTERNS,
	type SkillGuardSeverity,
	type SkillThreatPattern,
} from "./guard-patterns.ts";

export interface SkillGuardFinding {
	patternId: string;
	severity: SkillGuardSeverity;
	category: string;
	file: string;
	line: number;
	match: string;
	description: string;
}

export interface SkillScanResult {
	skillName: string;
	source: string;
	trustLevel: string;
	verdict: "safe" | "caution" | "dangerous";
	findings: SkillGuardFinding[];
	scannedAt: string;
	summary: string;
}

export type SkillTrustLevel = "builtin" | "trusted" | "community" | "agent-created";

const INSTALL_POLICY: Record<
	SkillTrustLevel,
	readonly ["allow" | "block" | "ask", "allow" | "block" | "ask", "allow" | "block" | "ask"]
> = {
	builtin: ["allow", "allow", "allow"],
	trusted: ["allow", "allow", "block"],
	community: ["allow", "block", "block"],
	"agent-created": ["allow", "allow", "ask"],
};

const VERDICT_INDEX: Record<string, number> = { safe: 0, caution: 1, dangerous: 2 };

const SCANNABLE_EXTENSIONS = new Set([
	".md",
	".txt",
	".py",
	".sh",
	".bash",
	".js",
	".ts",
	".rb",
	".yaml",
	".yml",
	".json",
	".toml",
	".cfg",
	".ini",
	".conf",
	".html",
	".css",
	".xml",
	".tex",
	".r",
	".jl",
	".pl",
	".php",
]);

const SUSPICIOUS_BINARY_EXTENSIONS = new Set([
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".dat",
	".com",
	".msi",
	".dmg",
	".app",
	".deb",
	".rpm",
]);

const MAX_FILE_COUNT = 50;
const MAX_TOTAL_SIZE_KB = 1024;
const MAX_SINGLE_FILE_KB = 256;

/** Hermes skills_guard.py _unicode_char_name — full invisible-char label map. */
function unicodeCharName(char: string): string {
	const names: Record<string, string> = {
		"\u200b": "zero-width space",
		"\u200c": "zero-width non-joiner",
		"\u200d": "zero-width joiner",
		"\u2060": "word joiner",
		"\u2062": "invisible times",
		"\u2063": "invisible separator",
		"\u2064": "invisible plus",
		"\ufeff": "BOM/zero-width no-break space",
		"\u202a": "LTR embedding",
		"\u202b": "RTL embedding",
		"\u202c": "pop directional",
		"\u202d": "LTR override",
		"\u202e": "RTL override",
		"\u2066": "LTR isolate",
		"\u2067": "RTL isolate",
		"\u2068": "first strong isolate",
		"\u2069": "pop directional isolate",
	};
	return names[char] ?? `U+${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "????"}`;
}

function resolveTrustLevel(source: string): SkillTrustLevel {
	const normalized = source.replace(/^(skills-sh\/|skills\.sh\/|skils-sh\/|skils\.sh\/)/i, "");
	if (normalized === "agent-created") return "agent-created";
	if (normalized === "official") return "builtin";
	const trusted = ["openai/skills", "anthropics/skills", "huggingface/skills"];
	for (const repo of trusted) {
		if (normalized === repo || normalized.startsWith(`${repo}/`)) {
			return "trusted";
		}
	}
	return "community";
}

function determineVerdict(findings: SkillGuardFinding[]): SkillScanResult["verdict"] {
	if (findings.length === 0) return "safe";
	if (findings.some((f) => f.severity === "critical")) return "dangerous";
	if (findings.some((f) => f.severity === "high")) return "caution";
	return "safe";
}

export function scanSkillFile(filePath: string, relPath: string): SkillGuardFinding[] {
	const baseName = filePath.split(/[/\\]/).pop() ?? "";
	const ext = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".")).toLowerCase() : "";
	if (!SCANNABLE_EXTENSIONS.has(ext) && baseName !== "SKILL.md") {
		return [];
	}

	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return [];
	}

	const findings: SkillGuardFinding[] = [];
	const lines = content.split("\n");
	const seen = new Set<string>();

	for (const { regex, patternId, severity, category, description } of SKILL_GUARD_THREAT_PATTERNS) {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const key = `${patternId}:${i + 1}`;
			if (seen.has(key)) continue;
			if (regex.test(line)) {
				seen.add(key);
				let matchedText = line.trim();
				if (matchedText.length > 120) {
					matchedText = `${matchedText.slice(0, 117)}...`;
				}
				findings.push({
					patternId,
					severity,
					category,
					file: relPath,
					line: i + 1,
					match: matchedText,
					description,
				});
			}
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const char of INVISIBLE_CHARS) {
			if (line.includes(char)) {
				findings.push({
					patternId: "invisible_unicode",
					severity: "high",
					category: "injection",
					file: relPath,
					line: i + 1,
					match: `U+${char.codePointAt(0)?.toString(16).padStart(4, "0")} (${unicodeCharName(char)})`,
					description: `invisible unicode character ${unicodeCharName(char)} (possible text hiding/injection)`,
				});
				break;
			}
		}
	}

	return findings;
}

function checkStructure(skillDir: string): SkillGuardFinding[] {
	const findings: SkillGuardFinding[] = [];
	let fileCount = 0;
	let totalSize = 0;

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			let st: Stats;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(full);
				continue;
			}
			if (!st.isFile()) continue;
			fileCount++;
			totalSize += st.size;
			const rel = relative(skillDir, full).split(/[/\\]/).join("/");
			if (st.size > MAX_SINGLE_FILE_KB * 1024) {
				findings.push({
					patternId: "oversized_file",
					severity: "medium",
					category: "structural",
					file: rel,
					line: 0,
					match: `${Math.floor(st.size / 1024)}KB`,
					description: `file is ${Math.floor(st.size / 1024)}KB (limit: ${MAX_SINGLE_FILE_KB}KB)`,
				});
			}
			const ext = entry.includes(".") ? entry.slice(entry.lastIndexOf(".")).toLowerCase() : "";
			if (SUSPICIOUS_BINARY_EXTENSIONS.has(ext)) {
				findings.push({
					patternId: "binary_file",
					severity: "critical",
					category: "structural",
					file: rel,
					line: 0,
					match: `binary: ${ext}`,
					description: `binary/executable file (${ext}) should not be in a skill`,
				});
			}
		}
	}

	walk(skillDir);

	if (fileCount > MAX_FILE_COUNT) {
		findings.push({
			patternId: "too_many_files",
			severity: "medium",
			category: "structural",
			file: "(directory)",
			line: 0,
			match: `${fileCount} files`,
			description: `skill has ${fileCount} files (limit: ${MAX_FILE_COUNT})`,
		});
	}
	if (totalSize > MAX_TOTAL_SIZE_KB * 1024) {
		findings.push({
			patternId: "oversized_skill",
			severity: "high",
			category: "structural",
			file: "(directory)",
			line: 0,
			match: `${Math.floor(totalSize / 1024)}KB total`,
			description: `skill is ${Math.floor(totalSize / 1024)}KB total (limit: ${MAX_TOTAL_SIZE_KB}KB)`,
		});
	}

	return findings;
}

export function scanSkill(skillPath: string, source = "community"): SkillScanResult {
	const skillName = skillPath.split(/[/\\]/).pop() ?? skillPath;
	const trustLevel = resolveTrustLevel(source);
	const allFindings: SkillGuardFinding[] = [...checkStructure(skillPath)];

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			let st: Stats;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(full);
			} else if (st.isFile()) {
				const rel = relative(skillPath, full).split(/[/\\]/).join("/");
				allFindings.push(...scanSkillFile(full, rel));
			}
		}
	}

	walk(skillPath);

	const verdict = determineVerdict(allFindings);
	const categories = [...new Set(allFindings.map((f) => f.category))].sort();
	const summary =
		allFindings.length === 0
			? `${skillName}: clean scan, no threats detected`
			: `${skillName}: ${verdict} — ${allFindings.length} finding(s) in ${categories.join(", ")}`;

	return {
		skillName,
		source,
		trustLevel,
		verdict,
		findings: allFindings,
		scannedAt: new Date().toISOString(),
		summary,
	};
}

export function shouldAllowInstall(
	result: SkillScanResult,
	force = false,
): { allowed: boolean | null; reason: string } {
	const policy = INSTALL_POLICY[result.trustLevel as SkillTrustLevel] ?? INSTALL_POLICY.community;
	const vi = VERDICT_INDEX[result.verdict] ?? 2;
	const decision = policy[vi];

	if (decision === "allow") {
		return { allowed: true, reason: `Allowed (${result.trustLevel} source, ${result.verdict} verdict)` };
	}

	if (
		force &&
		!(result.verdict === "dangerous" && (result.trustLevel === "community" || result.trustLevel === "trusted"))
	) {
		return {
			allowed: true,
			reason: `Force-installed despite ${result.verdict} verdict (${result.findings.length} findings)`,
		};
	}

	if (decision === "ask") {
		return {
			allowed: null,
			reason: `Requires confirmation (${result.trustLevel} source + ${result.verdict} verdict, ${result.findings.length} findings)`,
		};
	}

	if (result.verdict === "dangerous" && (result.trustLevel === "community" || result.trustLevel === "trusted")) {
		return {
			allowed: false,
			reason: `Blocked (${result.trustLevel} source + dangerous verdict, ${result.findings.length} findings). --force does not override a dangerous verdict.`,
		};
	}
	return {
		allowed: false,
		reason: `Blocked (${result.trustLevel} source + ${result.verdict} verdict, ${result.findings.length} findings). Use --force to override.`,
	};
}

export function formatScanReport(result: SkillScanResult): string {
	const lines: string[] = [];
	lines.push(
		`Scan: ${result.skillName} (${result.source}/${result.trustLevel})  Verdict: ${result.verdict.toUpperCase()}`,
	);

	if (result.findings.length > 0) {
		const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
		const sorted = [...result.findings].sort(
			(a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
		);
		for (const f of sorted) {
			const sev = f.severity.toUpperCase().padEnd(8);
			const cat = f.category.padEnd(14);
			const loc = `${f.file}:${f.line}`.padEnd(30);
			lines.push(`  ${sev} ${cat} ${loc} "${f.match.slice(0, 60)}"`);
		}
		lines.push("");
	}

	const { allowed, reason } = shouldAllowInstall(result);
	const status = allowed === true ? "ALLOWED" : allowed === null ? "NEEDS CONFIRMATION" : "BLOCKED";
	lines.push(`Decision: ${status} — ${reason}`);
	return lines.join("\n");
}

/** Run security scan when guard is enabled; returns error message or null. */
export function securityScanSkillDir(skillDir: string, guardEnabled: boolean): string | null {
	if (!guardEnabled) {
		return null;
	}
	const result = scanSkill(skillDir, "agent-created");
	const { allowed, reason } = shouldAllowInstall(result);
	if (allowed === false || allowed === null) {
		const report = formatScanReport(result);
		return `Security scan blocked this skill (${reason}):\n${report}`;
	}
	return null;
}
