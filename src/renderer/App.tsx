import { useRef, useState } from "react";
import type { Project } from "@contracts/projects";
import { ProjectPicker } from "./components/projects/ProjectPicker";
import { Composer } from "./components/composer/Composer";
import { WorkspaceActions } from "./components/workspace/WorkspaceActions";
import { DiffPanel } from "./components/workspace/DiffPanel";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SidebarToggle } from "./components/sidebar/SidebarToggle";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useWindowTitlebar } from "./hooks/useWindowTitlebar";

export function App() {
  useWindowTitlebar();
  const [diffOpen, setDiffOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const mobile = useMediaQuery("(max-width: 767px)");
  const [sidebarOpen, setSidebarOpen] = useState(() => !mobile);
  const toggleSidebar = () => setSidebarOpen((open) => !open);
  const closeSidebar = () => setSidebarOpen(false);
  const diffButton = useRef<HTMLButtonElement>(null);
  function closeDiff() {
    setDiffOpen(false);
    diffButton.current?.focus();
  }

  return (
    <div className="app-shell">
      <div className="window-titlebar" aria-hidden="true" />
      <SidebarToggle expanded={sidebarOpen} onToggle={toggleSidebar} />
      <Sidebar expanded={sidebarOpen} mobile={mobile} onClose={closeSidebar}
        onNewProject={() => setProjectPickerOpen(true)} selectedProject={selectedProject?.id ?? null} onSelectProject={setSelectedProject} />
      {projectPickerOpen && <ProjectPicker onClose={() => setProjectPickerOpen(false)} onAdded={(project) => { setSelectedProject(project); setProjectPickerOpen(false); }} />}
      <main className="workspace" aria-label="Flame workspace" onKeyDown={(event) => {
        if (event.key === "Escape" && diffOpen && !event.defaultPrevented) {
          event.preventDefault();
          closeDiff();
        }
      }}>
        <WorkspaceActions diffOpen={diffOpen} diffButtonRef={diffButton} onToggleDiff={() => setDiffOpen((open) => !open)} />
        <div className="workspace__body">
          <div className="workspace__chat">
            <div className="workspace__composer">
              <Composer />
            </div>
          </div>
          <DiffPanel open={diffOpen} onClose={closeDiff} />
        </div>
      </main>
    </div>
  );
}
