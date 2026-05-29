import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createClipboardTool } from "../src/core/tools/clipboard.ts";

const mocks = vi.hoisted(() => ({
	copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
	readFromClipboard: vi.fn<() => Promise<string>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({
	copyToClipboard: mocks.copyToClipboard,
	readFromClipboard: mocks.readFromClipboard,
}));

const clipboardTool = createClipboardTool();

beforeEach(() => {
	mocks.copyToClipboard.mockReset();
	mocks.readFromClipboard.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("clipboard tool", () => {
	test("read returns clipboard text", async () => {
		mocks.readFromClipboard.mockResolvedValue("hello world");

		const result = await clipboardTool.execute("call-1", { action: "read" });
		const text = result.content.find((part) => part.type === "text")?.text ?? "";

		expect(text).toBe("hello world");
		expect(result.details?.bytes).toBeGreaterThan(0);
	});

	test("read reports empty clipboard", async () => {
		mocks.readFromClipboard.mockResolvedValue("");

		const result = await clipboardTool.execute("call-2", { action: "read" });
		const text = result.content.find((part) => part.type === "text")?.text ?? "";

		expect(text).toBe("Clipboard is empty.");
	});

	test("write copies text to clipboard", async () => {
		mocks.copyToClipboard.mockResolvedValue(undefined);

		const result = await clipboardTool.execute("call-3", { action: "write", text: "copy me" });
		const text = result.content.find((part) => part.type === "text")?.text ?? "";

		expect(mocks.copyToClipboard).toHaveBeenCalledWith("copy me");
		expect(text).toContain("Copied to clipboard");
	});

	test("write append combines with existing clipboard text", async () => {
		mocks.readFromClipboard.mockResolvedValue("prefix-");
		mocks.copyToClipboard.mockResolvedValue(undefined);

		const result = await clipboardTool.execute("call-4", { action: "write", text: "suffix", append: true });
		const text = result.content.find((part) => part.type === "text")?.text ?? "";

		expect(mocks.copyToClipboard).toHaveBeenCalledWith("prefix-suffix");
		expect(text).toContain("Appended to clipboard");
		expect(result.details?.appended).toBe(true);
	});

	test("write requires text", async () => {
		await expect(clipboardTool.execute("call-5", { action: "write" })).rejects.toThrow(
			"text is required for write action",
		);
	});
});
