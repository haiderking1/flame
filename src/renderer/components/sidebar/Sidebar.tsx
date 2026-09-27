import { useSidebarResize } from "./useSidebarResize";
import { SidebarToolbar } from "./SidebarToolbar";
import { SidebarBrand } from "./SidebarBrand";
import "./sidebar.css";
import { SidebarDrawer } from "./SidebarDrawer";

export function Sidebar({ expanded, mobile = false, onClose }: { expanded: boolean; mobile?: boolean; onClose: () => void }) {
  const { width, minimum, maximum, resizing, handleProps } = useSidebarResize();
  const content = (
    <aside hidden={!expanded} id="workspace-sidebar" className="sidebar" aria-label="Sidebar" style={mobile ? undefined : { width }} data-resizing={resizing}>
      <div className="sidebar__header">
        {!mobile && <SidebarBrand />}
      </div>
      <SidebarToolbar />
      {!mobile && <div className="sidebar__resize" role="separator" tabIndex={0}
        aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="workspace-sidebar"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
        aria-valuetext={`${Math.round(width)} pixels`}
        {...handleProps} />}
    </aside>
  );
  return mobile ? <SidebarDrawer open={expanded} onClose={onClose}>{content}</SidebarDrawer> : content;
}
