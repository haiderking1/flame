import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BackendRpc } from "../contracts/backend.js";
import { AuthStore } from "./auth/store.js";
import { CodexAuth } from "./auth/service.js";
import { authHandlers } from "./auth/handlers.js";
import { UsageStore } from "./usage/store.js";
import { CodexUsage } from "./usage/service.js";
import type { CodexUsageClient } from "./usage/client.js";
import { usageHandlers } from "./usage/handlers.js";
import { ProjectStore } from "./projects/store.js";
import { projectHandlers } from "./projects/handlers.js";
import { CodexModels } from "./models/service.js";
import { ModelsStore } from "./models/store.js";
import { modelsHandlers } from "./models/handlers.js";
import type { CodexModelsClient } from "./models/client.js";

import { SessionRepository } from "./sessions/repository.js";
import { Sessions } from "./sessions/service.js";
import { sessionHandlers } from "./sessions/handlers.js";
import { Turns } from "./turns/service.js";
import { turnHandlers } from "./turns/handlers.js";
import { BashRuntime } from "./bash/service.js";
import { bashHandlers } from "./bash/handlers.js";
import type { CodexInferenceClient } from "./turns/client.js";

export function authorizedRequest(url: string, host: string | undefined, origin: string | undefined, port: number, token: string, allowedOrigin: string) {
  if (host !== `127.0.0.1:${port}` || origin !== allowedOrigin) return false;
  const parsed = new URL(url, `http://${host}`);
  const supplied = Buffer.from(parsed.searchParams.get("token") ?? "");
  const secret = Buffer.from(token);
  return parsed.pathname === "/rpc" && supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

export const startServer = (options: { filename: string; token: string; origin: string; openBrowser: (url: string) => Promise<void>; usageClient?: CodexUsageClient; modelsClient?: CodexModelsClient; inferenceClient?: Pick<CodexInferenceClient, "run">; ready: (port: number) => void }) => Effect.gen(function* () {
  const store = yield* Effect.acquireRelease(Effect.sync(() => new ProjectStore(options.filename)), (store) => Effect.sync(() => store.close()));
  const auth = yield* Effect.acquireRelease(Effect.promise(async () => {
    const auth = new CodexAuth({ store: new AuthStore(join(homedir(), ".flame", "agent")), openBrowser: options.openBrowser });
    await auth.initialize();
    return auth;
  }), (auth) => Effect.promise(() => auth.close()));
  const usageStore = yield* Effect.acquireRelease(Effect.sync(() => new UsageStore(options.filename)), (store) => Effect.sync(() => store.close()));
  const usage = yield* Effect.acquireRelease(Effect.sync(() => new CodexUsage(auth, usageStore, options.usageClient)), (usage) => Effect.promise(() => usage.close()));
  const modelsStore = yield* Effect.acquireRelease(Effect.sync(() => new ModelsStore(options.filename)), (store) => Effect.sync(() => store.close()));
  const models = yield* Effect.acquireRelease(Effect.sync(() => new CodexModels(auth, modelsStore, options.modelsClient)), (models) => Effect.promise(() => models.close()));
  const sessions = new Sessions(new SessionRepository(join(dirname(options.filename), "projects"), store), models);
  const bash = yield* Effect.acquireRelease(Effect.sync(() => new BashRuntime(sessions, id => {
    const project = store.list().find(project => project.id === id);
    if (!project) throw new Error("Project not found");
    return project.path;
  })), bash => Effect.sync(() => bash.close()));
  const turns = yield* Effect.acquireRelease(Effect.sync(() => new Turns(sessions, auth, models, options.inferenceClient, bash)), (turns) => Effect.promise(() => turns.close()));
  const rpc = yield* RpcServer.toHttpEffectWebsocket(BackendRpc).pipe(
    Effect.provide(bashHandlers(bash)), Effect.provide(turnHandlers(turns)), Effect.provide(sessionHandlers(sessions)), Effect.provide(modelsHandlers(models)), Effect.provide(usageHandlers(usage)), Effect.provide(authHandlers(auth)), Effect.provide(projectHandlers(store)), Effect.provide(RpcSerialization.layerJson),
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
