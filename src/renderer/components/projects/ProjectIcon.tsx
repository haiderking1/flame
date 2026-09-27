import type { Project } from "@contracts/projects";
import "./project-icon.css";

export function ProjectIcon({ project }: { project: Project }) {
  return <span className="project-icon" aria-hidden="true">{Array.from(project.name).slice(0, 2).join("").toUpperCase()}</span>;
}
