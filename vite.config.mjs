import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer/", import.meta.url)),
  base: "./",
  resolve: { alias: { "@contracts": fileURLToPath(new URL("./src/contracts/", import.meta.url)), ...(process.env.FLAME_PROFILE === "1" ? { "react-dom/client": "react-dom/profiling" } : {}) } },
  define: { "import.meta.env.FLAME_PROFILE": JSON.stringify(process.env.FLAME_PROFILE === "1") },
  plugins: [react()],
  worker: { format: "es" },
  // These lazy/worker entries are not all visible to the initial HTML scan.
  // Prepare them before serving the app, rather than reloading on first use.
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker", "shiki", "shiki/engine/oniguruma", "shiki/wasm"],
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer/", import.meta.url)),
    emptyOutDir: true,
    manifest: true,
  },
});
