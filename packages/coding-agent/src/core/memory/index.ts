export { atomicWrite } from "./atomic-write.ts";
export {
	buildDriftError,
	type DriftResult,
	detectExternalDrift,
	ENTRY_DELIMITER,
	parseEntries,
	serializeEntries,
} from "./drift.ts";
export { withFileLock } from "./file-lock.ts";
export {
	DEFAULT_MEMORY_CHAR_LIMIT,
	DEFAULT_USER_CHAR_LIMIT,
	type MemoryError,
	type MemoryResult,
	MemoryStore,
	type MemoryStoreOptions,
	type MemorySuccess,
} from "./memory-store.ts";
export {
	createMemoryTool,
	createMemoryToolDefinition,
	type MemoryToolDetails,
	type MemoryToolInput,
} from "./memory-tool.ts";
export {
	getMemoryDir,
	getMemoryFilePath,
	getMemoryLockPath,
	getSoulPath,
	type MemoryTarget,
} from "./paths.ts";
export { MEMORY_GUIDANCE } from "./prompt-strings.ts";
export { DEFAULT_AGENT_IDENTITY, loadSoulMd } from "./soul.ts";
export {
	firstThreatMessage,
	INVISIBLE_CHARS,
	scanForThreats,
	type ThreatScope,
} from "./threat-patterns.ts";
