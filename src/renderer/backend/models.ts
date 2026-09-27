import { Cause, Effect, Option, Schedule, Stream } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { ModelsError } from "@contracts/models";
import { Backend, backendRuntime } from "./client";

export const modelsAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, (client) =>
  client["codex.models.watch"]().pipe(Stream.retry(Schedule.spaced("3 seconds"))),
)));
export const refreshModels = backendRuntime.fn(() => Effect.flatMap(Backend, (client) => client["codex.models.refresh"]()));
import type { ServiceTier } from "@contracts/models";

export type ModelChoice = { accountKey: string; modelId: string } & ({ type: "model" } | { type: "thinking"; effort: string } | { type: "tier"; serviceTier: ServiceTier });
export const changeModelChoice = backendRuntime.fn((choice: ModelChoice) => Effect.flatMap(Backend, (client) =>
  choice.type === "model" ? client["codex.models.select"]({ accountKey: choice.accountKey, modelId: choice.modelId })
    : choice.type === "tier" ? client["codex.models.tier"]({ accountKey: choice.accountKey, modelId: choice.modelId, serviceTier: choice.serviceTier })
    : client["codex.models.thinking"]({ accountKey: choice.accountKey, modelId: choice.modelId, effort: choice.effort }),
).pipe(Effect.timeout("10 seconds")));
export function modelsErrorMessage(result: AsyncResult.AsyncResult<unknown, unknown>) {
  if (!AsyncResult.isFailure(result)) return null;
  const error = Cause.findErrorOption(result.cause);
  return Option.isSome(error) && error.value instanceof ModelsError ? error.value.message : "Could not reach the model catalog. Check your backend connection.";
}
