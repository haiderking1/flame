import { useRef, useState } from "react";
import { useAtomMount } from "@effect/atom-react";
import { codexAuthAtom } from "./backend/auth";
import { ProjectPicker } from "./components/projects/ProjectPicker";
import { SessionProvider } from "./components/sessions/SessionContext";
import { SessionWorkspace } from "./components/sessions/SessionWorkspace";
import { WorkspaceActions } from "./components/workspace/WorkspaceActions";
import { DiffPanel } from "./components/workspace/DiffPanel";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SidebarToggle } from "./components/sidebar/SidebarToggle";
import { SettingsPage } from "./components/settings/SettingsPage";
import type { SettingsSection } from "./components/settings/SettingsNavigation";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useWindowTitlebar } from "./hooks/useWindowTitlebar";

export function App() { return <SessionProvider><Workspace /></SessionProvider>; }

function Workspace() {
  useWindowTitlebar();
  useAtomMount(codexAuthAtom);
  const [diffOpen, setDiffOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("providers");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 767px)");
  const [sidebarOpen, setSidebarOpen] = useState(() => !mobile);
  const toggleSidebar = () => setSidebarOpen((open) => !open);
  const closeSidebar = () => setSidebarOpen(false);
  const diffButton = useRef<HTMLButtonElement>(null);
  function openSettings() {
    setDiffOpen(false);
    setSettingsOpen(true);
    if (mobile) setSidebarOpen(false);
  }
  function closeSettings() {
    setSettingsOpen(false);
    if (mobile) setSidebarOpen(false);
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(mobile || !sidebarOpen ? '.workspace textarea' : '.sidebar-footer button');
      target?.focus();
    });
  }
  function closeDiff() {
    setDiffOpen(false);
    diffButton.current?.focus();
  }

  return (
    <div className="app-shell">
      <div className="window-titlebar" aria-hidden="true" />
      <SidebarToggle expanded={sidebarOpen} onToggle={toggleSidebar} />
      <Sidebar expanded={sidebarOpen} mobile={mobile} onClose={closeSidebar}
        onNewProject={() => setProjectPickerOpen(true)} settings={settingsOpen} onSettings={openSettings} onBack={closeSettings} settingsSection={settingsSection} onSettingsSection={setSettingsSection} />
      {projectPickerOpen && <ProjectPicker onClose={() => setProjectPickerOpen(false)} onAdded={() => setProjectPickerOpen(false)} />}
      {settingsOpen && <SettingsPage section={settingsSection} sidebarVisible={sidebarOpen && !mobile} onClose={closeSettings} />}
      <main className="workspace" hidden={settingsOpen} aria-label="Flame workspace" onKeyDown={(event) => {
        if (event.key === "Escape" && diffOpen && !event.defaultPrevented) {
          event.preventDefault();
          closeDiff();
        }
      }}>
        <WorkspaceActions diffOpen={diffOpen} diffButtonRef={diffButton} onToggleDiff={() => setDiffOpen((open) => !open)} />
        <div className="workspace__body">
          <div className="workspace__chat">
            <SessionWorkspace />
          </div>
          <DiffPanel open={diffOpen} onClose={closeDiff} />
        </div>
      </main>
    </div>
  );
}
