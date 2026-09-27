import { ModelPicker } from "./models/ModelPicker";
import { useModelCatalog } from "./models/useModelCatalog";
import { useModelChoice } from "./models/useModelChoice";
import { ThinkingPicker } from "./thinking/ThinkingPicker";
import "./composer-settings.css";

export function ComposerSettings() {
  const catalog = useModelCatalog();
  const choice = useModelChoice(catalog.accountKey);
  const selected = catalog.models.find((model) => model.id === catalog.selection?.modelId);
  return <div className="composer-settings" role="group" aria-label="Model settings">
    <ModelPicker key={catalog.accountKey ?? "disconnected"} models={catalog.models} selectedId={selected?.id ?? null}
      onSelect={async (modelId) => {
        if (!catalog.accountKey) throw new Error("No connected account");
        await choice.submit({ type: "model", accountKey: catalog.accountKey, modelId });
      }} emptyMessage={catalog.emptyMessage} error={choice.error ?? catalog.error} busy={choice.busy} />
    <span className="composer-settings__divider" aria-hidden="true" />
    <ThinkingPicker key={`${catalog.accountKey ?? ""}:${selected?.id ?? ""}`} model={selected} effort={catalog.selection?.effort ?? null}
      serviceTier={catalog.selection?.serviceTier ?? "default"} onSelectTier={async (serviceTier) => {
        if (!catalog.accountKey || !selected) throw new Error("No selected model");
        await choice.submit({ type: "tier", accountKey: catalog.accountKey, modelId: selected.id, serviceTier });
      }} busy={choice.busy} error={choice.error} onSelect={async (effort) => {
        if (!catalog.accountKey || !selected) throw new Error("No selected model");
        await choice.submit({ type: "thinking", accountKey: catalog.accountKey, modelId: selected.id, effort });
      }} />
  </div>;
}
