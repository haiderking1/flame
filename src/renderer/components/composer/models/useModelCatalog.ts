import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import { modelsAtom, modelsErrorMessage } from "../../../backend/models";

export function useModelCatalog() {
  const result = useAtomValue(modelsAtom);
  const state = Option.getOrUndefined(AsyncResult.value(result));
  return {
    models: state?.catalog?.models ?? [], accountKey: state?.accountKey ?? null, selection: state?.selection ?? null, gitText: state?.gitText ?? null,
    loaded: !!state?.catalog,
    error: state?.message ?? modelsErrorMessage(result),
    emptyMessage: !state ? "Model catalog unavailable." : !state.connected ? "Sign in to OpenAI in Providers to see models."
      : !state.catalog ? (state.message ? "Model catalog unavailable." : "Fetching models from OpenAI…") : "No models are available for this account.",
  };
}
