import { useDeferredValue, useId, useLayoutEffect, useRef, useState } from "react";
import openaiLogo from "../../../assets/providers/openai.svg?no-inline";
import { ComposerChevron } from "../ComposerChevron";
import { filterModels, isLegacyModel, type ModelOption } from "./modelOptions";
import { ModelPickerList } from "./ModelPickerList";
import { useComposerPopoverPosition } from "../useComposerPopoverPosition";
import "./model-picker.css";

export function ModelPicker({ models, selectedId, onSelect, emptyMessage = "No models available yet.", error, busy = false, placeholder }: {
  models: readonly ModelOption[]; selectedId: string | null; onSelect(id: string): void | Promise<void>;
  emptyMessage?: string; error?: string | null; busy?: boolean; placeholder?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const matches = filterModels(models, deferredQuery);
  const current = matches.filter((model) => !isLegacyModel(model));
  const legacy = matches.filter(isLegacyModel);
  const searching = !!query.trim();
  const expanded = legacyOpen || searching;
  const options = [...current, ...(expanded ? legacy : [])];
  const selected = models.find((model) => model.id === selectedId);
  const index = options.findIndex((model) => model.id === highlighted);
  useComposerPopoverPosition(open, popup, trigger);
  useLayoutEffect(() => { if (open) input.current?.focus(); }, [open]);
  useLayoutEffect(() => {
    if (open) document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [open, index, query, id]);
  function close() { popup.current?.hidePopover(); trigger.current?.focus(); }
  async function select(model: ModelOption) {
    if (busy || query !== deferredQuery) return;
    try { await onSelect(model.id); close(); } catch { /* Keep the picker open to show the save error. */ }
  }
  return <>
    <button ref={trigger} type="button" aria-busy={busy} onClick={(event) => { if (busy) event.preventDefault(); }} className="composer-settings__control composer-settings__model" aria-label={selected ? `Select model: ${selected.name}` : !selectedId && placeholder ? `Select model: ${placeholder}` : "Select model"}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} popoverTarget={id}>
      <span className="model-picker__logo model-picker__trigger-logo"><img src={openaiLogo} alt="" /></span>
      <span className="composer-settings__label">{selected?.name ?? selectedId ?? placeholder ?? "Select model"}</span><ComposerChevron />
    </button>
    <div ref={popup} id={id} popover="auto" className="model-picker" data-keyboard={index >= 0 || undefined} onPointerMove={() => setHighlighted(null)} onToggle={(event) => {
      setOpen(event.newState === "open");
      if (event.newState === "open") { setQuery(""); setHighlighted(null); setLegacyOpen(false); }
    }} onBlur={(event) => {
      if (event.relatedTarget && event.relatedTarget !== trigger.current && !event.currentTarget.contains(event.relatedTarget)) popup.current?.hidePopover();
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <header className="model-picker__header">
        <span className="model-picker__provider" title="OpenAI"><span className="model-picker__logo"><img src={openaiLogo} alt="OpenAI" /></span></span>
        <div className="model-picker__search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input ref={input} value={query} placeholder="Search models..." aria-label="Search models" role="combobox" aria-expanded={open} aria-controls={`${id}-list ${id}-legacy-list`} aria-autocomplete="list"
            aria-activedescendant={index >= 0 ? `${id}-option-${index}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setHighlighted(null); }}
            onKeyDown={(event) => {
              if (query !== deferredQuery) return;
              if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
                event.preventDefault();
                const next = index < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1)
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                setHighlighted(options[next]!.id);
              } else if (event.key === "Enter") {
                event.preventDefault();
                const model = options[Math.max(index, 0)];
                if (model) select(model);
              }
            }} />
        </div>
      </header>
      {query !== deferredQuery && <p className="model-picker__empty" role="status">Updating results…</p>}
      <ModelPickerList id={id} current={current} legacy={legacy} expanded={expanded} searching={searching} selectedId={selectedId} highlightedIndex={index}
        onSelect={select} onToggle={() => {
          setLegacyOpen(!legacyOpen);
          setHighlighted(null);
          input.current?.focus();
        }} />
      {!matches.length && <p className="model-picker__empty" role="status">{models.length ? "No matching models." : emptyMessage}</p>}
      {error && <footer className="model-picker__footer"><p role="alert">{error}</p></footer>}
    </div>
  </>;
}
