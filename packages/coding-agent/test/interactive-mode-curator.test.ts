import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

const { mockPinSkill, mockUnpinSkill, mockSetCuratorPaused, mockMaybeRunCurator } = vi.hoisted(() => ({
	mockPinSkill: vi.fn().mockResolvedValue(undefined),
	mockUnpinSkill: vi.fn().mockResolvedValue(undefined),
	mockSetCuratorPaused: vi.fn().mockResolvedValue(undefined),
	mockMaybeRunCurator: vi.fn(() => ({ ran: true, summary: "1 stale" })),
}));

vi.mock("../src/core/self-improvement/index.js", () => ({
	loadCuratorState: vi.fn(() => ({
		paused: false,
		runCount: 2,
		lastRunAt: "2026-05-30T00:00:00.000Z",
		lastRunSummary: "completed successfully",
		pinned: ["test-skill"],
		states: {},
	})),
	setCuratorPaused: mockSetCuratorPaused,
	pinSkill: mockPinSkill,
	unpinSkill: mockUnpinSkill,
	listSnapshots: vi.fn(() => ["20260530-001234"]),
	restoreSkillsSnapshot: vi.fn(() => true),
	maybeRunCurator: mockMaybeRunCurator,
}));

describe("InteractiveMode /curator command", () => {
	test("handles status subcommand", async () => {
		const fakeThis = {
			settingsManager: {
				getCuratorSettings: () => ({
					enabled: true,
					intervalHours: 168,
					staleAfterDays: 30,
					archiveAfterDays: 90,
				}),
			},
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
		};

		const handleCuratorCommand = Reflect.get(InteractiveMode.prototype, "handleCuratorCommand") as (
			this: any,
			text: string,
		) => Promise<void>;

		await handleCuratorCommand.call(fakeThis, "/curator status");

		expect(fakeThis.showStatus).toHaveBeenCalledTimes(1);
		const statusText = fakeThis.showStatus.mock.calls[0][0];
		expect(statusText).toContain("Curator Status:");
		expect(statusText).toContain("Enabled: yes");
		expect(statusText).toContain("Pinned Skills: test-skill");
	});

	test("handles pin and unpin subcommands", async () => {
		const fakeThis = {
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
		};

		const handleCuratorCommand = Reflect.get(InteractiveMode.prototype, "handleCuratorCommand") as (
			this: any,
			text: string,
		) => Promise<void>;

		await handleCuratorCommand.call(fakeThis, "/curator pin my-skill");
		expect(mockPinSkill).toHaveBeenCalledWith("my-skill");
		expect(fakeThis.showStatus).toHaveBeenCalledWith(expect.stringContaining('Pinned skill "my-skill"'));

		await handleCuratorCommand.call(fakeThis, "/curator unpin my-skill");
		expect(mockUnpinSkill).toHaveBeenCalledWith("my-skill");
		expect(fakeThis.showStatus).toHaveBeenCalledWith(expect.stringContaining('Unpinned skill "my-skill"'));
	});

	test("handles pause and resume subcommands", async () => {
		const fakeThis = {
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
		};

		const handleCuratorCommand = Reflect.get(InteractiveMode.prototype, "handleCuratorCommand") as (
			this: any,
			text: string,
		) => Promise<void>;

		await handleCuratorCommand.call(fakeThis, "/curator pause");
		expect(mockSetCuratorPaused).toHaveBeenCalledWith(true);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Curator paused");

		await handleCuratorCommand.call(fakeThis, "/curator resume");
		expect(mockSetCuratorPaused).toHaveBeenCalledWith(false);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Curator resumed");
	});

	test("handles run subcommand with and without dry-run", async () => {
		const fakeThis = {
			settingsManager: {
				getCuratorSettings: () => ({ enabled: true }),
				getSkillsGuardAgentCreated: () => false,
			},
			session: {
				sessionId: "test-sess",
				baseSystemPrompt: "prom",
				agent: {
					state: { model: { id: "m" }, thinkingLevel: "off" },
					streamFn: vi.fn(),
					convertToLlm: vi.fn(),
					transport: "sse",
					thinkingBudgets: undefined,
					maxRetryDelayMs: 1000,
				},
			},
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
		};

		const handleCuratorCommand = Reflect.get(InteractiveMode.prototype, "handleCuratorCommand") as (
			this: any,
			text: string,
		) => Promise<void>;

		await handleCuratorCommand.call(fakeThis, "/curator run");
		expect(mockMaybeRunCurator).toHaveBeenLastCalledWith(
			expect.objectContaining({
				force: true,
				dryRun: false,
			}),
		);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Starting manual curator pass...");
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Curator run completed: 1 stale");

		await handleCuratorCommand.call(fakeThis, "/curator run --dry-run");
		expect(mockMaybeRunCurator).toHaveBeenLastCalledWith(
			expect.objectContaining({
				force: true,
				dryRun: true,
			}),
		);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Starting manual curator dry-run pass...");
	});
});
