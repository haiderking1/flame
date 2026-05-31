/**
 * Consolidation / pruning reconciliation for curator runs.
 *
 * Faithful port of hermes-agent `agent/curator.py` (`_classify_removed_skills`,
 * `_extract_absorbed_into_declarations`, `_needle_in_path_component`, and the
 * `_reconcile_classification` priority). After the LLM consolidation pass, each
 * skill that disappeared this run is classified as either:
 *   - **consolidated** — its content was absorbed into a surviving "umbrella"
 *     skill (the content lives on under another name), or
 *   - **pruned** — it was archived for staleness with no forwarding target.
 *
 * Authoritative signal (matching hermes): the `absorbed_into` argument the model
 * passes to `skill_manage(action="delete")` — `<umbrella>` means consolidated,
 * `""` means pruned. When a removed skill has no such declaration, fall back to
 * a substring/path heuristic over the run's `skill_manage` tool calls.
 */

/** A `skill_manage` call captured from the consolidation fork's tool events. */
export interface CapturedSkillCall {
	action?: string;
	name?: string;
	file_path?: string;
	file_content?: string;
	content?: string;
	new_string?: string;
	absorbed_into?: string;
}

export interface ConsolidatedEntry {
	name: string;
	into: string;
	evidence?: string;
}

export interface ClassificationResult {
	consolidated: ConsolidatedEntry[];
	pruned: { name: string }[];
}

/**
 * Whether `needle` is a complete filename stem or directory name in `path`.
 * Avoids false positives where a short name is embedded in a longer filename
 * (e.g. "api" must not match "references/api-design.md"). Hyphens and
 * underscores are normalised so "open-webui" matches "open_webui.md".
 */
export function needleInPathComponent(needle: string, path: string): boolean {
	const normNeedle = needle.replace(/-/g, "_");
	for (const part of path.replace(/\\/g, "/").split("/")) {
		if (!part) {
			continue;
		}
		const stem = part.includes(".") ? part.slice(0, part.lastIndexOf(".")) : part;
		if (stem.replace(/-/g, "_") === normNeedle) {
			return true;
		}
	}
	return false;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Model-declared absorption targets from `skill_manage(delete, absorbed_into=…)`.
 * Returns a map of `name → into` where `into === ""` means explicit pruning.
 * Skills whose delete call omitted `absorbed_into` are not included — the caller
 * falls back to the heuristic for those.
 */
export function extractAbsorbedDeclarations(calls: CapturedSkillCall[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const args of calls) {
		if (args.action !== "delete") {
			continue;
		}
		const name = args.name;
		if (typeof name !== "string" || !name.trim()) {
			continue;
		}
		// Missing key means the model didn't declare intent; "" is meaningful.
		if (!("absorbed_into" in args) || args.absorbed_into === undefined) {
			continue;
		}
		out.set(name, typeof args.absorbed_into === "string" ? args.absorbed_into.trim() : "");
	}
	return out;
}

/**
 * Heuristic split of `removed` into consolidated vs pruned by scanning the run's
 * `skill_manage` calls for references to each removed skill from a surviving or
 * newly-created skill. Mirrors hermes' `_classify_removed_skills`.
 */
export function classifyRemovedSkills(
	removed: string[],
	added: string[],
	afterNames: Set<string>,
	calls: CapturedSkillCall[],
): ClassificationResult {
	const consolidated: ConsolidatedEntry[] = [];
	const pruned: { name: string }[] = [];
	const destinations = new Set<string>([...afterNames, ...added]);

	for (const name of removed) {
		if (!name) {
			continue;
		}
		const needles = new Set<string>([name, name.replace(/-/g, "_"), name.replace(/_/g, "-")]);
		let into: string | undefined;
		let evidence: string | undefined;

		for (const args of calls) {
			const target = args.name;
			if (typeof target !== "string" || !target || target === name) {
				continue;
			}
			if (!destinations.has(target)) {
				continue;
			}
			const haystacks: Array<[string, string]> = [];
			for (const key of ["file_path", "file_content", "content", "new_string"] as const) {
				const v = args[key];
				if (typeof v === "string") {
					haystacks.push([key, v]);
				}
			}
			let hit = false;
			for (const [key, hay] of haystacks) {
				for (const needle of needles) {
					if (!needle) {
						continue;
					}
					const matched =
						key === "file_path"
							? needleInPathComponent(needle, hay)
							: new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(hay);
					if (matched) {
						hit = true;
						evidence = `skill_manage action=${args.action ?? "?"} on '${target}' referenced '${name}' in ${hay.slice(0, 80)}`;
						break;
					}
				}
				if (hit) {
					break;
				}
			}
			if (hit) {
				into = target;
				break;
			}
		}

		if (into) {
			consolidated.push({ name, into, evidence });
		} else {
			pruned.push({ name });
		}
	}

	return { consolidated, pruned };
}

/**
 * Classify the skills removed during a consolidation run. The model's
 * `absorbed_into` declaration is authoritative; the substring heuristic fills in
 * any removed skill the model didn't explicitly declare.
 */
export function reconcileRemovedSkills(
	removed: string[],
	added: string[],
	afterNames: Set<string>,
	calls: CapturedSkillCall[],
): ClassificationResult {
	const declarations = extractAbsorbedDeclarations(calls);
	const destinations = new Set<string>([...afterNames, ...added]);
	const heuristic = classifyRemovedSkills(removed, added, afterNames, calls);
	const heuristicInto = new Map(heuristic.consolidated.map((e) => [e.name, e]));

	const consolidated: ConsolidatedEntry[] = [];
	const pruned: { name: string }[] = [];

	for (const name of removed) {
		if (!name) {
			continue;
		}
		const declared = declarations.get(name);
		if (declared !== undefined) {
			// Authoritative model declaration wins.
			if (declared && destinations.has(declared)) {
				consolidated.push({ name, into: declared, evidence: "declared via absorbed_into" });
			} else {
				pruned.push({ name });
			}
			continue;
		}
		const heur = heuristicInto.get(name);
		if (heur) {
			consolidated.push(heur);
		} else {
			pruned.push({ name });
		}
	}

	return { consolidated, pruned };
}

/**
 * User-facing "where did my skills go?" summary. Caps at 10 entries — the full
 * list is always in REPORT.md. Empty string when nothing was archived.
 */
export function buildRenameSummary(result: ClassificationResult): string {
	const total = result.consolidated.length + result.pruned.length;
	if (total === 0) {
		return "";
	}
	const SHOW = 10;
	const lines: string[] = [`archived ${total} skill(s):`];
	let shown = 0;
	for (const e of result.consolidated) {
		if (shown >= SHOW) break;
		lines.push(`  • ${e.name} → ${e.into}`);
		shown++;
	}
	for (const e of result.pruned) {
		if (shown >= SHOW) break;
		lines.push(`  • ${e.name} — pruned (stale)`);
		shown++;
	}
	if (total > SHOW) {
		lines.push(`  … and ${total - SHOW} more`);
	}
	if (result.consolidated.length > 0) {
		const umbrellas = [...new Set(result.consolidated.map((e) => e.into).filter(Boolean))].sort();
		if (umbrellas[0]) {
			lines.push(`keep an umbrella stable: /curator pin ${umbrellas[0]}`);
		}
	}
	return lines.join("\n");
}
