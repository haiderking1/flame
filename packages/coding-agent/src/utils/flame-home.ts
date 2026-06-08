import { homedir } from "node:os";
import { join } from "node:path";

const FLAME_HOME_ENV_VAR = "FLAME_HOME";

export function getFlameHome(): string {
	const fromEnv = process.env[FLAME_HOME_ENV_VAR]?.trim();
	if (fromEnv && fromEnv.length > 0) return fromEnv;
	const home = process.env.HOME || homedir();
	return join(home, ".flame");
}
