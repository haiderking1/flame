import { join } from "node:path";
import { getFlameHome } from "../../utils/flame-home.ts";

export type MemoryTarget = "memory" | "user";

export function getMemoryDir(): string {
	return join(getFlameHome(), "memories");
}

export function getSoulPath(): string {
	return join(getFlameHome(), "SOUL.md");
}

export function getMemoryFilePath(target: MemoryTarget): string {
	return join(getMemoryDir(), target === "user" ? "USER.md" : "MEMORY.md");
}

export function getMemoryLockPath(target: MemoryTarget): string {
	return `${getMemoryFilePath(target)}.lock`;
}
