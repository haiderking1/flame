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
import { rightPanel, useRightPanel } from "./components/agents/rightPanel";
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
  // The right panel shows the diff or the thread's agents, as T3 Code's right panel surfaces.
  const panel = useRightPanel(), diffOpen = panel.surface === "diff", agentsOpen = panel.surface === "agents";
  const [panelRetry, setPanelRetry] = useState(0);
  const DiffPanel = useMemo(() => lazy(() => import("./components/workspace/DiffPanel")), [panelRetry]);
  const AgentsPanel = useMemo(() => lazy(() => import("./components/agents/AgentsPanel")), [panelRetry]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("providers");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 767px)");
  const [sidebarOpen, setSidebarOpen] = useState(() => !mobile);
  const toggleSidebar = () => setSidebarOpen((open) => !open);
  const closeSidebar = () => setSidebarOpen(false);
  const diffButton = useRef<HTMLButtonElement>(null), agentsButton = useRef<HTMLButtonElement>(null);
  function openSettings() {
    rightPanel.close();
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
    rightPanel.close();
    diffButton.current?.focus();
  }
  function closeAgents() {
    rightPanel.close();
    // The toggle goes away with the thread's last agent; focus then returns to the composer.
    (agentsButton.current ?? document.querySelector<HTMLElement>(".workspace .composer__input"))?.focus();
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
        if (event.key === "Escape" && panel.surface && !event.defaultPrevented) {
          event.preventDefault();
          if (diffOpen) closeDiff(); else closeAgents();
        }
      }}>
        <ToastViewport scope={activeProject} />
        <UpdateToast />
        <FollowUpSender />
        <ThreadNotifications />
        <WorkspaceActions diffOpen={diffOpen} diffButtonRef={diffButton} onToggleDiff={() => rightPanel.toggle("diff")}
          agentsOpen={agentsOpen} agentsButtonRef={agentsButton} onToggleAgents={() => rightPanel.toggle("agents")} />
        <div className="workspace__body">
          <div className="workspace__chat">
            <SessionWorkspace />
          </div>
          {diffOpen && <PanelBoundary key={panelRetry} onClose={closeDiff} onRetry={() => setPanelRetry(value => value + 1)}><DiffPanel open onClose={closeDiff} /></PanelBoundary>}
          {agentsOpen && <PanelBoundary key={`agents-${panelRetry}`} onClose={closeAgents} onRetry={() => setPanelRetry(value => value + 1)}><AgentsPanel onClose={closeAgents} /></PanelBoundary>}
        </div>
      </main>
    </div>
  );
}
