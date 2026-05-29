import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function atomicWrite(filePath: string, content: string): Promise<void> {
	const dir = dirname(filePath);
	await fs.mkdir(dir, { recursive: true });
	const tmpName = `.flame-mem-${randomBytes(8).toString("hex")}.tmp`;
	const tmpPath = join(dir, tmpName);
	let fh: FileHandle | undefined;
	try {
		fh = await fs.open(tmpPath, "wx", 0o600);
		await fh.writeFile(content, "utf-8");
		await fh.sync();
		await fh.close();
		fh = undefined;
		await fs.rename(tmpPath, filePath);
	} catch (err) {
		if (fh) {
			try {
				await fh.close();
			} catch {}
		}
		try {
			await fs.unlink(tmpPath);
		} catch {}
		throw err;
	}
}
