import { useState } from "react";
import { NewSessionDialog } from "../sessions/NewSessionDialog";
import { useSessions } from "../sessions/SessionContext";
import { SidebarThreads } from "./SidebarThreads";
import { useSidebarResize } from "./useSidebarResize";
import { SidebarToolbar } from "./SidebarToolbar";
import { SidebarBrand } from "./SidebarBrand";
import "./sidebar.css";
import { SidebarDrawer } from "./SidebarDrawer";
import { SidebarFooter } from "./SidebarFooter";
import { SettingsNavigation, type SettingsSection } from "../settings/SettingsNavigation";

export function Sidebar({ expanded, mobile = false, onClose, onNewProject, settings, onSettings, onBack, settingsSection, onSettingsSection }: {
  expanded: boolean; mobile?: boolean; onClose(): void; onNewProject(): void;
  settings: boolean; onSettings(): void; onBack(): void;
  settingsSection: SettingsSection; onSettingsSection(section: SettingsSection): void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const sessions = useSessions()!;
  const { projectScope, setProjectScope } = sessions;
  const { width, minimum, maximum, resizing, handleProps } = useSidebarResize();
  const content = (
    <aside hidden={!expanded} id="workspace-sidebar" className="sidebar" aria-label="Sidebar" style={mobile ? undefined : { width }} data-resizing={resizing}>
      <div className="sidebar__header">
        {!mobile && <SidebarBrand />}
      </div>
      {settings ? <SettingsNavigation section={settingsSection} onSelect={(section) => { onSettingsSection(section); if (mobile) onClose(); }} /> : <>
        <SidebarToolbar onNewProject={onNewProject} scope={projectScope} onScopeChange={(id) => { void sessions.selectProject(id).then(() => { if (mobile && id) onClose(); }).catch(() => {}); }}
          search={search} onSearch={setSearch} onNewSession={() => setCreating(true)} busy={!!sessions?.busy} />
        <SidebarThreads scope={projectScope} search={search} onNewProject={onNewProject} onOpened={() => { if (mobile) onClose(); }} />
      </>}
      <SidebarFooter settings={settings} onClick={settings ? onBack : onSettings} />
      {!mobile && <div className="sidebar__resize" role="separator" tabIndex={0}
        aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="workspace-sidebar"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
        aria-valuetext={`${Math.round(width)} pixels`}
        {...handleProps} />}
    </aside>
  );
  return <>{mobile ? <SidebarDrawer open={expanded} onClose={onClose}>{content}</SidebarDrawer> : content}
    {creating && <NewSessionDialog scope={projectScope} onClose={() => setCreating(false)} onNewProject={() => { setCreating(false); onNewProject(); }} onCreated={(projectId) => {
      setCreating(false); setSearch("");
      if (projectScope) setProjectScope(projectId);
      if (mobile) onClose();
    }} />}
  </>;
}
