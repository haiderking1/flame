import { Context, Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { BackendRpc } from "@contracts/backend";
import type { UpdateChannel, UpdateState } from "@contracts/desktop-update";

declare global { interface Window { flame: {
  connection(): Promise<string>;
  notificationsSupported?(): Promise<boolean>;
  notify?(notification: { tag: string; title: string; body: string }): Promise<boolean>;
  setBadge?(badge: { count: number; image: string | null }): Promise<void>;
  onNotificationOpen?(callback: (tag: string) => void): () => void;
  onNotificationsCleared?(callback: () => void): () => void;
  updates?: {
    state(): Promise<UpdateState>; check(): Promise<UpdateState>; download(): Promise<UpdateState>; install(): Promise<boolean>;
    setChannel(channel: UpdateChannel): Promise<UpdateState>; onState(callback: (state: UpdateState) => void): () => void;
  };
} } }
const makeClient = RpcClient.make(BackendRpc);
export class Backend extends Context.Service<Backend, Effect.Success<typeof makeClient>>()("flame/Backend") {}
const socket = Socket.layerWebSocket(Effect.promise(() => window.flame.connection()), { openTimeout: "5 seconds" }).pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
);
const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(socket), Layer.provide(RpcSerialization.layerJson),
);
export const backendRuntime = Atom.runtime(Layer.effect(Backend, makeClient).pipe(Layer.provide(protocol)));
