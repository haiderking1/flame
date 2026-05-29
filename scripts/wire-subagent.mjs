import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = join(repoRoot, "packages/coding-agent/examples/extensions/subagent");
const agentDir = join(homedir(), ".flame", "agent");
const extensionDir = join(agentDir, "extensions", "subagent");
const agentsDir = join(agentDir, "agents");
const promptsDir = join(agentDir, "prompts");
const modelsPath = join(agentDir, "models.json");

mkdirSync(extensionDir, { recursive: true });
mkdirSync(agentsDir, { recursive: true });
mkdirSync(promptsDir, { recursive: true });

cpSync(join(src, "index.ts"), join(extensionDir, "index.ts"));
cpSync(join(src, "agents.ts"), join(extensionDir, "agents.ts"));

for (const file of readdirSync(join(src, "agents")).filter((name) => name.endsWith(".md"))) {
	cpSync(join(src, "agents", file), join(agentsDir, file));
}

for (const file of readdirSync(join(src, "prompts")).filter((name) => name.endsWith(".md"))) {
	cpSync(join(src, "prompts", file), join(promptsDir, file));
}

if (existsSync(modelsPath)) {
	try {
		const existing = JSON.parse(readFileSync(modelsPath, "utf-8"));
		const ollama = existing.providers?.ollama;
		const baseUrl = typeof ollama?.baseUrl === "string" ? ollama.baseUrl : "";
		if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
			delete existing.providers.ollama;
			if (Object.keys(existing.providers ?? {}).length === 0) {
				existing.providers = {};
			}
			writeFileSync(modelsPath, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
			console.log(`Removed local Ollama override from ${modelsPath}`);
		}
	} catch {
		console.warn(`Skipped models.json cleanup; could not parse ${modelsPath}`);
	}
}

console.log("Subagent extension wired:");
console.log(`  ${extensionDir}`);
console.log(`  ${agentsDir} (${readdirSync(agentsDir).filter((f) => f.endsWith(".md")).length} agents)`);
console.log(`  ${promptsDir} (${readdirSync(promptsDir).filter((f) => f.endsWith(".md")).length} prompts)`);
console.log("Subagents inherit the parent session model unless an agent sets model/provider or you use FLAME_SUBAGENT_* env vars.");
