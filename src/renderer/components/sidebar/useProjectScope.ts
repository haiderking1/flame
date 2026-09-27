import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom } from "../../backend/projects";

const storageKey = "flame.sidebar.projectScope";

export function useProjectScope() {
  const projects = useAtomValue(projectsAtom);
  const [scope, setScope] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored && stored.length <= 128 ? stored : null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (scope === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, scope);
    } catch { /* Filtering still works when preference storage is unavailable. */ }
  }, [scope]);
  useEffect(() => {
    if (scope !== null && AsyncResult.isSuccess(projects) && !projects.value.some((project) => project.id === scope)) setScope(null);
  }, [projects, scope]);
  return [scope, setScope] as const;
}
