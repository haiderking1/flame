import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import path from "path";
import { type Static, Type } from "typebox";
import { getAgentDir } from "../../config.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const ARIA2_PROGRESS_REGEX =
	/\[#\w+\s+([\d.]+[A-Za-z]*i?B)\/([\d.]+[A-Za-z]*i?B)\((\d+)%\)\s+CN:(\d+)\s+DL:([^\s]+)(?:\s+ETA:([^\s\]]+))?\]/;
const DOWNLOADABLE_LINK_EXT =
	/\.(?:zip|rar|7z|tar|gz|tgz|bz2|xz|mp4|mkv|exe|dmg|iso|pdf|jpg|jpeg|png|webp|mp3|wav)(?:[?#].*)?$/i;

const downloadSchema = Type.Object({
	url: Type.Optional(
		Type.String({
			description: "URL to download (HTTP, HTTPS, FTP, Magnet, Torrent, or Webpage URL for link extraction)",
		}),
	),
	taskId: Type.Optional(Type.String({ description: "Task ID for background download operations (status, abort)" })),
	action: Type.Optional(
		Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("abort"), Type.Literal("list")], {
			description: "Action to perform (default: 'start' if URL is provided)",
		}),
	),
	background: Type.Optional(
		Type.Boolean({ description: "Run download in the background as a task (default: false)" }),
	),
	dir: Type.Optional(
		Type.String({ description: "Directory to save the downloaded file (default: current directory)" }),
	),
	filename: Type.Optional(Type.String({ description: "Custom output filename" })),
	connections: Type.Optional(Type.Number({ description: "Number of connections per server (1-32, default: 16)" })),
	speedLimit: Type.Optional(Type.String({ description: "Speed limit per download (e.g. '5M', '500K')" })),
	globalSpeedLimit: Type.Optional(Type.String({ description: "Global speed limit (e.g. '10M', '1K')" })),
	priority: Type.Optional(
		Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("critical")], {
			description: "Priority level",
		}),
	),
	retries: Type.Optional(Type.Number({ description: "Max retries (default: 5)" })),
	retryWait: Type.Optional(Type.Number({ description: "Wait time between retries in seconds (default: 5)" })),
	autoExtract: Type.Optional(
		Type.Boolean({ description: "Auto-extract ZIP, TAR, GZ, 7z, RAR archives after download" }),
	),
	extractDir: Type.Optional(Type.String({ description: "Directory to extract archives into" })),
	deleteArchive: Type.Optional(
		Type.Boolean({ description: "Delete archive file after successful extraction (default: false)" }),
	),
	checksum: Type.Optional(
		Type.String({
			description: "Expected checksum hash in format 'algo=hash' (e.g. 'sha256=hash-value' or 'md5=hash-value')",
		}),
	),
	minSize: Type.Optional(Type.String({ description: "Minimum expected file size (e.g. '100K', '10M')" })),
	maxSize: Type.Optional(Type.String({ description: "Maximum expected file size (e.g. '1G', '500M')" })),
	username: Type.Optional(Type.String({ description: "HTTP basic auth username" })),
	password: Type.Optional(Type.String({ description: "HTTP basic auth password" })),
	bearerToken: Type.Optional(Type.String({ description: "Bearer token authorization header" })),
	proxy: Type.Optional(Type.String({ description: "Proxy server URL (e.g. http://127.0.0.1:8080 or socks5://...)" })),
	skipTls: Type.Optional(Type.Boolean({ description: "Skip TLS verification (default: false)" })),
	headers: Type.Optional(Type.Array(Type.String(), { description: "Custom headers in 'Header: Value' format" })),
	cookies: Type.Optional(Type.String({ description: "Custom cookies string" })),
	mediaConvert: Type.Optional(
		Type.Boolean({ description: "Convert media to MP4/MP3 format using ffmpeg after download" }),
	),
	genChecksumFile: Type.Optional(
		Type.Boolean({ description: "Generate a .sha256 checksum file after download (default: false)" }),
	),
	mirrors: Type.Optional(Type.Array(Type.String(), { description: "Alternative mirror URLs for the same file" })),
	autoOrganize: Type.Optional(
		Type.Boolean({
			description: "Auto-organize downloads into folders by file type (images, videos, archives, etc.)",
		}),
	),
	extractLinks: Type.Optional(
		Type.Boolean({
			description:
				"Extract and download all downloadable links from a webpage URL instead of downloading the webpage itself",
		}),
	),
	conditional: Type.Optional(
		Type.Boolean({ description: "Only download if remote file is newer than local (timestamping)" }),
	),
	userAgent: Type.Optional(Type.String({ description: "Spoof User-Agent header" })),
	maxConcurrent: Type.Optional(Type.Number({ description: "Max concurrent downloads (default: 5)" })),
	dryRun: Type.Optional(
		Type.Boolean({ description: "Dry run: check what would be downloaded without starting the download" }),
	),
	tempDir: Type.Optional(Type.String({ description: "Directory for incomplete downloads" })),
});

export type DownloadToolInput = Static<typeof downloadSchema>;

export interface DownloadToolDetails {
	url?: string;
	filename?: string;
	savePath?: string;
	size?: number;
	extracted?: boolean;
	checksumMatched?: boolean;
	mediaConverted?: boolean;
	percent?: number;
	downloaded?: string;
	total?: string;
	speed?: string;
	eta?: string;
	connections?: number;
	status?: "running" | "success" | "failed" | "aborted";
	taskId?: string;
	pid?: number;
	error?: string;
	activeTasks?: DownloadTaskSummary[];
}

type DownloadTaskStatus = "running" | "success" | "failed" | "aborted";

interface DownloadTaskMeta {
	taskId: string;
	url: string;
	dir: string;
	filename: string;
	savePath: string;
	status: DownloadTaskStatus;
	percent: number;
	downloaded?: string;
	total?: string;
	speed?: string;
	eta?: string;
	pid: number;
}

interface DownloadTaskSummary {
	taskId: string;
	url: string;
	savePath: string;
	filename: string;
	status: DownloadTaskStatus;
	percent: number;
	downloaded: string;
	total: string;
	speed: string;
	eta: string;
	pid: number;
}

interface ParsedProgress {
	downloaded: string;
	total: string;
	percent: number;
	speed: string;
	eta: string;
}

function getDownloadsDir(): string {
	return path.join(getAgentDir(), "downloads");
}

function readDownloadTaskMeta(metaPath: string): DownloadTaskMeta {
	return JSON.parse(readFileSync(metaPath, "utf-8")) as DownloadTaskMeta;
}

function isProcessRunning(pid: number): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function parseLatestProgress(logContent: string): ParsedProgress | undefined {
	for (const line of logContent.split("\n").reverse()) {
		const match = line.match(ARIA2_PROGRESS_REGEX);
		if (match) {
			return {
				downloaded: match[1],
				total: match[2],
				percent: parseInt(match[3], 10),
				speed: match[5],
				eta: match[6] || "N/A",
			};
		}
	}
	return undefined;
}

function inferFinishedStatus(logContent: string): DownloadTaskStatus {
	if (logContent.includes("Download complete:") || logContent.includes("download completed")) {
		return "success";
	}
	return "failed";
}

function summarizeDownloadTask(meta: DownloadTaskMeta, tasksDir: string, persist: boolean): DownloadTaskSummary {
	const logPath = path.join(tasksDir, `${meta.taskId}.log`);
	const isRunning = isProcessRunning(meta.pid);
	let status = meta.status;
	let percent = meta.percent || 0;
	let downloaded = meta.downloaded || "0B";
	let total = meta.total || "unknown";
	let speed = meta.speed || "0B/s";
	let eta = meta.eta || "N/A";

	if (isRunning && existsSync(logPath)) {
		const progress = parseLatestProgress(readFileSync(logPath, "utf-8"));
		if (progress) {
			downloaded = progress.downloaded;
			total = progress.total;
			percent = progress.percent;
			speed = progress.speed;
			eta = progress.eta;
		}
	} else if (!isRunning && status === "running") {
		const logContent = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
		status = inferFinishedStatus(logContent);
		if (status === "success") {
			percent = 100;
		}
		speed = "0B/s";
		eta = "N/A";
		if (persist) {
			meta.status = status;
			meta.percent = percent;
			meta.downloaded = downloaded;
			meta.total = total;
			meta.speed = speed;
			meta.eta = eta;
			writeFileSync(path.join(tasksDir, `${meta.taskId}.json`), JSON.stringify(meta, null, 2));
		}
	}

	return {
		taskId: meta.taskId,
		url: meta.url,
		savePath: meta.savePath,
		filename: meta.filename,
		status,
		percent,
		downloaded,
		total,
		speed,
		eta,
		pid: meta.pid,
	};
}

function formatProgressBar(percent: number, width = 20): string {
	const completed = Math.round((percent / 100) * width);
	return `${"█".repeat(completed)}${"░".repeat(width - completed)}`;
}

function extractDownloadLinks(html: string, baseUrl: string): string[] {
	const extracted = new Set<string>();
	const attrRegex = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
	for (const match of html.matchAll(attrRegex)) {
		const raw = match[1]?.trim();
		if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) {
			continue;
		}
		try {
			const resolved = new URL(raw, baseUrl);
			if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
				continue;
			}
			if (!DOWNLOADABLE_LINK_EXT.test(resolved.pathname)) {
				continue;
			}
			extracted.add(resolved.toString());
		} catch {
			// ignore invalid URLs
		}
	}
	return [...extracted];
}

function aria2MissingError(err: NodeJS.ErrnoException): Error {
	if (err.code === "ENOENT") {
		return new Error("aria2c was not found in PATH. Install aria2 and ensure aria2c is available.");
	}
	return err;
}

// Helpers for size parsing
function parseSizeToBytes(sizeStr: string): number {
	const match = sizeStr.trim().match(/^([\d.]+)\s*([KMGkmg]?[Bb]?)$/);
	if (!match) return 0;
	const val = parseFloat(match[1]);
	const unit = match[2].toUpperCase();
	if (unit.startsWith("G")) return val * 1024 * 1024 * 1024;
	if (unit.startsWith("M")) return val * 1024 * 1024;
	if (unit.startsWith("K")) return val * 1024;
	return val;
}

// Helper to format bytes to human readable format
function formatBytes(bytes: number, decimals = 2): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

// Helper to determine aria2c binary path
function commandExists(cmd: string): boolean {
	try {
		const result =
			process.platform === "win32"
				? spawnSync("where", [cmd], { stdio: "pipe" })
				: spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "pipe" });
		return result.status === 0;
	} catch {
		return false;
	}
}

function getAria2cPath(): string {
	if (commandExists("aria2c")) {
		return "aria2c";
	}
	if (process.platform === "win32") {
		const userProfile = process.env.USERPROFILE || homedir();
		const scoopCandidates = [
			path.join(userProfile, "scoop", "shims", "aria2c.exe"),
			path.join(userProfile, "scoop", "apps", "aria2", "current", "aria2c.exe"),
		];
		for (const candidate of scoopCandidates) {
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return "aria2c";
}

// Helper for checksum computation
function verifyFileChecksum(filePath: string, algo: string, expectedHash: string): boolean {
	try {
		const hash = crypto.createHash(algo);
		hash.update(readFileSync(filePath));
		return hash.digest("hex").toLowerCase() === expectedHash.toLowerCase();
	} catch {
		return false;
	}
}

export function createDownloadToolDefinition(
	cwd: string,
	_options?: unknown,
): ToolDefinition<typeof downloadSchema, DownloadToolDetails | undefined> {
	return {
		name: "download",
		label: "download",
		description:
			"Download files from HTTP, HTTPS, FTP, magnet, and torrent URLs using aria2c. Supports checksum validation, archive extraction, auto-organize, and background tasks. For commands after a download finishes (installers, custom scripts, conversions not covered by autoExtract/mediaConvert), call bash in a separate step using the returned savePath.",
		promptSnippet: "Download files with aria2c; run follow-up shell commands with bash after download completes",
		parameters: downloadSchema,

		async execute(_toolCallId, args, signal, onUpdate) {
			const tasksDir = getDownloadsDir();
			if (!existsSync(tasksDir)) {
				mkdirSync(tasksDir, { recursive: true });
			}

			const action = args.action || (args.url ? "start" : args.taskId ? "status" : "list");

			if (action === "list") {
				const files = readdirSync(tasksDir);
				const activeTasks: DownloadTaskSummary[] = [];
				for (const f of files) {
					if (!f.endsWith(".json")) {
						continue;
					}
					try {
						const meta = readDownloadTaskMeta(path.join(tasksDir, f));
						activeTasks.push(summarizeDownloadTask(meta, tasksDir, true));
					} catch {
						// ignore invalid metadata
					}
				}

				let listText = "Background Download Tasks:\n";
				if (activeTasks.length === 0) {
					listText += "No active or past tasks found.";
				} else {
					for (const task of activeTasks) {
						const bar = formatProgressBar(task.percent);
						listText += `\nTask ID: ${task.taskId}\nURL: ${task.url}\nStatus: ${task.status}\nProgress: [${bar}] ${task.percent}%\nSpeed: ${task.speed} | ETA: ${task.eta} | Path: ${task.savePath}\n`;
					}
				}

				return {
					content: [{ type: "text", text: listText }],
					details: { activeTasks },
				};
			}

			if (action === "abort") {
				if (!args.taskId) {
					throw new Error("taskId is required for abort action.");
				}
				const metaPath = path.join(tasksDir, `${args.taskId}.json`);
				if (!existsSync(metaPath)) {
					throw new Error(`Task ${args.taskId} not found.`);
				}
				const meta = readDownloadTaskMeta(metaPath);
				if (meta.pid) {
					try {
						process.kill(meta.pid, "SIGTERM");
					} catch {
						// ignore
					}
				}
				meta.status = "aborted";
				meta.speed = "0B/s";
				meta.eta = "N/A";
				writeFileSync(metaPath, JSON.stringify(meta, null, 2));

				return {
					content: [{ type: "text", text: `Successfully aborted download task: ${args.taskId}` }],
					details: {
						taskId: args.taskId,
						status: "aborted",
						url: meta.url,
						savePath: meta.savePath,
					},
				};
			}

			if (action === "status") {
				if (!args.taskId) {
					throw new Error("taskId is required for status action.");
				}
				const metaPath = path.join(tasksDir, `${args.taskId}.json`);
				if (!existsSync(metaPath)) {
					throw new Error(`Task ${args.taskId} not found.`);
				}
				const meta = readDownloadTaskMeta(metaPath);
				const task = summarizeDownloadTask(meta, tasksDir, true);
				const bar = formatProgressBar(task.percent);

				const statusText = `Download Task Status: ${args.taskId}\nURL: ${meta.url}\nStatus: ${task.status}\nProgress: [${bar}] ${task.percent}%\nDownloaded: ${task.downloaded}/${task.total}\nSpeed: ${task.speed}\nETA: ${task.eta}\nPath: ${meta.savePath}`;

				return {
					content: [{ type: "text", text: statusText }],
					details: {
						taskId: args.taskId,
						url: meta.url,
						filename: meta.filename,
						savePath: meta.savePath,
						status: task.status,
						percent: task.percent,
						downloaded: task.downloaded,
						total: task.total,
						speed: task.speed,
						eta: task.eta,
						pid: meta.pid,
					},
				};
			}

			if (!args.url) {
				throw new Error("url is required to start a download.");
			}

			const targetDir = args.dir ? path.resolve(cwd, args.dir) : cwd;
			const downloadDir = args.tempDir ? path.resolve(cwd, args.tempDir) : targetDir;
			if (!existsSync(targetDir)) {
				mkdirSync(targetDir, { recursive: true });
			}
			if (!existsSync(downloadDir)) {
				mkdirSync(downloadDir, { recursive: true });
			}

			// Disk space check (statfs)
			try {
				const stats = statfsSync(targetDir);
				const freeSpaceBytes = stats.bavail * stats.bsize;
				if (freeSpaceBytes < 10 * 1024 * 1024) {
					throw new Error(`Insufficient disk space in destination directory: only ${freeSpaceBytes} bytes free.`);
				}
			} catch (err: unknown) {
				// Warn or throw if critical
				if (err instanceof Error && err.message.includes("Insufficient disk space")) {
					throw err;
				}
			}

			// URL link extraction support
			let urlsToDownload = [args.url!];
			if (args.mirrors) {
				urlsToDownload.push(...args.mirrors);
			}

			if (args.extractLinks) {
				onUpdate?.({
					content: [{ type: "text", text: `Fetching webpage to extract links: ${args.url!}` }],
					details: undefined,
				});
				try {
					const res = await fetch(args.url!);
					if (res.ok) {
						const extracted = extractDownloadLinks(await res.text(), args.url!);
						if (extracted.length > 0) {
							urlsToDownload = extracted;
							onUpdate?.({
								content: [
									{ type: "text", text: `Extracted ${urlsToDownload.length} downloadable links from page.` },
								],
								details: undefined,
							});
						} else {
							onUpdate?.({
								content: [
									{
										type: "text",
										text: "No downloadable links found on the page. Downloading the page itself.",
									},
								],
								details: undefined,
							});
						}
					}
				} catch (err) {
					onUpdate?.({
						content: [
							{
								type: "text",
								text: `Failed to extract links: ${err instanceof Error ? err.message : String(err)}`,
							},
						],
						details: undefined,
					});
				}
			}

			// Check duplicate/existing files
			let downloadSkipped = false;
			let finalFilePath = "";

			if (!args.extractLinks && args.filename) {
				const prospectivePath = path.join(targetDir, args.filename);
				if (existsSync(prospectivePath)) {
					if (args.checksum) {
						const [algo, expectedHash] = args.checksum.split("=");
						if (algo && expectedHash && verifyFileChecksum(prospectivePath, algo, expectedHash)) {
							downloadSkipped = true;
							finalFilePath = prospectivePath;
						}
					} else {
						// Simple skip if exists and no checksum verification asked
						downloadSkipped = true;
						finalFilePath = prospectivePath;
					}
				}
			}

			if (downloadSkipped) {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `File already exists and matches checksum/name: ${finalFilePath}. Skipping download.`,
						},
					],
					details: undefined,
				});
				return {
					content: [{ type: "text", text: `Download skipped. File already exists at: ${finalFilePath}` }],
					details: {
						url: args.url!,
						filename: args.filename,
						savePath: finalFilePath,
						checksumMatched: true,
					},
				};
			}

			// Build aria2c command arguments
			const aria2cPath = getAria2cPath();
			const cmdArgs: string[] = ["--summary-interval=1", "--continue=true"];

			// Multi-connection options
			const conns = args.connections ? Math.min(Math.max(1, args.connections), 32) : 16;
			cmdArgs.push(`-x${conns}`, `-s${conns}`);

			// Retries
			const maxTries = args.retries ?? 5;
			const retryWait = args.retryWait ?? 5;
			cmdArgs.push(`--max-tries=${maxTries}`, `--retry-wait=${retryWait}`);

			// Speed Limit
			if (args.speedLimit) cmdArgs.push(`--max-download-limit=${args.speedLimit}`);
			if (args.globalSpeedLimit) cmdArgs.push(`--max-overall-download-limit=${args.globalSpeedLimit}`);

			// Priority / Split Tuning
			if (args.priority) {
				if (args.priority === "low") cmdArgs.push("-j1", "--split=4");
				else if (args.priority === "high") cmdArgs.push("--split=24");
				else if (args.priority === "critical") cmdArgs.push("--split=32");
			}

			// Output Dir & Filename
			cmdArgs.push("-d", downloadDir);
			if (args.filename) {
				cmdArgs.push("-o", args.filename);
			} else {
				cmdArgs.push("--content-disposition-default-utf8=true");
			}

			// Authentication
			if (args.username && args.password) {
				cmdArgs.push(`--http-user=${args.username}`, `--http-passwd=${args.password}`);
			}
			if (args.bearerToken) {
				cmdArgs.push(`--header=Authorization: Bearer ${args.bearerToken}`);
			}

			// Proxies
			if (args.proxy) {
				cmdArgs.push(`--all-proxy=${args.proxy}`);
			}

			// TLS check skip
			if (args.skipTls) {
				cmdArgs.push("--check-certificate=false");
			}

			// Headers
			if (args.headers) {
				for (const h of args.headers) {
					cmdArgs.push(`--header=${h}`);
				}
			}

			// Cookies
			if (args.cookies) {
				cmdArgs.push(`--header=Cookie: ${args.cookies}`);
			}

			// User-Agent
			if (args.userAgent) {
				cmdArgs.push(`--user-agent=${args.userAgent}`);
			}

			// Dry Run
			if (args.dryRun) {
				cmdArgs.push("--dry-run=true");
			}

			// Max concurrent
			if (args.maxConcurrent) {
				cmdArgs.push(`--max-concurrent-downloads=${args.maxConcurrent}`);
			}

			// Conditional / Timestamping
			if (args.conditional) {
				cmdArgs.push("--conditional-get=true");
			}

			// Queue all URLs
			cmdArgs.push(...urlsToDownload);

			// 7. Spawn process and run download
			if (args.background) {
				const taskId = `dl_${Date.now()}`;
				const metaPath = path.join(tasksDir, `${taskId}.json`);
				const logPath = path.join(tasksDir, `${taskId}.log`);

				const meta = {
					taskId,
					url: args.url!,
					dir: targetDir,
					filename: args.filename || path.basename(urlsToDownload[0]),
					savePath: path.join(targetDir, args.filename || path.basename(urlsToDownload[0])),
					status: "running",
					percent: 0,
					pid: 0,
				};
				writeFileSync(metaPath, JSON.stringify(meta, null, 2));

				const logFd = openSync(logPath, "w");
				const child = spawn(aria2cPath, cmdArgs, {
					detached: true,
					stdio: ["ignore", logFd, logFd],
				});

				meta.pid = child.pid || 0;
				writeFileSync(metaPath, JSON.stringify(meta, null, 2));

				closeSync(logFd);
				child.unref();

				return {
					content: [
						{
							type: "text",
							text: `Download started in the background.\nTask ID: ${taskId}\nURL: ${args.url!}\nUse 'download action=status taskId=${taskId}' to check progress.`,
						},
					],
					details: {
						taskId,
						url: args.url!,
						status: "running",
						pid: child.pid,
					},
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: `Starting download via aria2c: ${urlsToDownload.join(", ")}` }],
				details: undefined,
			});

			const startTime = Date.now();
			let finalOutput = "";
			let lastProgressText = "";

			const executionResult = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
				(resolve, reject) => {
					const child = spawn(aria2cPath, cmdArgs, { signal });
					let stdout = "";
					let stderr = "";

					child.stdout.on("data", (chunk: Buffer) => {
						const line = chunk.toString();
						stdout += line;
						finalOutput += line;

						// Match progress line: [#ea39bd 1.2MiB/4.3MiB(27%) CN:16 DL:1.2MiB ETA:2s]
						const match = line.match(ARIA2_PROGRESS_REGEX);
						if (match) {
							const downloaded = match[1];
							const total = match[2];
							const percent = match[3];
							const connections = match[4];
							const speed = match[5];
							const eta = match[6] || "N/A";

							const timeElapsed = (Date.now() - startTime) / 1000;
							const avgSpeed =
								timeElapsed > 0
									? `${(parseSizeToBytes(downloaded) / timeElapsed / 1024).toFixed(1)}KiB/s`
									: speed;

							lastProgressText = `Percent: ${percent}% | Downloaded: ${downloaded}/${total} | Speed: ${speed} (Avg: ${avgSpeed}) | ETA: ${eta} | Connections: ${connections}`;
							onUpdate?.({
								content: [{ type: "text", text: lastProgressText }],
								details: {
									url: args.url!,
									percent: parseInt(percent, 10),
									downloaded,
									total,
									speed,
									eta,
									connections: parseInt(connections, 10),
								},
							});
						}
					});

					child.stderr.on("data", (chunk: Buffer) => {
						stderr += chunk.toString();
					});

					child.on("close", (code) => {
						resolve({ exitCode: code ?? 0, stdout, stderr });
					});

					child.on("error", (err) => {
						reject(aria2MissingError(err));
					});
				},
			);

			if (executionResult.exitCode !== 0) {
				throw new Error(
					`aria2c failed with exit code ${executionResult.exitCode}. Error details: ${executionResult.stderr || executionResult.stdout}`,
				);
			}

			if (args.dryRun) {
				return {
					content: [{ type: "text", text: "Dry run completed successfully." }],
					details: { url: args.url! },
				};
			}

			// Find actual downloaded filename and path
			let downloadedFilename = args.filename || "";
			if (!downloadedFilename) {
				// Parse from aria2c output, e.g., "Download complete: /path/to/file"
				const completeMatch = finalOutput.match(/Download complete:\s*(.+)/i);
				if (completeMatch?.[1]) {
					finalFilePath = completeMatch[1].trim();
					downloadedFilename = path.basename(finalFilePath);
				} else {
					// Fallback: search most recent modified file in downloadDir
					try {
						const files = readdirSync(downloadDir).map((f) => ({
							name: f,
							time: statSync(path.join(downloadDir, f)).mtime.getTime(),
						}));
						files.sort((a, b) => b.time - a.time);
						if (files[0]) {
							downloadedFilename = files[0].name;
							finalFilePath = path.join(downloadDir, downloadedFilename);
						}
					} catch {
						// ignore
					}
				}
			} else {
				finalFilePath = path.join(downloadDir, downloadedFilename);
			}

			if (!finalFilePath || !existsSync(finalFilePath)) {
				throw new Error("Could not locate downloaded file on disk.");
			}

			if (path.resolve(downloadDir) !== path.resolve(targetDir)) {
				const destinationPath = path.join(targetDir, downloadedFilename);
				renameSync(finalFilePath, destinationPath);
				finalFilePath = destinationPath;
			}

			const fileStats = statSync(finalFilePath);
			const fileSize = fileStats.size;

			// 9. Size Validation
			if (args.minSize) {
				const minBytes = parseSizeToBytes(args.minSize);
				if (fileSize < minBytes) {
					rmSync(finalFilePath, { force: true });
					throw new Error(
						`Downloaded file size (${fileSize} bytes) is smaller than the minimum expected size: ${args.minSize}`,
					);
				}
			}
			if (args.maxSize) {
				const maxBytes = parseSizeToBytes(args.maxSize);
				if (fileSize > maxBytes) {
					rmSync(finalFilePath, { force: true });
					throw new Error(
						`Downloaded file size (${fileSize} bytes) is larger than the maximum expected size: ${args.maxSize}`,
					);
				}
			}

			// 10. Checksum validation
			let checksumMatched = false;
			if (args.checksum) {
				const parts = args.checksum.split("=");
				const algo = parts[0];
				const expectedHash = parts[1];
				if (algo && expectedHash) {
					onUpdate?.({ content: [{ type: "text", text: `Verifying ${algo} checksum...` }], details: undefined });
					checksumMatched = verifyFileChecksum(finalFilePath, algo, expectedHash);
					if (!checksumMatched) {
						rmSync(finalFilePath, { force: true });
						throw new Error(`Checksum verification failed. Mismatch on expected hash.`);
					}
					onUpdate?.({ content: [{ type: "text", text: `Checksum verified successfully!` }], details: undefined });
				}
			}

			// 11. Generate Checksum file
			if (args.genChecksumFile) {
				const hash = crypto.createHash("sha256");
				hash.update(readFileSync(finalFilePath));
				const sha256Val = hash.digest("hex");
				const checksumFilePath = `${finalFilePath}.sha256`;
				writeFileSync(checksumFilePath, `${sha256Val}  ${downloadedFilename}\n`);
			}

			// 12. Auto-organize file by type
			if (args.autoOrganize) {
				const ext = path.extname(downloadedFilename).toLowerCase();
				let subDir = "others";
				if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(ext)) {
					subDir = "images";
				} else if ([".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm"].includes(ext)) {
					subDir = "videos";
				} else if ([".mp3", ".wav", ".flac", ".ogg", ".m4a"].includes(ext)) {
					subDir = "audio";
				} else if ([".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"].includes(ext)) {
					subDir = "archives";
				} else if ([".pdf", ".doc", ".docx", ".txt", ".xls", ".xlsx", ".md"].includes(ext)) {
					subDir = "documents";
				}

				const organizedDir = path.join(targetDir, subDir);
				if (!existsSync(organizedDir)) {
					mkdirSync(organizedDir, { recursive: true });
				}
				const newFilePath = path.join(organizedDir, downloadedFilename);
				renameSync(finalFilePath, newFilePath);
				finalFilePath = newFilePath;
			}

			// 13. Auto-extract archives
			let extracted = false;
			const extractDir = args.extractDir ? path.resolve(cwd, args.extractDir) : targetDir;

			if (args.autoExtract) {
				const ext = path.extname(downloadedFilename).toLowerCase();
				if ([".zip", ".tar", ".gz", ".7z", ".rar"].includes(ext)) {
					onUpdate?.({
						content: [{ type: "text", text: `Extracting archive: ${downloadedFilename}` }],
						details: undefined,
					});
					if (!existsSync(extractDir)) {
						mkdirSync(extractDir, { recursive: true });
					}

					let extractCmd = "";
					let extractArgs: string[] = [];

					if (ext === ".zip") {
						if (process.platform === "win32") {
							extractCmd = "powershell.exe";
							extractArgs = [
								"-Command",
								`Expand-Archive -Path '${finalFilePath}' -DestinationPath '${extractDir}' -Force`,
							];
						} else {
							extractCmd = "unzip";
							extractArgs = ["-o", finalFilePath, "-d", extractDir];
						}
					} else if (ext === ".tar" || ext === ".gz") {
						extractCmd = "tar";
						extractArgs = ["-xf", finalFilePath, "-C", extractDir];
					} else {
						// 7z / rar fallback
						extractCmd = "7z";
						extractArgs = ["x", finalFilePath, `-o${extractDir}`, "-y"];
					}

					extracted = await new Promise<boolean>((resolve) => {
						const child = spawn(extractCmd, extractArgs);
						child.on("close", (code) => {
							resolve(code === 0);
						});
						child.on("error", () => {
							resolve(false);
						});
					});

					if (extracted) {
						onUpdate?.({
							content: [{ type: "text", text: "Extraction completed successfully." }],
							details: undefined,
						});
						if (args.deleteArchive) {
							rmSync(finalFilePath, { force: true });
						}
					} else {
						onUpdate?.({
							content: [{ type: "text", text: "Extraction failed. Archive is kept intact." }],
							details: undefined,
						});
					}
				}
			}

			// 14. Custom file permissions
			if (process.platform !== "win32") {
				try {
					chmodSync(finalFilePath, 0o755);
				} catch {
					// ignore
				}
			}

			// Media conversion (ffmpeg)
			let mediaConverted = false;
			if (args.mediaConvert) {
				const ext = path.extname(downloadedFilename).toLowerCase();
				if ([".webm", ".mkv", ".avi", ".flv", ".ogg", ".wav"].includes(ext)) {
					const outputFormat = [".wav", ".ogg"].includes(ext) ? ".mp3" : ".mp4";
					const baseName = path.basename(finalFilePath, ext);
					const outputFilePath = path.join(path.dirname(finalFilePath), `${baseName}${outputFormat}`);

					onUpdate?.({
						content: [{ type: "text", text: `Converting media file to ${outputFormat} using ffmpeg...` }],
						details: undefined,
					});
					mediaConverted = await new Promise<boolean>((resolve) => {
						const child = spawn("ffmpeg", ["-i", finalFilePath, "-y", outputFilePath]);
						child.on("close", (code) => {
							resolve(code === 0);
						});
						child.on("error", () => {
							resolve(false);
						});
					});

					if (mediaConverted) {
						onUpdate?.({
							content: [{ type: "text", text: `Media conversion succeeded. Output: ${outputFilePath}` }],
							details: undefined,
						});
					}
				}
			}

			// Download history logging
			try {
				const historyPath = path.join(getAgentDir(), "download_history.json");
				let history: Array<Record<string, unknown>> = [];
				if (existsSync(historyPath)) {
					try {
						history = JSON.parse(readFileSync(historyPath, "utf-8")) as typeof history;
					} catch {
						// ignore
					}
				}
				history.push({
					timestamp: new Date().toISOString(),
					url: args.url!,
					filename: downloadedFilename,
					savePath: finalFilePath,
					size: fileSize,
					status: "success",
				});
				writeFileSync(historyPath, JSON.stringify(history, null, 2));
			} catch {
				// ignore history failures
			}

			// 18. Notification (terminal beep / sound)
			process.stdout.write("\x07");

			const elapsedSeconds = (Date.now() - startTime) / 1000;
			const speedStr = elapsedSeconds > 0 ? `${formatBytes(fileSize / elapsedSeconds)}/s` : "unknown";
			const sizeStr = formatBytes(fileSize);
			const timeStr = `${elapsedSeconds.toFixed(1)}s`;

			return {
				content: [
					{
						type: "text",
						text: `Successfully downloaded file to: ${finalFilePath}\nSize: ${sizeStr}\nSpeed: ${speedStr}\nTime: ${timeStr}`,
					},
				],
				details: {
					url: args.url!,
					filename: downloadedFilename,
					savePath: finalFilePath,
					size: fileSize,
					extracted,
					checksumMatched,
					mediaConverted,
				},
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const url = args?.url ?? "";
			text.setText(`${theme.fg("toolTitle", theme.bold("download"))} ${theme.fg("accent", url)}`);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as DownloadToolDetails | undefined;
			if (context.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("warning", msg.slice(0, 120)));
			} else if (options.isPartial) {
				if (details && details.percent !== undefined) {
					const percent = details.percent;
					const width = 20;
					const completed = Math.round((percent / 100) * width);
					const remaining = width - completed;
					const bar = "█".repeat(completed) + "░".repeat(remaining);

					const barText = theme.fg("success", `[${bar}] ${percent}%`);
					const metaText = theme.fg(
						"muted",
						` | ${details.downloaded || "0B"}/${details.total || "unknown"} | Speed: ${details.speed || "0B/s"} | ETA: ${details.eta || "N/A"}`,
					);
					text.setText(`${barText}${metaText}`);
				} else {
					const msg = result.content[0]?.type === "text" ? result.content[0].text : "Downloading...";
					text.setText(theme.fg("muted", msg));
				}
			} else {
				text.setText(theme.fg("toolOutput", `Downloaded to ${details?.savePath || "destination"}`));
			}
			return text;
		},
	};
}

export function createDownloadTool(cwd: string, options?: unknown): AgentTool<typeof downloadSchema> {
	return wrapToolDefinition(createDownloadToolDefinition(cwd, options));
}
