import { describe, expect, it } from "vitest";
import {
	buildRenameSummary,
	type CapturedSkillCall,
	classifyRemovedSkills,
	extractAbsorbedDeclarations,
	needleInPathComponent,
	reconcileRemovedSkills,
} from "../src/core/self-improvement/consolidation-reconcile.ts";

describe("needleInPathComponent", () => {
	it("matches a complete filename stem or directory, normalising - and _", () => {
		expect(needleInPathComponent("api", "references/api.md")).toBe(true);
		expect(needleInPathComponent("open-webui", "references/open_webui.md")).toBe(true);
		expect(needleInPathComponent("api", "references/api-design.md")).toBe(false); // not a substring match
	});
});

describe("extractAbsorbedDeclarations", () => {
	it("captures absorbed_into from delete calls; empty string = prune; missing = skipped", () => {
		const calls: CapturedSkillCall[] = [
			{ action: "delete", name: "pdf-extract", absorbed_into: "document-tools" },
			{ action: "delete", name: "flaky", absorbed_into: "" },
			{ action: "delete", name: "no-decl" }, // omitted → not captured
			{ action: "patch", name: "document-tools", content: "..." }, // not a delete
		];
		const decls = extractAbsorbedDeclarations(calls);
		expect(decls.get("pdf-extract")).toBe("document-tools");
		expect(decls.get("flaky")).toBe("");
		expect(decls.has("no-decl")).toBe(false);
	});
});

describe("classifyRemovedSkills (heuristic)", () => {
	it("marks a removed skill consolidated when referenced from a surviving umbrella", () => {
		const calls: CapturedSkillCall[] = [
			{ action: "write_file", name: "document-tools", file_path: "references/pdf-extract.md", file_content: "..." },
		];
		const result = classifyRemovedSkills(
			["pdf-extract", "orphan"],
			["document-tools"],
			new Set(["document-tools"]),
			calls,
		);
		expect(result.consolidated.map((e) => e.name)).toEqual(["pdf-extract"]);
		expect(result.consolidated[0]!.into).toBe("document-tools");
		expect(result.pruned.map((e) => e.name)).toEqual(["orphan"]);
	});
});

describe("reconcileRemovedSkills", () => {
	it("absorbed_into declaration is authoritative over the heuristic", () => {
		// Heuristic would say nothing; the explicit declaration wins.
		const calls: CapturedSkillCall[] = [{ action: "delete", name: "a", absorbed_into: "umbrella" }];
		const result = reconcileRemovedSkills(["a"], ["umbrella"], new Set(["umbrella"]), calls);
		expect(result.consolidated).toEqual([{ name: "a", into: "umbrella", evidence: "declared via absorbed_into" }]);
		expect(result.pruned).toEqual([]);
	});

	it("absorbed_into='' forces pruned even if the heuristic finds a reference", () => {
		const calls: CapturedSkillCall[] = [
			{ action: "delete", name: "a", absorbed_into: "" },
			{ action: "write_file", name: "umbrella", file_path: "references/a.md", file_content: "x" },
		];
		const result = reconcileRemovedSkills(["a"], ["umbrella"], new Set(["umbrella"]), calls);
		expect(result.pruned).toEqual([{ name: "a" }]);
		expect(result.consolidated).toEqual([]);
	});
});

describe("buildRenameSummary", () => {
	it("formats consolidations, prunings, and a pin hint", () => {
		const summary = buildRenameSummary({
			consolidated: [{ name: "pdf", into: "docs" }],
			pruned: [{ name: "flaky" }],
		});
		expect(summary).toContain("archived 2 skill(s):");
		expect(summary).toContain("• pdf → docs");
		expect(summary).toContain("• flaky — pruned (stale)");
		expect(summary).toContain("/curator pin docs");
	});

	it("returns empty string when nothing was archived", () => {
		expect(buildRenameSummary({ consolidated: [], pruned: [] })).toBe("");
	});
});
