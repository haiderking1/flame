import { lazy, useMemo, useRef, useState } from "react";
import { useAtomMount } from "@effect/atom-react";
import { codexAuthAtom } from "./backend/auth";
import { ProjectPicker } from "./components/projects/ProjectPicker";
import { SessionWorkspace } from "./components/sessions/SessionWorkspace";
import { WorkspaceActions } from "./components/workspace/WorkspaceActions";
import { ToastViewport } from "./components/toasts/ToastViewport";
import { UpdateToast } from "./components/updates/UpdateToast";
import { FollowUpSender } from "./components/composer/followUps/FollowUpSender";
import { ThreadNotifications } from "./components/notifications/ThreadNotifications";
import { SessionProvider, useSessions } from "./components/sessions/SessionContext";
import { PanelBoundary } from "./components/workspace/PanelBoundary";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SidebarToggle } from "./components/sidebar/SidebarToggle";
const SettingsPage = lazy(() => import("./components/settings/SettingsPage").then(module => ({ default: module.SettingsPage })));
import type { SettingsSection } from "./components/settings/SettingsNavigation";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useWindowTitlebar } from "./hooks/useWindowTitlebar";

export function App() { return <SessionProvider><Workspace /></SessionProvider>; }

function Workspace() {
  useWindowTitlebar();
  useAtomMount(codexAuthAtom);
  const sessions = useSessions();
  const activeProject = sessions?.document?.projectId ?? sessions?.projectDraftId ?? sessions?.projectScope ?? null;
  const [diffOpen, setDiffOpen] = useState(false);
  const [panelRetry, setPanelRetry] = useState(0);
  const DiffPanel = useMemo(() => lazy(() => import("./components/workspace/DiffPanel")), [panelRetry]);
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
      const target = document.querySelector<HTMLElement>(mobile || !sidebarOpen ? '.workspace .composer__input' : '.sidebar-footer button');
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
      {settingsOpen && <PanelBoundary onClose={closeSettings} onRetry={() => setPanelRetry(value => value + 1)}><SettingsPage section={settingsSection} sidebarVisible={sidebarOpen && !mobile} onClose={closeSettings} /></PanelBoundary>}
      <main className="workspace" hidden={settingsOpen} aria-label="Flame workspace" onKeyDown={(event) => {
        if (event.key === "Escape" && diffOpen && !event.defaultPrevented) {
          event.preventDefault();
          closeDiff();
        }
      }}>
        <ToastViewport scope={activeProject} />
        <UpdateToast />
        <FollowUpSender />
        <ThreadNotifications />
        <WorkspaceActions diffOpen={diffOpen} diffButtonRef={diffButton} onToggleDiff={() => setDiffOpen((open) => !open)} />
        <div className="workspace__body">
          <div className="workspace__chat">
            <SessionWorkspace />
          </div>
          {diffOpen && <PanelBoundary key={panelRetry} onClose={closeDiff} onRetry={() => setPanelRetry(value => value + 1)}><DiffPanel open onClose={closeDiff} /></PanelBoundary>}
        </div>
      </main>
    </div>
  );
}
