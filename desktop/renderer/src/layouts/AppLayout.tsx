import React, { useState, createContext, useContext } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sidebar, PanelLeftClose } from 'lucide-react';
import { SidebarComponent } from '../components/Sidebar';
import { DesktopSettings } from '../components/DesktopSettings';
import { useLocale } from '../contexts/LocaleContext';

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, setCollapsed: () => {} });
const TITLEBAR_BUTTON_SIZE = 28;
const TITLEBAR_BUTTON_TOP = 4;

type TitlebarControl = {
  key: string;
  label: string;
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
        width: TITLEBAR_BUTTON_SIZE,
        height: TITLEBAR_BUTTON_SIZE,
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
  const { t } = useLocale();
  const location = useLocation();
  const hideTopFade = /^\/projects\/[^/]+/.test(location.pathname);
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
          label: t.appLayoutBack,
          icon: <ChevronLeft size={16} />,
          onClick: (event) => navigateHistory(-1, event),
        },
        {
          key: 'forward',
          label: t.appLayoutForward,
          icon: <ChevronRight size={16} />,
          onClick: (event) => navigateHistory(1, event),
        },
        {
          key: 'expand',
          label: t.appLayoutExpandSidebar,
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
          label: t.appLayoutBack,
          icon: <ChevronLeft size={16} />,
          onClick: (event) => navigateHistory(-1, event),
        },
        {
          key: 'forward',
          label: t.appLayoutForward,
          icon: <ChevronRight size={16} />,
          onClick: (event) => navigateHistory(1, event),
        },
        {
          key: 'collapse',
          label: t.appLayoutCollapseSidebar,
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
          <div
            data-app-region="no-drag"
            style={{ WebkitAppRegion: 'no-drag', position: 'absolute', top: TITLEBAR_BUTTON_TOP, right: sidebarCollapsed ? undefined : undefined, zIndex: 50 } as React.CSSProperties}
            className="left-0 flex gap-1 w-60 justify-end pr-3"
          >
            {titlebarControls.map((control) => (
              <TitlebarControlButton key={control.key} control={control} />
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {!sidebarCollapsed && (
            <SidebarComponent onOpenSettings={() => setSettingsOpen(true)} />
          )}
          <div className="relative flex min-w-0 flex-1 flex-col">
            {/* Frosted glass fade at top of content - overlay above main, fixed at top of viewport */}
            {!hideTopFade && (
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6"
                aria-hidden="true"
                style={{
                  background: 'linear-gradient(to bottom, color-mix(in srgb, var(--c-bg-page) 70%, transparent) 0%, color-mix(in srgb, var(--c-bg-page) 30%, transparent) 70%, transparent 100%)',
                  backdropFilter: 'blur(1.5px)',
                  WebkitBackdropFilter: 'blur(1.5px)',
                }}
              />
            )}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--c-bg-page)]" style={{ scrollbarGutter: 'stable' }}>
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
