import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import rendererConfig from "../vite.config.mjs";

export async function startDevServer(
  root = fileURLToPath(new URL("../src/renderer/", import.meta.url)),
) {
  const server = await createServer({
    ...rendererConfig,
    configFile: false,
    root,
    server: { host: "127.0.0.1", port: 5173 },
    plugins: [...rendererConfig.plugins, {
      name: "flame-dev-csp",
      transformIndexHtml(html) {
        // Development only: Vite's WebSocket, CSS, and React Refresh preamble.
        return html
          .replace("default-src 'none';", "default-src 'none'; connect-src 'self' ws://127.0.0.1:*;")
          .replace("style-src 'self';", "style-src 'self' 'unsafe-inline';")
          .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';");
      },
    }],
  });
  try {
    await server.listen();
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}
