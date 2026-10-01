/**
 * Builds Flame's installers with electron-builder.
 *
 *   node scripts/desktop/package.mjs [--platform linux|mac|win] [--arch x64|arm64|universal] [--target AppImage,deb] [--version X.Y.Z] [--signed] [--skip-build]
 *
 * Linux builds an AppImage and a .deb, macOS a .dmg and a .zip, Windows an NSIS installer, into release/. Each platform
 * builds on its own OS; --target picks some of its formats. Without --signed, code signing is turned off, so local builds never pick up a certificate.
 */
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { Arch, build, Platform } from "electron-builder";
import { buildConfig } from "./config.mjs";
import { writeIcons } from "./icons.mjs";
import { releaseOf } from "./release.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const PLATFORMS = { linux: Platform.LINUX, mac: Platform.MAC, win: Platform.WINDOWS };
const HOST = { linux: "linux", darwin: "mac", win32: "win" }[process.platform];
const SIGNING_ENV = ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];

const { values } = parseArgs({ options: {
  platform: { type: "string", default: HOST }, arch: { type: "string", default: process.arch === "arm64" ? "arm64" : "x64" },
  target: { type: "string" }, version: { type: "string" }, signed: { type: "boolean", default: false }, "skip-build": { type: "boolean", default: false },
} });
const platform = PLATFORMS[values.platform];
if (!platform) throw new Error(`Unknown platform "${values.platform}". Use linux, mac or win.`);
if (values.platform !== HOST) throw new Error(`Build ${values.platform} installers on ${values.platform}: Flame's native dependencies are installed per OS.`);
const arch = Arch[values.arch];
if (arch === undefined || (values.arch === "universal" && values.platform !== "mac")) throw new Error(`Unsupported arch "${values.arch}" for ${values.platform}.`);

const release = releaseOf(values.version ?? JSON.parse(await readFile(new URL("package.json", `file://${root}`), "utf8")).version);
if (!values.signed) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  for (const name of SIGNING_ENV) delete process.env[name];
}
if (!values["skip-build"]) {
  const compiled = spawnSync("bun", ["run", "build"], { cwd: root, stdio: "inherit" });
  if (compiled.status !== 0) process.exit(compiled.status ?? 1);
}
const resources = `${root}dist/desktop-resources`;
await rm(resources, { recursive: true, force: true });
await writeIcons(`${root}resources/icons/flame-1024.png`, resources);
const targets = values.target?.split(",").map(name => name.trim()).filter(Boolean) ?? null;
const artifacts = await build({ projectDir: root, targets: platform.createTarget(targets, arch), publish: "never",
  config: buildConfig({ release, resources, output: `${root}release` }) });
console.log(`Built Flame ${release.version}${release.channel ? ` (${release.channel})` : ""}:\n${artifacts.map(path => `  ${path}`).join("\n")}`);
