import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom, resultMessage } from "../../backend/projects";
import type { Project } from "@contracts/projects";
import "./project-list.css";

export function ProjectList({ selected, onSelect }: { selected: string | null; onSelect(project: Project): void }) {
  const result = useAtomValue(projectsAtom);
  const retry = useAtomRefresh(projectsAtom);
  if (AsyncResult.isInitial(result)) return <p className="project-list__status" role="status">Loading projects…</p>;
  if (!AsyncResult.isSuccess(result)) return <p className="project-list__status" role="alert">{resultMessage(result)} <button onClick={retry}>Retry</button></p>;
  return <nav className="project-list" aria-label="Projects">{result.value.map((project) =>
    <button type="button" key={project.id} title={project.path} aria-current={selected === project.id ? "true" : undefined} onClick={() => onSelect(project)}>
      <span className="project-list__initial" aria-hidden="true">{Array.from(project.name).slice(0, 2).join("").toUpperCase()}</span><span>{project.name}</span>
    </button>,
  )}</nav>;
}
