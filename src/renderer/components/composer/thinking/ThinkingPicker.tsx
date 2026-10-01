import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CatalogModel, ServiceTier } from "@contracts/models";
import { ComposerChevron } from "../ComposerChevron";
import { useComposerPopoverPosition } from "../useComposerPopoverPosition";
import { effortLabel } from "./effortLabel";
import { ServiceTierOptions } from "./ServiceTierOptions";
import "./thinking-picker.css";
import { returnFocus, settleTriggerFocus } from "../../../lib/returnFocus";

export function ThinkingPicker({ model, effort, serviceTier, busy, error, onSelect, onSelectTier }: {
  model: CatalogModel | undefined; effort: string | null; serviceTier: ServiceTier; busy: boolean; error: string | null;
  onSelect(effort: string): Promise<void>; onSelectTier(value: ServiceTier): Promise<void>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [open, setOpen] = useState(false);
  const levels = model?.reasoningLevels ?? [];
  const label = effort ? effortLabel(effort) : model && levels.length ? "Default" : "Thinking";
  useComposerPopoverPosition(open, popup, trigger);
  useLayoutEffect(() => {
    if (open) {
      const items = popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      const index = Math.max(0, levels.findIndex((level) => level.effort === effort));
      items?.[index]?.focus();
    }
  }, [open, levels]);
  function close() { popup.current?.hidePopover(); returnFocus(trigger.current); }
  async function select(work: () => Promise<void>) {
    if (busy || saving.current) return;
    saving.current = true;
    try { await work(); close(); }
    catch { /* Keep the menu open and show the backend validation/save error. */ }
    finally { saving.current = false; }
  }
  return <>
    <button ref={trigger} type="button" className="composer-settings__control composer-settings__thinking" popoverTarget={id}
      onClick={(event) => { if (busy) event.preventDefault(); }}
      disabled={!model} aria-label={model && levels.length ? `Thinking level: ${label}` : "Thinking level"}
      title={!model ? "Select a model first" : "Select thinking level and service tier"}
      aria-haspopup="menu" aria-controls={`${id}-menu`} aria-expanded={open} aria-busy={busy}>
      <span>{label}</span>{serviceTier === "priority" && <small className="thinking-picker__default">Fast</small>}<ComposerChevron />
    </button>
    <div ref={popup} id={id} popover="auto" className="thinking-picker" onToggle={(event) => { setOpen(event.newState === "open"); if (event.newState === "closed") settleTriggerFocus(trigger.current); }}
      onBlur={(event) => {
        if (event.relatedTarget && event.relatedTarget !== trigger.current && !event.currentTarget.contains(event.relatedTarget)) popup.current?.hidePopover();
      }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        const index = items.findIndex((item) => item === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <div id={`${id}-menu`} role="menu" aria-label="Thinking level and service tier" className="thinking-picker__list flame-scrollbar">
        {levels.length > 0 && <h3 className="thinking-picker__heading">Reasoning</h3>}
        <div role="group" aria-label="Reasoning">
        {levels.map((level) => <button key={level.effort} type="button" role="menuitemradio" aria-checked={effort === level.effort}
          aria-disabled={busy} className="thinking-picker__option" title={level.description || undefined} onClick={() => void select(() => onSelect(level.effort))}>
          <span>{effortLabel(level.effort)}</span>
          {model?.defaultReasoning === level.effort && <small className="thinking-picker__default">Default</small>}
        </button>)}
        </div>
        {model && <ServiceTierOptions value={serviceTier} supportsFast={model.supportsFast} busy={busy}
          onSelect={(value) => void select(() => onSelectTier(value))} />}
      </div>
      {error && <p role="alert" className="thinking-picker__error">{error}</p>}
    </div>
  </>;
}
