import { useDeferredValue, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom, resultMessage } from "../../backend/projects";
import { PickerIcon } from "./PickerIcon";
import { ProjectIcon } from "./ProjectIcon";
import { useProjectFilterPosition } from "./useProjectFilterPosition";
import "./project-filter.css";
import { VirtualOptions } from "../virtual/VirtualOptions";

export function ProjectFilter({ scope, onChange, anchor }: {
  scope: string | null; onChange(id: string | null): void; anchor: RefObject<HTMLElement | null>;
}) {
  const result = useAtomValue(projectsAtom);
  const retry = useAtomRefresh(projectsAtom);
  const projects = AsyncResult.isSuccess(result) ? result.value : [];
  const selected = projects.find((project) => project.id === scope);
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const options = [{ id: null, name: "All projects", project: null }, ...projects.map((project) => ({ ...project, project }))]
    .filter((option) => !deferredQuery.trim() || (option.project !== null && option.name.toLocaleLowerCase().includes(deferredQuery.trim().toLocaleLowerCase())));
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === highlighted));
  useProjectFilterPosition(open, popup, anchor);
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, id]);
  function close() { popup.current?.hidePopover(); setOpen(false); trigger.current?.focus(); }
  function select(value: string | null) { if (query !== deferredQuery) return; onChange(value); close(); }
  const label = selected ? `Filter threads by project: ${selected.name}` : "Filter threads by project";
  return <>
    <button type="button" ref={trigger} aria-label={label} title={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} popoverTarget={id}>
      {selected ? <ProjectIcon project={selected} /> : <PickerIcon name="folder" />}
    </button>
    <div ref={popup} id={id} popover="auto" className="project-filter" onToggle={(event) => {
      const opening = event.newState === "open";
      setOpen(opening);
      if (opening) { setQuery(""); setHighlighted(scope); input.current?.focus(); }
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") close();
    }}>
      <div className="project-filter__search"><div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></svg>
        <input ref={input} role="combobox" aria-label="Search projects" placeholder="Search projects..." aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={options.length ? `${id}-option-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setHighlighted(null); }} onKeyDown={(event) => {
          if (query !== deferredQuery) return;
          if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next = options[(activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length];
            if (next) setHighlighted(next.id);
          } else if (event.key === "Enter" && options[activeIndex]) {
            event.preventDefault(); select(options[activeIndex].id);
          }
        }} />
      </div></div>
      <div className="project-filter__list" id={`${id}-list`} role="listbox" aria-label="Projects to show">
        <VirtualOptions items={options} itemKey={option => option.id ?? "all"} selectedIndex={activeIndex} render={(option, index) => <div role="option" key={option.id ?? "all"} id={`${id}-option-${index}`} aria-selected={scope === option.id} data-highlighted={activeIndex === index || undefined} className="project-filter__option" title={option.project?.path} onPointerMove={() => setHighlighted(option.id)} onMouseDown={(event) => event.preventDefault()} onClick={() => select(option.id)}>
          {option.project ? <ProjectIcon project={option.project} /> : <PickerIcon name="folder" />}
          <span className="project-filter__name">{option.name}</span>
          {option.project && <button type="button" disabled className="project-filter__settings" aria-label={`Project settings for ${option.name} (not available yet)`} title="Project settings are not available yet">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 3-.7 2.3-2 .9-2.2-.5-2 3.5 1.5 1.8v2l-1.5 1.8 2 3.5 2.2-.5 2 .9L9 21h4l.7-2.3 2-.9 2.2.5 2-3.5-1.5-1.8v-2l1.5-1.8-2-3.5-2.2.5-2-.9L13 3Z" /><circle cx="11" cy="12" r="3" /></svg>
          </button>}
        </div>} />
        {!options.length && <p className="project-filter__status" role="status">No matching projects.</p>}
      </div>
      {AsyncResult.isInitial(result) && <p className="project-filter__status" role="status">Loading projects…</p>}
      {AsyncResult.isFailure(result) && <p className="project-filter__status" role="alert">{resultMessage(result)} <button type="button" onClick={retry}>Retry</button></p>}
    </div>
  </>;
}
