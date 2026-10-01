import { ModelPicker } from "./models/ModelPicker";
import { useModelCatalog } from "./models/useModelCatalog";
import { useModelChoice } from "./models/useModelChoice";
import { ThinkingPicker } from "./thinking/ThinkingPicker";
import { useSessions } from "../sessions/SessionContext";
import "./composer-settings.css";

export function ComposerSettings() {
  const catalog = useModelCatalog();
  const choice = useModelChoice(catalog.accountKey);
  const sessions = useSessions();
  const active = sessions?.document;
  const selection = active ? active.settings : catalog.selection;
  const sessionKey = active ? `${active.projectId}:${active.sessionId}` : "defaults";
  const selected = catalog.models.find((model) => model.id === selection?.modelId);
  // The model can change while the agent works; that run keeps its own, and the next message uses the new one.
  const busy = choice.busy || !!sessions?.busy || sessions?.turn?.phase === "compacting";
  const error = active ? sessions?.error : choice.error;
  return <div className="composer-settings" role="group" aria-label="Model settings">
    <ModelPicker key={`${catalog.accountKey ?? "disconnected"}:${sessionKey}`} models={catalog.models} selectedId={selection?.modelId ?? null}
      onSelect={async (modelId) => {
        if (!catalog.accountKey) throw new Error("No connected account");
        if (active && sessions) {
          const model = catalog.models.find((model) => model.id === modelId);
          if (!model) throw new Error("Model unavailable");
          const effort = model.reasoningLevels.some((level) => level.effort === selection?.effort) ? selection!.effort : model.defaultReasoning;
          await sessions.configure(catalog.accountKey, { modelId, effort, serviceTier: model.supportsFast ? selection?.serviceTier ?? "default" : "default" });
        } else await choice.submit({ type: "model", accountKey: catalog.accountKey, modelId });
      }} emptyMessage={catalog.emptyMessage} error={error ?? catalog.error} busy={busy} />
    <span className="composer-settings__divider" aria-hidden="true" />
    <ThinkingPicker key={`${catalog.accountKey ?? ""}:${sessionKey}:${selected?.id ?? ""}`} model={selected} effort={selection?.effort ?? null}
      serviceTier={selection?.serviceTier ?? "default"} onSelectTier={async (serviceTier) => {
        if (!catalog.accountKey || !selected || !selection) throw new Error("No selected model");
        if (active && sessions) await sessions.configure(catalog.accountKey, { ...selection, serviceTier });
        else await choice.submit({ type: "tier", accountKey: catalog.accountKey, modelId: selected.id, serviceTier });
      }} busy={busy} error={error ?? null} onSelect={async (effort) => {
        if (!catalog.accountKey || !selected || !selection) throw new Error("No selected model");
        if (active && sessions) await sessions.configure(catalog.accountKey, { ...selection, effort });
        else await choice.submit({ type: "thinking", accountKey: catalog.accountKey, modelId: selected.id, effort });
      }} />
  </div>;
}
