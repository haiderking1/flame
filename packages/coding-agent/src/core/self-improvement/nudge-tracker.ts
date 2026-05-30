/**
 * Cadence tracker for the self-improvement loop's two nudge gates.
 *
 * Ported from hermes-agent's `_turns_since_memory` / `_iters_since_skill`
 * counters (`agent/conversation_loop.py`, `agent/agent_init.py`):
 *
 *  - Memory review is gated on USER TURNS: incremented once per user prompt
 *    (pre-loop), fires when it reaches `memoryNudgeInterval`.
 *  - Skill review is gated on TOOL-CALL ITERATIONS: incremented per executed
 *    tool call (flame's per-iteration analog), checked at run end, and reset
 *    whenever `skill_manage` is actually used — there's no point nudging a
 *    skill review when the agent already updated a skill this session.
 *
 * An interval of 0 disables that gate. State lives on the AgentSession (one
 * tracker per session) so counters persist across `prompt()` calls.
 */
export interface NudgeTrackerOptions {
	/** User turns between memory reviews. 0 disables. */
	memoryNudgeInterval: number;
	/** Tool-call iterations between skill reviews. 0 disables. */
	skillNudgeInterval: number;
}

export class NudgeTracker {
	readonly memoryNudgeInterval: number;
	readonly skillNudgeInterval: number;
	private _turnsSinceMemory = 0;
	private _itersSinceSkill = 0;

	constructor(options: NudgeTrackerOptions) {
		this.memoryNudgeInterval = Math.max(0, Math.floor(options.memoryNudgeInterval));
		this.skillNudgeInterval = Math.max(0, Math.floor(options.skillNudgeInterval));
	}

	/**
	 * Call once at the start of each user prompt. Increments the memory counter
	 * and returns true (consuming the counter) when a memory review is due.
	 */
	onUserTurnStart(): boolean {
		if (this.memoryNudgeInterval <= 0) {
			return false;
		}
		this._turnsSinceMemory++;
		if (this._turnsSinceMemory >= this.memoryNudgeInterval) {
			this._turnsSinceMemory = 0;
			return true;
		}
		return false;
	}

	/** Call once per executed tool-call iteration. */
	onToolIteration(): void {
		if (this.skillNudgeInterval <= 0) {
			return;
		}
		this._itersSinceSkill++;
	}

	/**
	 * Call at the end of a run. Returns true (consuming the counter) when a
	 * skill review is due.
	 */
	consumeSkillReviewDue(): boolean {
		if (this.skillNudgeInterval <= 0) {
			return false;
		}
		if (this._itersSinceSkill >= this.skillNudgeInterval) {
			this._itersSinceSkill = 0;
			return true;
		}
		return false;
	}

	/** Reset the skill counter when `skill_manage` is actually used. */
	onSkillManageUsed(): void {
		this._itersSinceSkill = 0;
	}

	/** Current tool-iteration counter (exposed for tests). */
	get itersSinceSkill(): number {
		return this._itersSinceSkill;
	}

	/** Current user-turn counter (exposed for tests). */
	get turnsSinceMemory(): number {
		return this._turnsSinceMemory;
	}
}
