import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { ProjectRpc } from "../contracts/projects.js";
import { ProjectStore } from "./projects/store.js";
import { projectHandlers } from "./projects/handlers.js";

export function authorizedRequest(url: string, host: string | undefined, origin: string | undefined, port: number, token: string, allowedOrigin: string) {
  if (host !== `127.0.0.1:${port}` || origin !== allowedOrigin) return false;
  const parsed = new URL(url, `http://${host}`);
  const supplied = Buffer.from(parsed.searchParams.get("token") ?? "");
  const secret = Buffer.from(token);
  return parsed.pathname === "/rpc" && supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

export const startServer = (options: { filename: string; token: string; origin: string; ready: (port: number) => void }) => Effect.gen(function* () {
  const store = yield* Effect.acquireRelease(Effect.sync(() => new ProjectStore(options.filename)), (store) => Effect.sync(() => store.close()));
  const rpc = yield* RpcServer.toHttpEffectWebsocket(ProjectRpc).pipe(
    Effect.provide(projectHandlers(store)), Effect.provide(RpcSerialization.layerJson),
  );
  const server = yield* NodeHttpServer.make(createServer, {
    host: "127.0.0.1", port: 0, gracefulShutdownTimeout: "2 seconds", websocket: { maxPayload: 64 * 1024 },
  });
  if (server.address._tag === "UnixPathAddress") return yield* Effect.die("Expected a loopback TCP server");
  const port = server.address.port;
  yield* server.serve(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!authorizedRequest(request.url, request.headers.host, request.headers.origin, port, options.token, options.origin)) {
      return HttpServerResponse.empty({ status: 403 });
    }
    return yield* rpc;
  }));
  options.ready(port);
  return yield* Effect.never;
});
