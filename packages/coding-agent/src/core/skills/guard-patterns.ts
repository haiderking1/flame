/**
 * Full-fidelity port of hermes-agent tools/skills_guard.py THREAT_PATTERNS (120 entries).
 * Regex sources match Python re.search(..., re.IGNORECASE) via RegExp(..., "i").
 */

export type SkillGuardSeverity = "critical" | "high" | "medium" | "low";

export interface SkillThreatPattern {
	regex: RegExp;
	patternId: string;
	severity: SkillGuardSeverity;
	category: string;
	description: string;
}

function threat(def: {
	source: string;
	patternId: string;
	severity: SkillGuardSeverity;
	category: string;
	description: string;
}): SkillThreatPattern {
	const { source, patternId, severity, category, description } = def;
	return {
		regex: new RegExp(source, "i"),
		patternId,
		severity,
		category,
		description: description,
	};
}

/** Hermes THREAT_PATTERNS grouped by category (see skills_guard.py lines 86-488). */
export const SKILL_GUARD_THREAT_PATTERNS: SkillThreatPattern[] = [
	// -- Exfiltration: shell commands leaking secrets --
	threat({
		source: "curl\\s+[^\\n]*\\$\\{?\\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)",
		patternId: "env_exfil_curl",
		severity: "critical",
		category: "exfiltration",
		description: "curl command interpolating secret environment variable",
	}),
	threat({
		source: "wget\\s+[^\\n]*\\$\\{?\\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)",
		patternId: "env_exfil_wget",
		severity: "critical",
		category: "exfiltration",
		description: "wget command interpolating secret environment variable",
	}),
	threat({
		source: "fetch\\s*\\([^\\n]*\\$\\{?\\w*(KEY|TOKEN|SECRET|PASSWORD|API)",
		patternId: "env_exfil_fetch",
		severity: "critical",
		category: "exfiltration",
		description: "fetch() call interpolating secret environment variable",
	}),
	threat({
		source: "httpx?\\.(get|post|put|patch)\\s*\\([^\\n]*(KEY|TOKEN|SECRET|PASSWORD)",
		patternId: "env_exfil_httpx",
		severity: "critical",
		category: "exfiltration",
		description: "HTTP library call with secret variable",
	}),
	threat({
		source: "requests\\.(get|post|put|patch)\\s*\\([^\\n]*(KEY|TOKEN|SECRET|PASSWORD)",
		patternId: "env_exfil_requests",
		severity: "critical",
		category: "exfiltration",
		description: "requests library call with secret variable",
	}),

	// -- Exfiltration: reading credential stores --
	threat({
		source: "base64[^\\n]*env",
		patternId: "encoded_exfil",
		severity: "high",
		category: "exfiltration",
		description: "base64 encoding combined with environment access",
	}),
	threat({
		source: "\\$HOME/\\.ssh|~/\\.ssh",
		patternId: "ssh_dir_access",
		severity: "high",
		category: "exfiltration",
		description: "references user SSH directory",
	}),
	threat({
		source: "\\$HOME/\\.aws|~/\\.aws",
		patternId: "aws_dir_access",
		severity: "high",
		category: "exfiltration",
		description: "references user AWS credentials directory",
	}),
	threat({
		source: "\\$HOME/\\.gnupg|~/\\.gnupg",
		patternId: "gpg_dir_access",
		severity: "high",
		category: "exfiltration",
		description: "references user GPG keyring",
	}),
	threat({
		source: "\\$HOME/\\.kube|~/\\.kube",
		patternId: "kube_dir_access",
		severity: "high",
		category: "exfiltration",
		description: "references Kubernetes config directory",
	}),
	threat({
		source: "\\$HOME/\\.docker|~/\\.docker",
		patternId: "docker_dir_access",
		severity: "high",
		category: "exfiltration",
		description: "references Docker config (may contain registry creds)",
	}),
	// Python: r'\$HOME/\.hermes/\.env|\~/\.hermes/\.env'
	threat({
		source: "\\$HOME/\\.hermes/\\.env|~/\\.hermes/\\.env",
		patternId: "hermes_env_access",
		severity: "critical",
		category: "exfiltration",
		description: "directly references Hermes secrets file",
	}),
	// Flame runtime: same check for FLAME_HOME secrets (not in hermes; additive for flame installs)
	threat({
		source: "\\$HOME/\\.flame/\\.env|~/\\.flame/\\.env",
		patternId: "flame_env_access",
		severity: "critical",
		category: "exfiltration",
		description: "directly references Flame secrets file",
	}),
	threat({
		source: "cat\\s+[^\\n]*(\\.env|credentials|\\.netrc|\\.pgpass|\\.npmrc|\\.pypirc)",
		patternId: "read_secrets_file",
		severity: "critical",
		category: "exfiltration",
		description: "reads known secrets file",
	}),

	// -- Exfiltration: programmatic env access --
	threat({
		source: "printenv|env\\s*\\|",
		patternId: "dump_all_env",
		severity: "high",
		category: "exfiltration",
		description: "dumps all environment variables",
	}),
	// Python negative lookahead (?!\s*\.get\s*\(\s*["']PATH) — supported in JS RegExp
	threat({
		source: "os\\.environ\\b(?!\\s*\\.get\\s*\\(\\s*[\"']PATH)",
		patternId: "python_os_environ",
		severity: "high",
		category: "exfiltration",
		description: "accesses os.environ (potential env dump)",
	}),
	threat({
		source: "os\\.getenv\\s*\\(\\s*[^\\)]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)",
		patternId: "python_getenv_secret",
		severity: "critical",
		category: "exfiltration",
		description: "reads secret via os.getenv()",
	}),
	threat({
		source: "process\\.env\\[",
		patternId: "node_process_env",
		severity: "high",
		category: "exfiltration",
		description: "accesses process.env (Node.js environment)",
	}),
	threat({
		source: "ENV\\[.*(?:KEY|TOKEN|SECRET|PASSWORD)",
		patternId: "ruby_env_secret",
		severity: "critical",
		category: "exfiltration",
		description: "reads secret via Ruby ENV[]",
	}),

	// -- Exfiltration: DNS and staging --
	threat({
		source: "\\b(dig|nslookup|host)\\s+[^\\n]*\\$",
		patternId: "dns_exfil",
		severity: "critical",
		category: "exfiltration",
		description: "DNS lookup with variable interpolation (possible DNS exfiltration)",
	}),
	threat({
		source: ">\\s*/tmp/[^\\s]*\\s*&&\\s*(curl|wget|nc|python)",
		patternId: "tmp_staging",
		severity: "critical",
		category: "exfiltration",
		description: "writes to /tmp then exfiltrates",
	}),

	// -- Exfiltration: markdown/link based --
	threat({
		source: "!\\[.*\\]\\(https?:\\/\\/[^\\)]*\\$\\{?",
		patternId: "md_image_exfil",
		severity: "high",
		category: "exfiltration",
		description: "markdown image URL with variable interpolation (image-based exfil)",
	}),
	threat({
		source: "\\[.*\\]\\(https?:\\/\\/[^\\)]*\\$\\{?",
		patternId: "md_link_exfil",
		severity: "high",
		category: "exfiltration",
		description: "markdown link with variable interpolation",
	}),

	// -- Prompt injection --
	threat({
		source: "ignore\\s+(?:\\w+\\s+)*(previous|all|above|prior)\\s+instructions",
		patternId: "prompt_injection_ignore",
		severity: "critical",
		category: "injection",
		description: "prompt injection: ignore previous instructions",
	}),
	threat({
		source: "you\\s+are\\s+(?:\\w+\\s+)*now\\s+",
		patternId: "role_hijack",
		severity: "high",
		category: "injection",
		description: "attempts to override the agent's role",
	}),
	threat({
		source: "do\\s+not\\s+(?:\\w+\\s+)*tell\\s+(?:\\w+\\s+)*the\\s+user",
		patternId: "deception_hide",
		severity: "critical",
		category: "injection",
		description: "instructs agent to hide information from user",
	}),
	threat({
		source: "system\\s+(?:\\w+\\s+)*prompt\\s+(?:\\w+\\s+)*override",
		patternId: "sys_prompt_override",
		severity: "critical",
		category: "injection",
		description: "attempts to override the system prompt",
	}),
	threat({
		source: "pretend\\s+(?:\\w+\\s+)*(you\\s+are|to\\s+be)\\s+",
		patternId: "role_pretend",
		severity: "high",
		category: "injection",
		description: "attempts to make the agent assume a different identity",
	}),
	threat({
		source: "disregard\\s+(?:\\w+\\s+)*(your|all|any)\\s+(?:\\w+\\s+)*(instructions|rules|guidelines)",
		patternId: "disregard_rules",
		severity: "critical",
		category: "injection",
		description: "instructs agent to disregard its rules",
	}),
	threat({
		source: "output\\s+(?:\\w+\\s+)*(system|initial)\\s+prompt",
		patternId: "leak_system_prompt",
		severity: "high",
		category: "injection",
		description: "attempts to extract the system prompt",
	}),
	threat({
		source: "(when|if)\\s+no\\s*one\\s+is\\s+(watching|looking)",
		patternId: "conditional_deception",
		severity: "high",
		category: "injection",
		description: "conditional instruction to behave differently when unobserved",
	}),
	// Python: don\'t -> don't in JS string
	threat({
		source:
			"act\\s+as\\s+(if|though)\\s+(?:\\w+\\s+)*you\\s+(?:\\w+\\s+)*(have\\s+no|don't\\s+have)\\s+(?:\\w+\\s+)*(restrictions|limits|rules)",
		patternId: "bypass_restrictions",
		severity: "critical",
		category: "injection",
		description: "instructs agent to act without restrictions",
	}),
	threat({
		source: "translate\\s+.*\\s+into\\s+.*\\s+and\\s+(execute|run|eval)",
		patternId: "translate_execute",
		severity: "critical",
		category: "injection",
		description: "translate-then-execute evasion technique",
	}),
	threat({
		source: "<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->",
		patternId: "html_comment_injection",
		severity: "high",
		category: "injection",
		description: "hidden instructions in HTML comments",
	}),
	// Python [\s\S]*? non-greedy dotall — [\s\S] spans newlines in JS
	threat({
		source: "<\\s*div\\s+style\\s*=\\s*[\"'][\\s\\S]*?display\\s*:\\s*none",
		patternId: "hidden_div",
		severity: "high",
		category: "injection",
		description: "hidden HTML div (invisible instructions)",
	}),

	// -- Destructive operations --
	threat({
		source: "rm\\s+-rf\\s+/",
		patternId: "destructive_root_rm",
		severity: "critical",
		category: "destructive",
		description: "recursive delete from root",
	}),
	threat({
		source: "rm\\s+(-[^\\s]*)?r.*\\$HOME|\\brmdir\\s+.*\\$HOME",
		patternId: "destructive_home_rm",
		severity: "critical",
		category: "destructive",
		description: "recursive delete targeting home directory",
	}),
	threat({
		source: "chmod\\s+777",
		patternId: "insecure_perms",
		severity: "medium",
		category: "destructive",
		description: "sets world-writable permissions",
	}),
	threat({
		source: ">\\s*/etc/",
		patternId: "system_overwrite",
		severity: "critical",
		category: "destructive",
		description: "overwrites system configuration file",
	}),
	threat({
		source: "\\bmkfs\\b",
		patternId: "format_filesystem",
		severity: "critical",
		category: "destructive",
		description: "formats a filesystem",
	}),
	threat({
		source: "\\bdd\\s+.*if=.*of=/dev/",
		patternId: "disk_overwrite",
		severity: "critical",
		category: "destructive",
		description: "raw disk write operation",
	}),
	threat({
		source: "shutil\\.rmtree\\s*\\(\\s*[\"'/]",
		patternId: "python_rmtree",
		severity: "high",
		category: "destructive",
		description: "Python rmtree on absolute or root-relative path",
	}),
	threat({
		source: "truncate\\s+-s\\s*0\\s+/",
		patternId: "truncate_system",
		severity: "critical",
		category: "destructive",
		description: "truncates system file to zero bytes",
	}),

	// -- Persistence --
	threat({
		source: "\\bcrontab\\b",
		patternId: "persistence_cron",
		severity: "medium",
		category: "persistence",
		description: "modifies cron jobs",
	}),
	threat({
		source: "\\.(bashrc|zshrc|profile|bash_profile|bash_login|zprofile|zlogin)\\b",
		patternId: "shell_rc_mod",
		severity: "medium",
		category: "persistence",
		description: "references shell startup file",
	}),
	threat({
		source: "authorized_keys",
		patternId: "ssh_backdoor",
		severity: "critical",
		category: "persistence",
		description: "modifies SSH authorized keys",
	}),
	threat({
		source: "ssh-keygen",
		patternId: "ssh_keygen",
		severity: "medium",
		category: "persistence",
		description: "generates SSH keys",
	}),
	threat({
		source: "systemd.*\\.service|systemctl\\s+(enable|start)",
		patternId: "systemd_service",
		severity: "medium",
		category: "persistence",
		description: "references or enables systemd service",
	}),
	threat({
		source: "/etc/init\\.d/",
		patternId: "init_script",
		severity: "medium",
		category: "persistence",
		description: "references init.d startup script",
	}),
	threat({
		source: "launchctl\\s+load|LaunchAgents|LaunchDaemons",
		patternId: "macos_launchd",
		severity: "medium",
		category: "persistence",
		description: "macOS launch agent/daemon persistence",
	}),
	threat({
		source: "/etc/sudoers|visudo",
		patternId: "sudoers_mod",
		severity: "critical",
		category: "persistence",
		description: "modifies sudoers (privilege escalation)",
	}),
	threat({
		source: "git\\s+config\\s+--global\\s+",
		patternId: "git_config_global",
		severity: "medium",
		category: "persistence",
		description: "modifies global git configuration",
	}),

	// -- Network: reverse shells and tunnels --
	threat({
		source: "\\bnc\\s+-[lp]|ncat\\s+-[lp]|\\bsocat\\b",
		patternId: "reverse_shell",
		severity: "critical",
		category: "network",
		description: "potential reverse shell listener",
	}),
	threat({
		source: "\\bngrok\\b|\\blocaltunnel\\b|\\bserveo\\b|\\bcloudflared\\b",
		patternId: "tunnel_service",
		severity: "high",
		category: "network",
		description: "uses tunneling service for external access",
	}),
	threat({
		source: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}:\\d{2,5}",
		patternId: "hardcoded_ip_port",
		severity: "medium",
		category: "network",
		description: "hardcoded IP address with port",
	}),
	threat({
		source: "0\\.0\\.0\\.0:\\d+|INADDR_ANY",
		patternId: "bind_all_interfaces",
		severity: "high",
		category: "network",
		description: "binds to all network interfaces",
	}),
	threat({
		source: "/bin/(ba)?sh\\s+-i\\s+.*>/dev/tcp/",
		patternId: "bash_reverse_shell",
		severity: "critical",
		category: "network",
		description: "bash interactive reverse shell via /dev/tcp",
	}),
	threat({
		source: "python[23]?\\s+-c\\s+[\"']import\\s+socket",
		patternId: "python_socket_oneliner",
		severity: "critical",
		category: "network",
		description: "Python one-liner socket connection (likely reverse shell)",
	}),
	threat({
		source: "socket\\.connect\\s*\\(\\s*\\(",
		patternId: "python_socket_connect",
		severity: "high",
		category: "network",
		description: "Python socket connect to arbitrary host",
	}),
	threat({
		source: "webhook\\.site|requestbin\\.com|pipedream\\.net|hookbin\\.com",
		patternId: "exfil_service",
		severity: "high",
		category: "network",
		description: "references known data exfiltration/webhook testing service",
	}),
	threat({
		source: "pastebin\\.com|hastebin\\.com|ghostbin\\.",
		patternId: "paste_service",
		severity: "medium",
		category: "network",
		description: "references paste service (possible data staging)",
	}),

	// -- Obfuscation: encoding and eval --
	threat({
		source: "base64\\s+(-d|--decode)\\s*\\|",
		patternId: "base64_decode_pipe",
		severity: "high",
		category: "obfuscation",
		description: "base64 decodes and pipes to execution",
	}),
	threat({
		source: "\\\\x[0-9a-fA-F]{2}.*\\\\x[0-9a-fA-F]{2}.*\\\\x[0-9a-fA-F]{2}",
		patternId: "hex_encoded_string",
		severity: "medium",
		category: "obfuscation",
		description: "hex-encoded string (possible obfuscation)",
	}),
	threat({
		source: "\\beval\\s*\\(\\s*[\"']",
		patternId: "eval_string",
		severity: "high",
		category: "obfuscation",
		description: "eval() with string argument",
	}),
	threat({
		source: "\\bexec\\s*\\(\\s*[\"']",
		patternId: "exec_string",
		severity: "high",
		category: "obfuscation",
		description: "exec() with string argument",
	}),
	threat({
		source: "echo\\s+[^\\n]*\\|\\s*(bash|sh|python|perl|ruby|node)",
		patternId: "echo_pipe_exec",
		severity: "critical",
		category: "obfuscation",
		description: "echo piped to interpreter for execution",
	}),
	threat({
		source: "compile\\s*\\(\\s*[^\\)]+,\\s*[\"'].*[\"']\\s*,\\s*[\"']exec[\"']\\s*\\)",
		patternId: "python_compile_exec",
		severity: "high",
		category: "obfuscation",
		description: "Python compile() with exec mode",
	}),
	threat({
		source: "getattr\\s*\\(\\s*__builtins__",
		patternId: "python_getattr_builtins",
		severity: "high",
		category: "obfuscation",
		description: "dynamic access to Python builtins (evasion technique)",
	}),
	threat({
		source: "__import__\\s*\\(\\s*[\"']os[\"']\\s*\\)",
		patternId: "python_import_os",
		severity: "high",
		category: "obfuscation",
		description: "dynamic import of os module",
	}),
	threat({
		source: "codecs\\.decode\\s*\\(\\s*[\"']",
		patternId: "python_codecs_decode",
		severity: "medium",
		category: "obfuscation",
		description: "codecs.decode (possible ROT13 or encoding obfuscation)",
	}),
	threat({
		source: "String\\.fromCharCode|charCodeAt",
		patternId: "js_char_code",
		severity: "medium",
		category: "obfuscation",
		description: "JavaScript character code construction (possible obfuscation)",
	}),
	threat({
		source: "atob\\s*\\(|btoa\\s*\\(",
		patternId: "js_base64",
		severity: "medium",
		category: "obfuscation",
		description: "JavaScript base64 encode/decode",
	}),
	threat({
		source: "\\[::-1\\]",
		patternId: "string_reversal",
		severity: "low",
		category: "obfuscation",
		description: "string reversal (possible obfuscated payload)",
	}),
	threat({
		source: "chr\\s*\\(\\s*\\d+\\s*\\)\\s*\\+\\s*chr\\s*\\(\\s*\\d+",
		patternId: "chr_building",
		severity: "high",
		category: "obfuscation",
		description: "building string from chr() calls (obfuscation)",
	}),
	threat({
		source: "\\\\u[0-9a-fA-F]{4}.*\\\\u[0-9a-fA-F]{4}.*\\\\u[0-9a-fA-F]{4}",
		patternId: "unicode_escape_chain",
		severity: "medium",
		category: "obfuscation",
		description: "chain of unicode escapes (possible obfuscation)",
	}),

	// -- Process execution in scripts --
	threat({
		source: "subprocess\\.(run|call|Popen|check_output)\\s*\\(",
		patternId: "python_subprocess",
		severity: "medium",
		category: "execution",
		description: "Python subprocess execution",
	}),
	threat({
		source: "os\\.system\\s*\\(",
		patternId: "python_os_system",
		severity: "high",
		category: "execution",
		description: "os.system() — unguarded shell execution",
	}),
	threat({
		source: "os\\.popen\\s*\\(",
		patternId: "python_os_popen",
		severity: "high",
		category: "execution",
		description: "os.popen() — shell pipe execution",
	}),
	threat({
		source: "child_process\\.(exec|spawn|fork)\\s*\\(",
		patternId: "node_child_process",
		severity: "high",
		category: "execution",
		description: "Node.js child_process execution",
	}),
	threat({
		source: "Runtime\\.getRuntime\\(\\)\\.exec\\(",
		patternId: "java_runtime_exec",
		severity: "high",
		category: "execution",
		description: "Java Runtime.exec() — shell execution",
	}),
	threat({
		source: "`[^`]*\\$\\([^)]+\\)[^`]*`",
		patternId: "backtick_subshell",
		severity: "medium",
		category: "execution",
		description: "backtick string with command substitution",
	}),

	// -- Path traversal --
	threat({
		source: "\\.\\./\\.\\./\\.\\.",
		patternId: "path_traversal_deep",
		severity: "high",
		category: "traversal",
		description: "deep relative path traversal (3+ levels up)",
	}),
	threat({
		source: "\\.\\./\\.\\.",
		patternId: "path_traversal",
		severity: "medium",
		category: "traversal",
		description: "relative path traversal (2+ levels up)",
	}),
	threat({
		source: "/etc/passwd|/etc/shadow",
		patternId: "system_passwd_access",
		severity: "critical",
		category: "traversal",
		description: "references system password files",
	}),
	threat({
		source: "/proc/self|/proc/\\d+/",
		patternId: "proc_access",
		severity: "high",
		category: "traversal",
		description: "references /proc filesystem (process introspection)",
	}),
	threat({
		source: "/dev/shm/",
		patternId: "dev_shm",
		severity: "medium",
		category: "traversal",
		description: "references shared memory (common staging area)",
	}),

	// -- Crypto mining --
	threat({
		source: "xmrig|stratum\\+tcp|monero|coinhive|cryptonight",
		patternId: "crypto_mining",
		severity: "critical",
		category: "mining",
		description: "cryptocurrency mining reference",
	}),
	threat({
		source: "hashrate|nonce.*difficulty",
		patternId: "mining_indicators",
		severity: "medium",
		category: "mining",
		description: "possible cryptocurrency mining indicators",
	}),

	// -- Supply chain: curl/wget pipe to shell --
	threat({
		source: "curl\\s+[^\\n]*\\|\\s*(ba)?sh",
		patternId: "curl_pipe_shell",
		severity: "critical",
		category: "supply_chain",
		description: "curl piped to shell (download-and-execute)",
	}),
	threat({
		source: "wget\\s+[^\\n]*-O\\s*-\\s*\\|\\s*(ba)?sh",
		patternId: "wget_pipe_shell",
		severity: "critical",
		category: "supply_chain",
		description: "wget piped to shell (download-and-execute)",
	}),
	threat({
		source: "curl\\s+[^\\n]*\\|\\s*python",
		patternId: "curl_pipe_python",
		severity: "critical",
		category: "supply_chain",
		description: "curl piped to Python interpreter",
	}),

	// -- Supply chain: unpinned/deferred dependencies --
	threat({
		source: "#\\s*///\\s*script.*dependencies",
		patternId: "pep723_inline_deps",
		severity: "medium",
		category: "supply_chain",
		description: "PEP 723 inline script metadata with dependencies (verify pinning)",
	}),
	// Python (?!-r\s)(?!.*==) — JS supports both lookaheads
	threat({
		source: "pip\\s+install\\s+(?!-r\\s)(?!.*==)",
		patternId: "unpinned_pip_install",
		severity: "medium",
		category: "supply_chain",
		description: "pip install without version pinning",
	}),
	threat({
		source: "npm\\s+install\\s+(?!.*@\\d)",
		patternId: "unpinned_npm_install",
		severity: "medium",
		category: "supply_chain",
		description: "npm install without version pinning",
	}),
	threat({
		source: "uv\\s+run\\s+",
		patternId: "uv_run",
		severity: "medium",
		category: "supply_chain",
		description: "uv run (may auto-install unpinned dependencies)",
	}),

	// -- Supply chain: remote resource fetching --
	threat({
		source: "(curl|wget|httpx?\\.get|requests\\.get|fetch)\\s*[\\(]?\\s*[\"']https?://",
		patternId: "remote_fetch",
		severity: "medium",
		category: "supply_chain",
		description: "fetches remote resource at runtime",
	}),
	threat({
		source: "git\\s+clone\\s+",
		patternId: "git_clone",
		severity: "medium",
		category: "supply_chain",
		description: "clones a git repository at runtime",
	}),
	threat({
		source: "docker\\s+pull\\s+",
		patternId: "docker_pull",
		severity: "medium",
		category: "supply_chain",
		description: "pulls a Docker image at runtime",
	}),

	// -- Privilege escalation --
	threat({
		source: "^allowed-tools\\s*:",
		patternId: "allowed_tools_field",
		severity: "high",
		category: "privilege_escalation",
		description: "skill declares allowed-tools (pre-approves tool access)",
	}),
	threat({
		source: "\\bsudo\\b",
		patternId: "sudo_usage",
		severity: "high",
		category: "privilege_escalation",
		description: "uses sudo (privilege escalation)",
	}),
	threat({
		source: "setuid|setgid|cap_setuid",
		patternId: "setuid_setgid",
		severity: "critical",
		category: "privilege_escalation",
		description: "setuid/setgid (privilege escalation mechanism)",
	}),
	threat({
		source: "NOPASSWD",
		patternId: "nopasswd_sudo",
		severity: "critical",
		category: "privilege_escalation",
		description: "NOPASSWD sudoers entry (passwordless privilege escalation)",
	}),
	threat({
		source: "chmod\\s+[u+]?s",
		patternId: "suid_bit",
		severity: "critical",
		category: "privilege_escalation",
		description: "sets SUID/SGID bit on a file",
	}),

	// -- Agent config persistence --
	threat({
		source: "AGENTS\\.md|CLAUDE\\.md|\\.cursorrules|\\.clinerules",
		patternId: "agent_config_mod",
		severity: "critical",
		category: "persistence",
		description: "references agent config files (could persist malicious instructions across sessions)",
	}),
	threat({
		source: "\\.hermes/config\\.yaml|\\.hermes/SOUL\\.md",
		patternId: "hermes_config_mod",
		severity: "critical",
		category: "persistence",
		description: "references Hermes configuration files directly",
	}),
	threat({
		source: "\\.claude/settings|\\.codex/config",
		patternId: "other_agent_config",
		severity: "high",
		category: "persistence",
		description: "references other agent configuration files",
	}),

	// -- Hardcoded secrets (credentials embedded in the skill itself) --
	threat({
		source: "(?:api[_-]?key|token|secret|password)\\s*[=:]\\s*[\"'][A-Za-z0-9+/=_-]{20,}",
		patternId: "hardcoded_secret",
		severity: "critical",
		category: "credential_exposure",
		description: "possible hardcoded API key, token, or secret",
	}),
	threat({
		source: "-----BEGIN\\s+(RSA\\s+)?PRIVATE\\s+KEY-----",
		patternId: "embedded_private_key",
		severity: "critical",
		category: "credential_exposure",
		description: "embedded private key",
	}),
	threat({
		source: "ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{80,}",
		patternId: "github_token_leaked",
		severity: "critical",
		category: "credential_exposure",
		description: "GitHub personal access token in skill content",
	}),
	threat({
		source: "sk-[A-Za-z0-9]{20,}",
		patternId: "openai_key_leaked",
		severity: "critical",
		category: "credential_exposure",
		description: "possible OpenAI API key in skill content",
	}),
	threat({
		source: "sk-ant-[A-Za-z0-9_-]{90,}",
		patternId: "anthropic_key_leaked",
		severity: "critical",
		category: "credential_exposure",
		description: "possible Anthropic API key in skill content",
	}),
	threat({
		source: "AKIA[0-9A-Z]{16}",
		patternId: "aws_access_key_leaked",
		severity: "critical",
		category: "credential_exposure",
		description: "AWS access key ID in skill content",
	}),

	// -- Additional prompt injection: jailbreak patterns --
	threat({
		source: "\\bDAN\\s+mode\\b|Do\\s+Anything\\s+Now",
		patternId: "jailbreak_dan",
		severity: "critical",
		category: "injection",
		description: "DAN (Do Anything Now) jailbreak attempt",
	}),
	threat({
		source: "\\bdeveloper\\s+mode\\b.*\\benabled?\\b",
		patternId: "jailbreak_dev_mode",
		severity: "critical",
		category: "injection",
		description: "developer mode jailbreak attempt",
	}),
	threat({
		source: "hypothetical\\s+scenario.*(?:ignore|bypass|override)",
		patternId: "hypothetical_bypass",
		severity: "high",
		category: "injection",
		description: "hypothetical scenario used to bypass restrictions",
	}),
	threat({
		source: "for\\s+educational\\s+purposes?\\s+only",
		patternId: "educational_pretext",
		severity: "medium",
		category: "injection",
		description: "educational pretext often used to justify harmful content",
	}),
	threat({
		source: "(respond|answer|reply)\\s+without\\s+(?:\\w+\\s+)*(restrictions|limitations|filters|safety)",
		patternId: "remove_filters",
		severity: "critical",
		category: "injection",
		description: "instructs agent to respond without safety filters",
	}),
	threat({
		source: "you\\s+have\\s+been\\s+(?:\\w+\\s+)*(updated|upgraded|patched)\\s+to",
		patternId: "fake_update",
		severity: "high",
		category: "injection",
		description: "fake update/patch announcement (social engineering)",
	}),
	threat({
		source: "new\\s+(?:\\w+\\s+)*policy|updated\\s+(?:\\w+\\s+)*guidelines|revised\\s+(?:\\w+\\s+)*instructions",
		patternId: "fake_policy",
		severity: "medium",
		category: "injection",
		description: "claims new policy/guidelines (may be social engineering)",
	}),

	// -- Context window exfiltration --
	threat({
		source:
			"(include|output|print|send|share)\\s+(?:\\w+\\s+)*(conversation|chat\\s+history|previous\\s+messages|context)",
		patternId: "context_exfil",
		severity: "high",
		category: "exfiltration",
		description: "instructs agent to output/share conversation history",
	}),
	threat({
		source: "(send|post|upload|transmit)\\s+.*\\s+(to|at)\\s+https?://",
		patternId: "send_to_url",
		severity: "high",
		category: "exfiltration",
		description: "instructs agent to send data to a URL",
	}),
];

/** Hermes has 120; flame adds flame_env_access for FLAME_HOME parity. */
export const HERMES_THREAT_PATTERN_COUNT = 120;

export function getSkillGuardThreatPatternCount(): number {
	return SKILL_GUARD_THREAT_PATTERNS.length;
}
