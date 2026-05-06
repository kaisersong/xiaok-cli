import { useState, createContext, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, PanelLeftClose } from 'lucide-react';
import { SidebarComponent } from '../components/Sidebar';
import { DesktopSettings } from '../components/DesktopSettings';

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, setCollapsed: () => {} });

export function useSidebarCollapse() {
  return useContext(SidebarContext);
}

export function AppLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (settingsOpen) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
        <DesktopSettings onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <SidebarContext.Provider value={{ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }}>
      <div className="relative flex h-screen overflow-hidden bg-[var(--c-bg-page)]">
        {/* Draggable title bar — absolute overlay on top of sidebar + content */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: 52,
            WebkitAppRegion: 'drag',
            zIndex: 200,
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            background: 'rgba(247,245,241,0.72)',
          } as React.CSSProperties}
        >
          {/* Collapse button (when sidebar visible) — horizontally aligned with traffic lights */}
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: 16, left: 212 } as React.CSSProperties}
              className="flex h-[20px] w-[20px] items-center justify-center rounded text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
              title="收起侧边栏"
            >
              <PanelLeftClose size={14} />
            </button>
          )}
          {/* Expand button (when sidebar hidden) */}
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: 16, left: 84 } as React.CSSProperties}
              className="flex h-[20px] w-[20px] items-center justify-center rounded text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
              title="展开侧边栏"
            >
              <Sidebar size={14} />
            </button>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1 w-full">
          {!sidebarCollapsed && (
            <div style={{ paddingTop: 52 }}>
              <SidebarComponent onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          )}
          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--c-bg-page)]" style={{ scrollbarGutter: 'stable', paddingTop: 52 }}>
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
