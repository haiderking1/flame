import { Context, Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { ProjectRpc } from "@contracts/projects";

declare global { interface Window { flame: { connection(): Promise<string> } } }
const makeClient = RpcClient.make(ProjectRpc);
export class Backend extends Context.Service<Backend, Effect.Success<typeof makeClient>>()("flame/Backend") {}
const socket = Socket.layerWebSocket(Effect.promise(() => window.flame.connection()), { openTimeout: "5 seconds" }).pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
);
const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(socket), Layer.provide(RpcSerialization.layerJson),
);
export const backendRuntime = Atom.runtime(Layer.effect(Backend, makeClient).pipe(Layer.provide(protocol)));
