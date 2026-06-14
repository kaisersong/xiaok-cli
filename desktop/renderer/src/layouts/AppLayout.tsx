import React, { useState, createContext, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sidebar, PanelLeftClose } from 'lucide-react';
import { SidebarComponent } from '../components/Sidebar';
import { DesktopSettings } from '../components/DesktopSettings';

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, setCollapsed: () => {} });
const TITLEBAR_BUTTON_SIZE = 28;
const TITLEBAR_BUTTON_TOP = 12;

type TitlebarControl = {
  key: string;
  label: string;
  left: number;
  icon: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

function TitlebarControlButton({ control }: { control: TitlebarControl }) {
  return (
    <button
      type="button"
      aria-label={control.label}
      title={control.label}
      data-app-region="no-drag"
      onClick={control.onClick}
      style={{
        WebkitAppRegion: 'no-drag',
        position: 'absolute',
        top: TITLEBAR_BUTTON_TOP,
        left: control.left,
        width: TITLEBAR_BUTTON_SIZE,
        height: TITLEBAR_BUTTON_SIZE,
        zIndex: 50,
      } as React.CSSProperties}
      className="grid place-items-center rounded text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
    >
      {control.icon}
    </button>
  );
}

export function useSidebarCollapse() {
  return useContext(SidebarContext);
}

export function AppLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigateHistory = (delta: -1 | 1, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (delta < 0 && window.history.length <= 1) return;
    if (delta < 0) {
      window.history.back();
    } else {
      window.history.forward();
    }
  };
  const titlebarControls: TitlebarControl[] = sidebarCollapsed
    ? [
        {
          key: 'back',
          label: '后退',
          left: 78,
          icon: <ChevronLeft size={16} />,
          onClick: (event) => navigateHistory(-1, event),
        },
        {
          key: 'forward',
          label: '前进',
          left: 110,
          icon: <ChevronRight size={16} />,
          onClick: (event) => navigateHistory(1, event),
        },
        {
          key: 'expand',
          label: '展开侧边栏',
          left: 142,
          icon: <Sidebar size={16} />,
          onClick: (event) => {
            event.stopPropagation();
            setSidebarCollapsed(false);
          },
        },
      ]
    : [
        {
          key: 'back',
          label: '后退',
          left: 148,
          icon: <ChevronLeft size={16} />,
          onClick: (event) => navigateHistory(-1, event),
        },
        {
          key: 'forward',
          label: '前进',
          left: 180,
          icon: <ChevronRight size={16} />,
          onClick: (event) => navigateHistory(1, event),
        },
        {
          key: 'collapse',
          label: '收起侧边栏',
          left: 212,
          icon: <PanelLeftClose size={16} />,
          onClick: (event) => {
            event.stopPropagation();
            setSidebarCollapsed(true);
          },
        },
      ];

  if (settingsOpen) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
        <div
          style={{
            height: 52,
            WebkitAppRegion: 'drag',
            flexShrink: 0,
            background: 'var(--c-bg-page)',
            borderBottom: '1px solid var(--c-border-subtle)',
          } as React.CSSProperties}
        />
        <DesktopSettings onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <SidebarContext.Provider value={{ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }}>
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
        {/* Draggable title bar */}
        <div
          data-testid="desktop-titlebar"
          style={{
            height: 52,
            WebkitAppRegion: 'drag',
            flexShrink: 0,
            position: 'relative',
            background: 'var(--c-bg-page)',
            borderBottom: '1px solid var(--c-border-subtle)',
          } as React.CSSProperties}
        >
          {!sidebarCollapsed && (
            <div
              data-testid="sidebar-titlebar-fill"
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-60 border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)]"
            />
          )}
          {titlebarControls.map((control) => (
            <TitlebarControlButton key={control.key} control={control} />
          ))}
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
