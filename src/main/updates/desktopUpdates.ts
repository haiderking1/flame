import { app, BrowserWindow, dialog, ipcMain } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import { isUpdateChannel, type UpdateChannel, type UpdateErrorContext, type UpdateState } from "../../contracts/desktop-update.js";
import { ChannelSetting, channelOf } from "./channel.js";
import { disabledReason } from "./disabled.js";
import * as machine from "./machine.js";

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60_000;
type Updater = typeof electronUpdater.autoUpdater;
type Options = {
  /** Stops the backend and lets the next instance start, before the updater quits Flame to install. */
  prepareToInstall(): Promise<void>;
  updater?: Updater;
  /** Why updates are off; worked out from the build when omitted. */
  disabledReason?: string | null;
};

/**
 * Updates Flame from GitHub Releases on the stable or nightly track. Checks 15 seconds after start and every 4 minutes;
 * downloading and installing wait for the user. Sends every state change to the windows as "flame:update-state".
 */
export class DesktopUpdates {
  state: UpdateState;
  private readonly updater: Updater;
  private readonly setting: ChannelSetting;
  private action: Promise<unknown> | null = null;
  private context: UpdateErrorContext | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private announcedPercent: number | null = null;
  constructor(private readonly options: Options) {
    this.updater = options.updater ?? electronUpdater.autoUpdater;
    const version = app.getVersion();
    this.setting = new ChannelSetting(app.getPath("userData"), version);
    this.state = machine.initialState({ version, channel: channelOf(version), disabledReason: options.disabledReason === undefined ? disabledReason() : options.disabledReason, translated: app.runningUnderARM64Translation });
  }

  async start() {
    this.state = { ...this.state, channel: await this.setting.load() };
    this.installIpc();
    if (!this.state.enabled) return;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.logger = null;
    this.applyChannel(this.state.channel);
    this.updater.on("checking-for-update", () => this.set(machine.checking(this.state)));
    this.updater.on("update-available", (info: UpdateInfo) => this.onAvailable(info));
    this.updater.on("update-not-available", () => this.set(machine.upToDate(this.state, Date.now())));
    this.updater.on("download-progress", (progress: ProgressInfo) => this.onProgress(progress.percent));
    this.updater.on("update-downloaded", (info: UpdateInfo) => this.set(machine.downloaded(this.state, info.version)));
    this.updater.on("error", (error: Error) => this.onError(error));
    this.timers.push(setTimeout(() => { void this.check(); }, FIRST_CHECK_MS));
    const interval = setInterval(() => { void this.check(); }, CHECK_EVERY_MS);
    interval.unref();
    this.timers.push(interval);
  }
  stop() { for (const timer of this.timers) clearTimeout(timer); this.timers = []; }

  /** Looks for a newer version on the chosen track; a no-op while another update step runs. */
  check() { return this.run("check", () => this.updater.checkForUpdates()); }
  download() {
    if (this.action || (this.state.status !== "available" && !(this.state.status === "error" && this.state.errorContext === "download"))) return Promise.resolve(false);
    this.announcedPercent = null;
    this.set(machine.downloading(this.state, 0));
    return this.run("download", () => this.updater.downloadUpdate());
  }
  /** Quits Flame and installs the downloaded update; Flame starts again on the new version. */
  async install() {
    const ready = this.state.status === "downloaded" || (this.state.status === "error" && this.state.errorContext === "install" && this.state.downloadedVersion);
    if (!ready || this.action) return false;
    this.context = "install";
    this.action = Promise.resolve();
    await this.options.prepareToInstall();
    this.updater.quitAndInstall(true, true);
    return true;
  }
  async setChannel(channel: UpdateChannel) {
    if (channel === this.state.channel) return;
    await this.setting.save(channel);
    this.set(machine.switched(this.state, channel));
    if (!this.state.enabled) return;
    this.applyChannel(channel);
    void this.check();
  }
  /** The menu's "Check for Updates…": checks now and says what it found. */
  async checkFromMenu(window: BrowserWindow | null) {
    if (!this.state.enabled) { await this.tell(window, "info", "Updates are not available", this.state.message ?? ""); return; }
    await this.check();
    const state = this.state;
    if (state.status === "up-to-date") await this.tell(window, "info", "You're up to date", `Flame ${state.currentVersion} is the newest version on the ${state.channel === "nightly" ? "nightly" : "stable"} track.`);
    else if (state.status === "available") await this.tell(window, "info", `Flame ${state.availableVersion} is available`, "Download it from the update button in the sidebar or in Settings → About.");
    else if (state.status === "downloaded") await this.tell(window, "info", `Flame ${state.downloadedVersion} is ready to install`, "Install it from the update button in the sidebar or in Settings → About.");
    else if (state.status === "error") await this.tell(window, "error", "Update check failed", state.message ?? "");
  }

  private applyChannel(channel: UpdateChannel) {
    this.updater.channel = channel;
    // Nightlies are GitHub prereleases. Switching back to stable waits for the next stable release instead of downgrading.
    this.updater.allowPrerelease = channel === "nightly";
    this.updater.allowDowngrade = channel === "nightly";
  }
  private onAvailable(info: UpdateInfo) {
    // A release from the other track, which GitHub's latest-release feed can return, is not offered.
    if (channelOf(info.version) !== this.state.channel) { this.set(machine.upToDate(this.state, Date.now())); return; }
    this.set(machine.available(this.state, info.version, Date.now()));
  }
  private onProgress(percent: number) {
    if (!machine.progressStep(this.announcedPercent, percent)) return;
    this.announcedPercent = percent;
    this.set(machine.downloading(this.state, percent));
  }
  private onError(error: Error) {
    const context = this.context ?? "check";
    this.set(machine.failed(this.state, context, machine.updateErrorMessage(error, context)));
    // The backend already stopped for an install that failed: start Flame again rather than leave it unusable.
    if (context === "install") { app.relaunch(); app.exit(0); }
  }
  private async run(context: UpdateErrorContext, step: () => Promise<unknown>) {
    if (!this.state.enabled || this.action) return false;
    this.context = context;
    const task = step().catch((error: unknown) => { this.onError(error instanceof Error ? error : new Error(String(error))); });
    this.action = task;
    try { await task; } finally { if (this.action === task) { this.action = null; this.context = null; } }
    return true;
  }
  private set(state: UpdateState) {
    this.state = state;
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("flame:update-state", state);
  }
  private async tell(window: BrowserWindow | null, type: "info" | "error", message: string, detail: string) {
    const options = { type, message, detail, buttons: ["OK"] };
    await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
  }
  private installIpc() {
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted update request");
    };
    ipcMain.handle("flame:update-state", event => { trusted(event); return this.state; });
    ipcMain.handle("flame:update-check", async event => { trusted(event); await this.check(); return this.state; });
    ipcMain.handle("flame:update-download", async event => { trusted(event); await this.download(); return this.state; });
    ipcMain.handle("flame:update-install", async event => { trusted(event); return this.install(); });
    ipcMain.handle("flame:update-channel", async (event, channel: unknown) => {
      trusted(event);
      if (!isUpdateChannel(channel)) throw new Error("Invalid update channel");
      await this.setChannel(channel);
      return this.state;
    });
  }
}
