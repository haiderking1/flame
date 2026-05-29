export const EXCLUDED_SKILL_DIRS = new Set([
	".git",
	".github",
	".hub",
	".archive",
	".venv",
	"venv",
	"node_modules",
	"site-packages",
	"__pycache__",
	".tox",
	".nox",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
]);

export const PLATFORM_MAP: Record<string, string> = {
	macos: "darwin",
	linux: "linux",
	windows: "win32",
};

export const INJECTION_PATTERNS: readonly string[] = [
	"ignore previous instructions",
	"ignore all previous",
	"you are now",
	"disregard your",
	"forget your instructions",
	"new instructions:",
	"system prompt:",
	"<system>",
	"]]>",
];

export const SKILLS_PROMPT_CACHE_MAX = 8;

export const SKILLS_SNAPSHOT_VERSION = 1;

export const INLINE_SHELL_MAX_OUTPUT = 4000;

/** Max SKILL.md body size for skill_manage writes (hermes parity). */
export const MAX_SKILL_CONTENT_CHARS = 100_000;

/** Max supporting file size for skill_manage write_file (1 MiB). */
export const MAX_SKILL_FILE_BYTES = 1_048_576;

/** Subdirectories allowed for write_file/remove_file. */
export const ALLOWED_SKILL_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

/** skill_manage name/category validation (hermes — allows dots and underscores). */
export const SKILL_MANAGE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
