import type { Project } from "@contracts/projects";
import "./project-icon.css";
import { projectIdentity } from "./projectIdentity";

export function ProjectIcon({ project }: { project: Project }) {
  const identity = projectIdentity(project.name);
  return <span className="project-icon" aria-hidden="true" style={{ color: identity.color }}>
    <svg viewBox="0 0 16 16" width="16" height="16">
      <rect width="16" height="16" rx="4" fill="currentColor" fillOpacity=".14" />
      <text x="8" y="10.8" textAnchor="middle" fill="currentColor" fontSize="8.25" fontWeight="700" textLength="12" lengthAdjust="spacingAndGlyphs">{identity.label}</text>
    </svg>
  </span>;
}
