import { useEffect, useRef, useState } from "react";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { addProjectAtom, browseAtom, resultMessage } from "../../backend/projects";
import { directoryQuery, folderQuery } from "./folderPath";
import type { Project } from "@contracts/projects";
import { PickerIcon } from "./PickerIcon";
import { PickerFooter } from "./PickerFooter";

export function FolderBrowser({ onBack, onAdded }: { onBack(): void; onAdded(project: Project): void }) {
  const [query, setQuery] = useState("~/");
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const parsed = folderQuery(query);
  const atom = browseAtom(parsed.directory);
  const result = useAtomValue(atom);
  const retry = useAtomRefresh(atom);
  const add = useAtomSet(addProjectAtom, { mode: "promise" });
  const added = useAtomValue(addProjectAtom);
  const data = AsyncResult.isSuccess(result) && !result.waiting ? result.value : null;
  const entries = data?.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(parsed.filter.toLocaleLowerCase())) ?? [];
  const index = Math.min(selected, Math.max(0, entries.length - 1));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { document.getElementById(`folder-option-${index}`)?.scrollIntoView({ block: "nearest" }); }, [index, query, data]);
  function navigate(path: string) { setQuery(directoryQuery(path)); setSelected(0); input.current?.focus(); }
  async function submit() {
    if (!data || busy.current || parsed.filter) return;
    busy.current = true; setSaving(true);
    try { const project = await add(data.path); if (mounted.current) onAdded(project); }
    catch { /* The mutation atom exposes the typed error below. */ }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  }
  const error = resultMessage(result);
  return <section className="folder-browser" aria-label="Choose a local folder" onKeyDown={(event) => {
    if (saving) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
    else if (event.target === input.current && event.key === "ArrowDown") { event.preventDefault(); setSelected(Math.min(entries.length - 1, index + 1)); }
    else if (event.target === input.current && event.key === "ArrowUp") { event.preventDefault(); setSelected(Math.max(0, index - 1)); }
    else if (event.target === input.current && event.key === "Enter" && entries[index]) { event.preventDefault(); navigate(entries[index].path); }
    else if (event.target === input.current && event.key === "Backspace" && !parsed.filter && data?.parent && input.current?.selectionStart === query.length) { event.preventDefault(); navigate(data.parent); }
  }}>
    <header className="project-picker__header">
      <button type="button" aria-label="Back to project sources" onClick={onBack} disabled={saving}><PickerIcon name="back" /></button>
      <input ref={input} autoFocus aria-label="Folder path" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="folder-options" aria-activedescendant={entries[index] ? `folder-option-${index}` : undefined}
        value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} spellCheck={false} disabled={saving} />
      <button type="button" className="project-picker__add" onMouseDown={(event) => event.preventDefault()} onClick={() => void submit()} disabled={!data || saving || Boolean(parsed.filter)}>{saving ? "Adding…" : "Add"}<kbd>Ctrl Enter</kbd></button>
    </header>
    <div className="project-picker__body" aria-busy={result.waiting}>
      <p className="project-picker__label">Directories</p>
      {result.waiting || AsyncResult.isInitial(result) ? <p role="status">Loading folders…</p> : null}
      {error ? <p role="alert">{error} <button type="button" onClick={retry}>Retry</button></p> : null}
      <div id="folder-options" role="listbox" aria-label="Directories">
        {entries.map((entry, i) => <div key={entry.path} id={`folder-option-${i}`} role="option" aria-selected={i === index} className="project-picker__option" onMouseMove={() => setSelected(i)}>
          <button type="button" tabIndex={-1} disabled={saving} onMouseDown={(event) => event.preventDefault()} onClick={() => navigate(entry.path)}><PickerIcon name="folder" /><span>{entry.name}</span></button>
        </div>)}
      </div>
      {data && entries.length === 0 ? <p role="status">{parsed.filter ? "No matching folders." : "No visible subfolders. You can add this folder."}</p> : null}
      {data?.truncated ? <p role="status">This directory is large. Showing a limited listing; type a full folder path to navigate directly.</p> : null}
      {resultMessage(added) ? <p role="alert">{resultMessage(added)}</p> : null}
    </div>
    <PickerFooter />
  </section>;
}
