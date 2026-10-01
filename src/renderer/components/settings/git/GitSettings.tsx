import type { ModelSelection } from "@contracts/models";
import { ModelPicker } from "../../composer/models/ModelPicker";
import { useModelCatalog } from "../../composer/models/useModelCatalog";
import { ThinkingPicker } from "../../composer/thinking/ThinkingPicker";
import { useGitTextModel } from "./useGitTextModel";
import "../../composer/composer-settings.css";
import "./git-settings.css";

export function GitSettings() {
  const catalog = useModelCatalog();
  const save = useGitTextModel(catalog.accountKey);
  const saved = catalog.gitText;
  const model = catalog.models.find((model) => model.id === saved?.modelId);
  const missing = !!saved && catalog.loaded && !model;
  const status = !saved ? "Uses the model selected in the composer."
    : missing ? `${saved.modelId} is no longer available, so the chat model writes Git text until you choose another.`
    : "Writes every commit message, branch name, pull request and thread title Flame generates.";
  const choose = (selection: ModelSelection) => save.submit(selection);
  return <section className="git-settings" aria-labelledby="git-settings-heading">
    <h1 id="git-settings-heading">Git</h1>
    <div className="git-settings__list">
      <article className="git-settings__row" aria-labelledby="git-text-model-heading" aria-describedby="git-text-model-description">
        <div className="git-settings__text">
          <h2 id="git-text-model-heading">Text generation model</h2>
          <p id="git-text-model-description" aria-live="polite" data-warning={missing || undefined}>{status}</p>
        </div>
        <div className="git-settings__controls composer-settings" role="group" aria-label="Text generation model">
          <ModelPicker key={catalog.accountKey ?? "disconnected"} models={catalog.models} selectedId={saved?.modelId ?? null} placeholder="Same as chat"
            onSelect={async (modelId) => {
              const next = catalog.models.find((model) => model.id === modelId);
              if (!next) throw new Error("Model unavailable");
              const effort = next.reasoningLevels.some((level) => level.effort === saved?.effort) ? saved!.effort : next.defaultReasoning;
              await choose({ modelId, effort, serviceTier: next.supportsFast ? saved?.serviceTier ?? "default" : "default" });
            }} emptyMessage={catalog.emptyMessage} error={save.error ?? catalog.error} busy={save.busy} />
          {saved && <>
            <span className="composer-settings__divider" aria-hidden="true" />
            <ThinkingPicker key={`${catalog.accountKey ?? ""}:${saved.modelId}`} model={model} effort={saved.effort} serviceTier={saved.serviceTier}
              busy={save.busy} error={save.error} onSelect={(effort) => choose({ ...saved, effort })}
              onSelectTier={(serviceTier) => choose({ ...saved, serviceTier })} />
            <button type="button" className="git-settings__reset" disabled={save.busy}
              onClick={() => { save.submit(null).catch(() => { /* Rendered from the save result below. */ }); }}>Use chat model</button>
          </>}
        </div>
      </article>
      {save.error && <p className="git-settings__error" role="alert">{save.error}</p>}
    </div>
  </section>;
}
