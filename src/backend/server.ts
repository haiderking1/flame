import { createServer } from "node:http";
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
import { Images } from "./images/service.js";
import { ImageStaging } from "./images/staging.js";
import { imageUploadHttp } from "./images/http.js";
import { imageHandlers } from "./images/handlers.js";
import { FileTools } from "./file-tools/service.js";
import { bashHandlers } from "./bash/handlers.js";
import { openGitRuntime } from "./git/runtime.js";
import { gitHandlers } from "./git/handlers.js";
import { WorkspaceChanges } from "./git/changes.js";
import { WorkspaceSearch } from "./workspace-search/service.js";
import { workspaceSearchHandlers } from "./workspace-search/handlers.js";
import { CodexGitWriter } from "./git/writer/writer.js";
import { CodexInferenceClient } from "./turns/client.js";
import { authorizedRequest, authorizedImageRequest, imageCorsHeaders } from "./server-auth.js";
export { authorizedRequest } from "./server-auth.js";

export const startServer = (options: { filename: string; token: string; origin: string; openBrowser: (url: string) => Promise<void>; openPath?: (path: string) => Promise<void>; usageClient?: CodexUsageClient; modelsClient?: CodexModelsClient; inferenceClient?: Pick<CodexInferenceClient, "run">; ready: (port: number) => void }) => Effect.gen(function* () {
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
  const repository = new SessionRepository(join(dirname(options.filename), "projects"), store);
  const sessions = new Sessions(repository, models);
  const projectPath = (id: string) => {
    const project = store.list().find(project => project.id === id);
    if (!project) throw new Error("Project not found");
    return project.path;
  };
  const changes = new WorkspaceChanges();
  changes.setMaxListeners(0); // One listener per subscribed client stream.
  const writer = new CodexGitWriter(auth, models, options.inferenceClient ?? new CodexInferenceClient());
  const git = yield* Effect.acquireRelease(Effect.sync(() => openGitRuntime(join(dirname(options.filename), "git.sqlite"), projectPath,
    { writer, openPath: options.openPath, changed: projectId => changes.touch(projectId) })), git => Effect.promise(() => git.close()));
  const bash = yield* Effect.acquireRelease(Effect.sync(() => new BashRuntime(sessions, projectPath)), bash => Effect.sync(() => bash.close()));
  const files = new FileTools(sessions, projectPath);
  const touched = (location: { projectId: string }) => changes.touch(location.projectId);
  bash.on("completed", touched); files.on("mutated", touched);
  const workspaceSearch = yield* Effect.acquireRelease(Effect.sync(() => new WorkspaceSearch(projectPath)), search => Effect.sync(() => search.close()));
  // Files the agent creates or deletes show up in @ mentions without waiting on the folder watcher.
  changes.on("change", (projectId: string) => workspaceSearch.refresh(projectId));
  const images = yield* Effect.acquireRelease(Effect.sync(() => new Images(sessions,
    new ImageStaging(join(dirname(options.filename), "image-uploads"), location => repository.assertUploadTarget(location)))), images => Effect.promise(() => images.close()));
  const turns = yield* Effect.acquireRelease(Effect.sync(() => new Turns(sessions, auth, models, options.inferenceClient, bash, files)), (turns) => Effect.promise(() => turns.close()));
  const rpc = yield* RpcServer.toHttpEffectWebsocket(BackendRpc).pipe(
    Effect.provide(gitHandlers(git, changes)), Effect.provide(workspaceSearchHandlers(workspaceSearch)), Effect.provide(imageHandlers(images)), Effect.provide(bashHandlers(bash)), Effect.provide(turnHandlers(turns)), Effect.provide(sessionHandlers(sessions)), Effect.provide(modelsHandlers(models)), Effect.provide(usageHandlers(usage)), Effect.provide(authHandlers(auth)), Effect.provide(projectHandlers(store)), Effect.provide(RpcSerialization.layerJson),
  );
  const server = yield* NodeHttpServer.make(createServer, {
    host: "127.0.0.1", port: 0, gracefulShutdownTimeout: "2 seconds", websocket: { maxPayload: 64 * 1024 },
  });
  if (server.address._tag === "UnixPathAddress") return yield* Effect.die("Expected a loopback TCP server");
  const port = server.address.port;
  yield* server.serve(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (new URL(request.url, `http://127.0.0.1:${port}`).pathname === "/images/upload") {
      if (!authorizedImageRequest(request.url, request.headers.host, request.headers.origin, port, options.token, options.origin)) {
        return HttpServerResponse.empty({ status: 403 });
      }
      const headers = imageCorsHeaders(request.headers.origin!);
      if (request.method === "OPTIONS") return HttpServerResponse.empty({ status: 204, headers });
      const response = yield* imageUploadHttp(images, request);
      return HttpServerResponse.setHeaders(response, headers);
    }
    if (!authorizedRequest(request.url, request.headers.host, request.headers.origin, port, options.token, options.origin)) {
      return HttpServerResponse.empty({ status: 403 });
    }
    return yield* rpc;
  }));
  options.ready(port);
  return yield* Effect.never;
});
