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
        {/* Draggable title bar — frosted glass style */}
        <div
          style={{
            height: 52,
            WebkitAppRegion: 'drag',
            flexShrink: 0,
            position: 'relative',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            background: 'rgba(247,245,241,0.72)',
          } as React.CSSProperties}
        >
          {/* Collapse button (when sidebar visible) */}
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: 12, left: 212 } as React.CSSProperties}
              className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors z-50"
              title="收起侧边栏"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
          {/* Expand button (when sidebar hidden) */}
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: 12, left: 84 } as React.CSSProperties}
              className="flex h-[28px] w-[28px] items-center justify-center rounded-lg text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors z-50"
              title="展开侧边栏"
            >
              <Sidebar size={16} />
            </button>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          {!sidebarCollapsed && (
            <SidebarComponent onOpenSettings={() => setSettingsOpen(true)} />
          )}
          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--c-bg-page)]" style={{ scrollbarGutter: 'stable' }}>
            {/* Frosted glass fade at top of content */}
            <div className="pointer-events-none sticky top-0 z-10 h-8 shrink-0" style={{
              background: 'linear-gradient(to bottom, rgba(247,245,241,0.95) 0%, rgba(247,245,241,0.5) 60%, transparent 100%)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }} />
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
