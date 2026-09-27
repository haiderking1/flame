import type { Project } from "@contracts/projects";
import { ProjectList } from "../projects/ProjectList";
import { useSidebarResize } from "./useSidebarResize";
import { SidebarToolbar } from "./SidebarToolbar";
import { SidebarBrand } from "./SidebarBrand";
import "./sidebar.css";
import { SidebarDrawer } from "./SidebarDrawer";

export function Sidebar({ expanded, mobile = false, onClose, onNewProject, selectedProject, onSelectProject }: {
  expanded: boolean; mobile?: boolean; onClose(): void; onNewProject(): void;
  selectedProject: string | null; onSelectProject(project: Project): void;
}) {
  const { width, minimum, maximum, resizing, handleProps } = useSidebarResize();
  const content = (
    <aside hidden={!expanded} id="workspace-sidebar" className="sidebar" aria-label="Sidebar" style={mobile ? undefined : { width }} data-resizing={resizing}>
      <div className="sidebar__header">
        {!mobile && <SidebarBrand />}
      </div>
      <SidebarToolbar onNewProject={onNewProject} />
      <ProjectList selected={selectedProject} onSelect={onSelectProject} />
      {!mobile && <div className="sidebar__resize" role="separator" tabIndex={0}
        aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="workspace-sidebar"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
        aria-valuetext={`${Math.round(width)} pixels`}
        {...handleProps} />}
    </aside>
  );
  return mobile ? <SidebarDrawer open={expanded} onClose={onClose}>{content}</SidebarDrawer> : content;
}
