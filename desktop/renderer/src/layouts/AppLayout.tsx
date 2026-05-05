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
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
        {/* Draggable title bar - spans full width, traffic lights are at left */}
        <div
          style={{ height: 36, WebkitAppRegion: 'drag', flexShrink: 0, position: 'relative' } as React.CSSProperties}
        >
          {/* Collapse button (when sidebar visible) - inside sidebar column area */}
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: 8, left: 212 } as React.CSSProperties}
              className="flex h-[20px] w-[20px] items-center justify-center rounded text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors z-50"
              title="收起侧边栏"
            >
              <PanelLeftClose size={15} />
            </button>
          )}
          {/* Expand button (when sidebar hidden) */}
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: 8, left: 84 } as React.CSSProperties}
              className="flex h-[20px] w-[20px] items-center justify-center rounded text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors z-50"
              title="展开侧边栏"
            >
              <Sidebar size={15} />
            </button>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          {!sidebarCollapsed && (
            <SidebarComponent onOpenSettings={() => setSettingsOpen(true)} />
          )}
          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--c-bg-page)]" style={{ scrollbarGutter: 'stable' }}>
            {/* Fade at top to soften edge */}
            <div className="pointer-events-none sticky top-0 z-10 h-6 shrink-0" style={{ background: 'linear-gradient(to bottom, var(--c-bg-page), transparent)' }} />
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
