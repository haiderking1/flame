import { join } from "node:path";
import { getFlameHome } from "../../utils/flame-home.ts";

export function getSkillsDir(): string {
	return join(getFlameHome(), "skills");
}

export function getSkillBundlesDir(): string {
	return join(getFlameHome(), "skill-bundles");
}

export function getSkillsPromptSnapshotPath(): string {
	return join(getFlameHome(), ".skills_prompt_snapshot.json");
}

/** Legacy agent config skills dir (~/.flame/agent/skills). Read-only scan compat. */
export function getLegacyAgentSkillsDir(agentDir: string): string {
	return join(agentDir, "skills");
}
