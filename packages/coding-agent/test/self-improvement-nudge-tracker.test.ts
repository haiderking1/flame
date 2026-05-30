import { describe, expect, it } from "vitest";
import { NudgeTracker } from "../src/core/self-improvement/nudge-tracker.ts";

describe("NudgeTracker memory cadence (per user turn)", () => {
	it("fires every memoryNudgeInterval user turns and resets", () => {
		const t = new NudgeTracker({ memoryNudgeInterval: 3, skillNudgeInterval: 0 });
		expect(t.onUserTurnStart()).toBe(false); // 1
		expect(t.onUserTurnStart()).toBe(false); // 2
		expect(t.onUserTurnStart()).toBe(true); // 3 -> fire + reset
		expect(t.onUserTurnStart()).toBe(false); // 1
		expect(t.onUserTurnStart()).toBe(false); // 2
		expect(t.onUserTurnStart()).toBe(true); // 3 -> fire again
	});

	it("interval 0 disables the memory gate", () => {
		const t = new NudgeTracker({ memoryNudgeInterval: 0, skillNudgeInterval: 10 });
		for (let i = 0; i < 50; i++) {
			expect(t.onUserTurnStart()).toBe(false);
		}
	});
});

describe("NudgeTracker skill cadence (per tool-call iteration)", () => {
	it("becomes due after skillNudgeInterval tool iterations, then resets", () => {
		const t = new NudgeTracker({ memoryNudgeInterval: 0, skillNudgeInterval: 3 });
		t.onToolIteration();
		t.onToolIteration();
		expect(t.consumeSkillReviewDue()).toBe(false); // only 2
		t.onToolIteration();
		expect(t.consumeSkillReviewDue()).toBe(true); // 3 -> due + reset
		expect(t.consumeSkillReviewDue()).toBe(false); // reset
	});

	it("resets the skill counter when skill_manage is used", () => {
		const t = new NudgeTracker({ memoryNudgeInterval: 0, skillNudgeInterval: 3 });
		t.onToolIteration();
		t.onToolIteration();
		t.onToolIteration();
		t.onSkillManageUsed(); // a skill was just updated -> no nudge needed
		expect(t.consumeSkillReviewDue()).toBe(false);
		expect(t.itersSinceSkill).toBe(0);
	});

	it("interval 0 disables the skill gate and stops counting", () => {
		const t = new NudgeTracker({ memoryNudgeInterval: 0, skillNudgeInterval: 0 });
		for (let i = 0; i < 50; i++) {
			t.onToolIteration();
		}
		expect(t.itersSinceSkill).toBe(0);
		expect(t.consumeSkillReviewDue()).toBe(false);
	});
});

describe("NudgeTracker independence", () => {
	it("memory and skill counters are independent and persist across calls", () => {
		const t = new NudgeTracker({ memoryNudgeInterval: 2, skillNudgeInterval: 5 });
		t.onUserTurnStart(); // mem 1
		t.onToolIteration(); // skill 1
		t.onToolIteration(); // skill 2
		expect(t.turnsSinceMemory).toBe(1);
		expect(t.itersSinceSkill).toBe(2);
		expect(t.onUserTurnStart()).toBe(true); // mem 2 -> fire
		expect(t.itersSinceSkill).toBe(2); // skill counter untouched
	});
});
