import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer/", import.meta.url)),
  base: "./",
  resolve: { alias: { "@contracts": fileURLToPath(new URL("./src/contracts/", import.meta.url)) } },
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer/", import.meta.url)),
    emptyOutDir: true,
  },
});
