/**
 * Self-improvement loop (hermes-agent Pillar 5).
 *
 * After qualifying turns, a forked review agent inspects the conversation and
 * writes durable memory + skill updates; an optional inactivity curator
 * consolidates and archives the skill library over time.
 */

export {
	type BackgroundReviewParams,
	type BackgroundReviewResult,
	DEFAULT_REVIEW_MAX_ITERATIONS,
	runBackgroundReview,
	summarizeReviewActions,
} from "./background-review.ts";
export {
	applyAutomaticTransitions,
	type CuratorRunResult,
	type CuratorSettings,
	type MaybeRunCuratorParams,
	maybeRunCurator,
	shouldRunNow,
	type TransitionCounts,
} from "./curator.ts";
export {
	type CuratorState,
	defaultCuratorState,
	loadCuratorState,
	pinSkill,
	type SkillLifecycleState,
	saveCuratorState,
	setCuratorPaused,
	unpinSkill,
} from "./curator-state.ts";
export { NudgeTracker, type NudgeTrackerOptions } from "./nudge-tracker.ts";
export {
	COMBINED_REVIEW_PROMPT,
	MEMORY_REVIEW_PROMPT,
	SKILL_REVIEW_PROMPT,
	selectReviewPrompt,
} from "./review-prompts.ts";
