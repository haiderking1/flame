import { resolve } from "node:path";

export function hasTraversalComponent(filePath: string): boolean {
	const parts = filePath.split(/[/\\]/);
	return parts.some((part) => part === "..");
}

export function isPathWithinDir(filePath: string, baseDir: string): boolean {
	const resolvedBase = resolve(baseDir);
	const resolvedTarget = resolve(filePath);
	if (resolvedTarget === resolvedBase) {
		return true;
	}
	const sep = process.platform === "win32" ? "\\" : "/";
	const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
	return resolvedTarget.startsWith(prefix);
}

export function validateWithinDir(targetPath: string, baseDir: string): string | null {
	const resolvedBase = resolve(baseDir);
	const resolvedTarget = resolve(resolvedBase, targetPath);
	if (!isPathWithinDir(resolvedTarget, resolvedBase)) {
		return "Path escapes the skill directory.";
	}
	return null;
}
