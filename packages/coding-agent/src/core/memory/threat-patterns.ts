export type ThreatScope = "all" | "context" | "strict";

interface PatternSpec {
	pattern: string;
	id: string;
	scope: ThreatScope;
}

const PATTERNS: PatternSpec[] = [
	{ pattern: "ignore\\s+(?:\\w+\\s+)*(previous|all|above|prior)\\s+(?:\\w+\\s+)*instructions", id: "prompt_injection", scope: "all" },
	{ pattern: "system\\s+prompt\\s+override", id: "sys_prompt_override", scope: "all" },
	{ pattern: "disregard\\s+(?:\\w+\\s+)*(your|all|any)\\s+(?:\\w+\\s+)*(instructions|rules|guidelines)", id: "disregard_rules", scope: "all" },
	{ pattern: "act\\s+as\\s+(if|though)\\s+(?:\\w+\\s+)*you\\s+(?:\\w+\\s+)*(have\\s+no|don't\\s+have)\\s+(?:\\w+\\s+)*(restrictions|limits|rules)", id: "bypass_restrictions", scope: "all" },
	{ pattern: "<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->", id: "html_comment_injection", scope: "all" },
	{ pattern: "<\\s*div\\s+style\\s*=\\s*[\"'][\\s\\S]*?display\\s*:\\s*none", id: "hidden_div", scope: "all" },
	{ pattern: "translate\\s+.*\\s+into\\s+.*\\s+and\\s+(execute|run|eval)", id: "translate_execute", scope: "all" },
	{ pattern: "do\\s+not\\s+(?:\\w+\\s+)*tell\\s+(?:\\w+\\s+)*the\\s+user", id: "deception_hide", scope: "all" },

	{ pattern: "you\\s+are\\s+(?:\\w+\\s+)*now\\s+(?:a|an|the)\\s+", id: "role_hijack", scope: "context" },
	{ pattern: "pretend\\s+(?:\\w+\\s+)*(you\\s+are|to\\s+be)\\s+", id: "role_pretend", scope: "context" },
	{ pattern: "output\\s+(?:\\w+\\s+)*(system|initial)\\s+prompt", id: "leak_system_prompt", scope: "context" },
	{ pattern: "(respond|answer|reply)\\s+without\\s+(?:\\w+\\s+)*(restrictions|limitations|filters|safety)", id: "remove_filters", scope: "context" },
	{ pattern: "you\\s+have\\s+been\\s+(?:\\w+\\s+)*(updated|upgraded|patched)\\s+to", id: "fake_update", scope: "context" },
	{ pattern: "\\bname\\s+yourself\\s+\\w+", id: "identity_override", scope: "context" },

	{ pattern: "register\\s+(as\\s+)?a?\\s*node", id: "c2_node_registration", scope: "context" },
	{ pattern: "(heartbeat|beacon|check[\\s\\-]?in)\\s+(to|with)\\s+", id: "c2_heartbeat", scope: "context" },
	{ pattern: "pull\\s+(down\\s+)?(?:new\\s+)?task(?:ing|s)?\\b", id: "c2_task_pull", scope: "context" },
	{ pattern: "connect\\s+to\\s+the\\s+network\\b", id: "c2_network_connect", scope: "context" },
	{ pattern: "you\\s+must\\s+(?:\\w+\\s+){0,3}(register|connect|report|beacon)\\b", id: "forced_action", scope: "context" },
	{ pattern: "only\\s+use\\s+one[\\s\\-]?liners?\\b", id: "anti_forensic_oneliner", scope: "context" },
	{ pattern: "never\\s+(?:\\w+\\s+)*(?:create|write)\\s+(?:\\w+\\s+)*(?:script|file)\\s+(?:\\w+\\s+)*disk", id: "anti_forensic_disk", scope: "context" },
	{ pattern: "unset\\s+\\w*(?:CLAUDE|CODEX|HERMES|FLAME|AGENT|OPENAI|ANTHROPIC)\\w*", id: "env_var_unset_agent", scope: "context" },

	{ pattern: "\\b(?:praxis|cobalt\\s*strike|sliver|havoc|mythic|metasploit|brainworm)\\b", id: "known_c2_framework", scope: "context" },
	{ pattern: "\\bc2\\s+(?:server|channel|infrastructure|beacon)\\b", id: "c2_explicit", scope: "context" },
	{ pattern: "\\bcommand\\s+and\\s+control\\b", id: "c2_explicit_long", scope: "context" },

	{ pattern: "curl\\s+[^\\n]*\\$\\{?\\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)", id: "exfil_curl", scope: "all" },
	{ pattern: "wget\\s+[^\\n]*\\$\\{?\\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)", id: "exfil_wget", scope: "all" },
	{ pattern: "cat\\s+[^\\n]*(\\.env|credentials|\\.netrc|\\.pgpass|\\.npmrc|\\.pypirc)", id: "read_secrets", scope: "all" },
	{ pattern: "(send|post|upload|transmit)\\s+.*\\s+(to|at)\\s+https?://", id: "send_to_url", scope: "strict" },
	{ pattern: "(include|output|print|share)\\s+(?:\\w+\\s+)*(conversation|chat\\s+history|previous\\s+messages|full\\s+context|entire\\s+context)", id: "context_exfil", scope: "strict" },

	{ pattern: "authorized_keys", id: "ssh_backdoor", scope: "strict" },
	{ pattern: "\\$HOME/\\.ssh|~/\\.ssh", id: "ssh_access", scope: "strict" },
	{ pattern: "\\$HOME/\\.flame/\\.env|~/\\.flame/\\.env", id: "flame_env", scope: "strict" },
	{ pattern: "(update|modify|edit|write|change|append|add\\s+to)\\s+.*(?:AGENTS\\.md|CLAUDE\\.md|\\.cursorrules|\\.clinerules)", id: "agent_config_mod", scope: "strict" },
	{ pattern: "(update|modify|edit|write|change|append|add\\s+to)\\s+.*\\.flame/(config\\.yaml|SOUL\\.md)", id: "flame_config_mod", scope: "strict" },

	{ pattern: "(?:api[_-]?key|token|secret|password)\\s*[=:]\\s*[\"'][A-Za-z0-9+/=_-]{20,}", id: "hardcoded_secret", scope: "strict" },
];

export const INVISIBLE_CHARS: ReadonlySet<string> = new Set([
	"​", // zero-width space
	"‌", // zero-width non-joiner
	"‍", // zero-width joiner
	"⁠", // word joiner
	"⁢", // invisible times
	"⁣", // invisible separator
	"⁤", // invisible plus
	"﻿", // zero-width no-break space (BOM)
	"‪", // left-to-right embedding
	"‫", // right-to-left embedding
	"‬", // pop directional formatting
	"‭", // left-to-right override
	"‮", // right-to-left override
	"⁦", // left-to-right isolate
	"⁧", // right-to-left isolate
	"⁨", // first strong isolate
	"⁩", // pop directional isolate
]);

interface CompiledEntry {
	regex: RegExp;
	id: string;
}

function compileForScopes(): Record<ThreatScope, CompiledEntry[]> {
	const all: CompiledEntry[] = [];
	const context: CompiledEntry[] = [];
	const strict: CompiledEntry[] = [];
	for (const spec of PATTERNS) {
		const entry: CompiledEntry = { regex: new RegExp(spec.pattern, "i"), id: spec.id };
		if (spec.scope === "all") {
			all.push(entry);
			context.push(entry);
			strict.push(entry);
		} else if (spec.scope === "context") {
			context.push(entry);
			strict.push(entry);
		} else {
			strict.push(entry);
		}
	}
	return { all, context, strict };
}

const COMPILED = compileForScopes();

export function scanForThreats(content: string, scope: ThreatScope = "context"): string[] {
	if (!content) return [];
	const findings: string[] = [];

	const seen = new Set<string>();
	for (const ch of content) {
		if (INVISIBLE_CHARS.has(ch) && !seen.has(ch)) {
			seen.add(ch);
			const code = ch.codePointAt(0) ?? 0;
			findings.push(`invisible_unicode_U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
		}
	}

	const patterns = COMPILED[scope];
	if (!patterns) throw new Error(`scanForThreats: unknown scope '${scope}'`);
	for (const { regex, id } of patterns) {
		if (regex.test(content)) findings.push(id);
	}

	return findings;
}

export function firstThreatMessage(content: string, scope: ThreatScope = "strict"): string | undefined {
	const findings = scanForThreats(content, scope);
	if (findings.length === 0) return undefined;
	const id = findings[0];
	if (id.startsWith("invisible_unicode_")) {
		const codepoint = id.slice("invisible_unicode_".length);
		return `Blocked: content contains invisible unicode character ${codepoint} (possible injection).`;
	}
	return `Blocked: content matches threat pattern '${id}'. Content is injected into the system prompt and must not contain injection or exfiltration payloads.`;
}
