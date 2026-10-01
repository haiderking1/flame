/** Flame's electron-builder configuration. */
export const APP_ID = "io.github.haiderking1.flame";
export const REPOSITORY = { owner: "haiderking1", repo: "flame" };

// Native code is loaded from disk, never from inside app.asar.
const NATIVE = ["**/*.node", "**/*.so", "**/*.so.*", "**/*.dylib", "**/*.dll", "**/*.exe"];

/**
 * The build configuration for one release. `resources` holds the icons written for this build; `release` comes from
 * releaseOf(). Updates are published only for a release on a channel.
 */
export function buildConfig({ release, resources, output }) {
  return {
    appId: APP_ID,
    productName: release.productName,
    executableName: release.executable,
    artifactName: "Flame-${version}-${arch}.${ext}",
    copyright: "Copyright © Flame contributors",
    electronLanguages: ["en-US"],
    directories: { buildResources: resources, output },
    // productName is the app's name at runtime; desktopName is the Linux launcher entry, and so the window's app ID on Wayland.
    extraMetadata: { version: release.version, productName: release.productName, desktopName: `${release.executable}.desktop` },
    // The compiled app and the icon it shows at runtime; electron-builder adds the production dependencies.
    files: ["package.json", "dist/main/**", "dist/backend/**", "dist/contracts/**", "dist/renderer/**", "resources/icons/flame-512.png", "!**/*.map", "!**/*.d.ts",
      // Sources, docs and type packages that dependencies publish but never load.
      "!**/node_modules/@types/**", "!**/node_modules/effect/{src,ai-docs}/**", "!**/node_modules/@effect/*/src/**", "!**/node_modules/undici/docs/**"],
    asar: true,
    asarUnpack: NATIVE,
    // Flame's native dependencies use Node-API prebuilds, which need no rebuild for Electron.
    npmRebuild: false,
    publish: release.channel ? [{ provider: "github", ...REPOSITORY, releaseType: release.channel === "nightly" ? "prerelease" : "release", channel: release.channel }] : null,
    linux: {
      target: ["AppImage", "deb"],
      icon: "icons",
      category: "Development",
      synopsis: "Desktop app for coding agents",
      description: "Flame runs coding agents on your projects, with sessions, worktrees and Git built in.",
      maintainer: "Flame contributors <haiderking1@users.noreply.github.com>",
      desktop: { entry: { StartupWMClass: release.executable, Keywords: "code;agent;ai;git;" } },
    },
    deb: {
      depends: ["libgtk-3-0t64 | libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0t64 | libatspi2.0-0", "libuuid1", "libsecret-1-0", "libasound2t64 | libasound2", "git"],
    },
    mac: {
      target: ["dmg", "zip"],
      icon: "icon.png",
      category: "public.app-category.developer-tools",
      hardenedRuntime: true,
    },
    dmg: { window: { width: 540, height: 380 }, iconSize: 120 },
    win: {
      target: ["nsis"],
      icon: "icon.png",
      signAndEditExecutable: true,
    },
    nsis: { oneClick: true, perMachine: false, differentialPackage: true, shortcutName: release.productName },
  };
}
