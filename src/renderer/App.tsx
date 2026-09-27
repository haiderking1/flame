import { useRef, useState } from "react";
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
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 767px)");
  const sidebarOpen = mobile ? mobileSidebarOpen : sidebarExpanded;
  const toggleSidebar = () => mobile ? setMobileSidebarOpen((open) => !open) : setSidebarExpanded((open) => !open);
  const closeSidebar = () => setMobileSidebarOpen(false);
  const diffButton = useRef<HTMLButtonElement>(null);
  function closeDiff() {
    setDiffOpen(false);
    diffButton.current?.focus();
  }

  return (
    <div className="app-shell">
      <div className="window-titlebar" aria-hidden="true" />
      <SidebarToggle expanded={sidebarOpen} onToggle={toggleSidebar} />
      <Sidebar expanded={sidebarOpen} mobile={mobile} onClose={closeSidebar} />
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
