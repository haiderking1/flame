import openaiLogo from "../../../assets/providers/openai.svg?no-inline";
import type { ModelOption } from "./modelOptions";

export function ModelPickerList({ id, current, legacy, expanded, searching, selectedId, highlightedIndex, onSelect, onToggle }: {
  id: string; current: readonly ModelOption[]; legacy: readonly ModelOption[]; expanded: boolean; searching: boolean;
  selectedId: string | null; highlightedIndex: number; onSelect(model: ModelOption): void; onToggle(): void;
}) {
  function row(model: ModelOption, position: number) {
    return <div key={model.id} id={`${id}-option-${position}`} role="option" aria-selected={model.id === selectedId} data-highlighted={position === highlightedIndex || undefined}
      className="model-picker__option" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(model)}>
      <div><span className="model-picker__name">{model.name}</span><span className="model-picker__attribution"><span className="model-picker__logo model-picker__row-logo"><img src={openaiLogo} alt="" /></span>Codex</span></div>
      {model.id === selectedId && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
    </div>;
  }
  return <div className="model-picker__list flame-scrollbar">
    <div id={`${id}-list`} role="listbox" aria-label="OpenAI models">{current.map(row)}</div>
    {legacy.length > 0 && <button type="button" className="model-picker__legacy" aria-expanded={expanded} aria-controls={`${id}-legacy-list`} disabled={searching}
      title={searching ? "Search includes legacy models" : undefined} onClick={onToggle}>
      <span><span>Legacy models</span><small>{legacy.length} {legacy.length === 1 ? "model" : "models"}</small></span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={expanded ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} /></svg>
    </button>}
    <div id={`${id}-legacy-list`} role="listbox" aria-label="Legacy OpenAI models" hidden={!expanded || !legacy.length}>
      {expanded && legacy.map((model, index) => row(model, current.length + index))}
    </div>
  </div>;
}
