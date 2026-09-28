import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom } from "../../backend/projects";
import { useSessions } from "./SessionContext";
import { SessionDialog } from "./SessionDialog";

export function NewSessionDialog({ scope, onClose, onCreated }: { scope: string | null; onClose(): void; onCreated(projectId: string): void }) {
  const sessions = useSessions()!;
  const result = useAtomValue(projectsAtom);
  const projects = AsyncResult.isSuccess(result) ? result.value : [];
  const [projectId, setProjectId] = useState(scope ?? sessions.document?.projectId ?? (projects.length === 1 ? projects[0]!.id : ""));
  return <SessionDialog title="New session" action="Create session" busy={sessions.busy} error={sessions.error} onClose={onClose}
    onSubmit={() => { if (projectId) void sessions.newSession(projectId).then(() => onCreated(projectId), () => {}); }}>
    <label>Project<select aria-label="Session project" required value={projectId} disabled={sessions.busy} onChange={(event) => setProjectId(event.target.value)}>
      <option value="" disabled>Choose a project</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.path}</option>)}
    </select></label>
  </SessionDialog>;
}
