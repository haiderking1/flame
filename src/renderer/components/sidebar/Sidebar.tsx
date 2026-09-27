import { SidebarThreads } from "./SidebarThreads";
import { useProjectScope } from "./useProjectScope";
import { useSidebarResize } from "./useSidebarResize";
import { SidebarToolbar } from "./SidebarToolbar";
import { SidebarBrand } from "./SidebarBrand";
import "./sidebar.css";
import { SidebarDrawer } from "./SidebarDrawer";

export function Sidebar({ expanded, mobile = false, onClose, onNewProject }: {
  expanded: boolean; mobile?: boolean; onClose(): void; onNewProject(): void;
}) {
  const [projectScope, setProjectScope] = useProjectScope();
  const { width, minimum, maximum, resizing, handleProps } = useSidebarResize();
  const content = (
    <aside hidden={!expanded} id="workspace-sidebar" className="sidebar" aria-label="Sidebar" style={mobile ? undefined : { width }} data-resizing={resizing}>
      <div className="sidebar__header">
        {!mobile && <SidebarBrand />}
      </div>
      <SidebarToolbar onNewProject={onNewProject} scope={projectScope} onScopeChange={setProjectScope} />
      <SidebarThreads scope={projectScope} onNewProject={onNewProject} />
      {!mobile && <div className="sidebar__resize" role="separator" tabIndex={0}
        aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="workspace-sidebar"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
        aria-valuetext={`${Math.round(width)} pixels`}
        {...handleProps} />}
    </aside>
  );
  return mobile ? <SidebarDrawer open={expanded} onClose={onClose}>{content}</SidebarDrawer> : content;
}
