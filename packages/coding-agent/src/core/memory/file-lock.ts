import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RETRY_MS = 50;
const ACQUIRE_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 60_000;

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const lockPath = `${filePath}.lock`;
	await acquireLock(lockPath);
	try {
		return await fn();
	} finally {
		await releaseLock(lockPath);
	}
}

async function acquireLock(lockPath: string): Promise<void> {
	await fs.mkdir(dirname(lockPath), { recursive: true });
	const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
	while (true) {
		try {
			const fh = await fs.open(lockPath, "wx", 0o600);
			try {
				await fh.writeFile(`${process.pid}\n${Date.now()}\n`, "utf-8");
			} finally {
				await fh.close();
			}
			return;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw err;
		}

		let stat;
		try {
			stat = await fs.stat(lockPath);
		} catch {
			continue;
		}
		if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
			try {
				await fs.unlink(lockPath);
			} catch {}
			continue;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Failed to acquire lock on ${lockPath} within ${ACQUIRE_TIMEOUT_MS}ms`);
		}
		await sleep(RETRY_MS);
	}
}

async function releaseLock(lockPath: string): Promise<void> {
	try {
		await fs.unlink(lockPath);
	} catch {}
}
