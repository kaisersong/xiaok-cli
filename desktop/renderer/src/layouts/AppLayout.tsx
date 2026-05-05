import { useState, createContext, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
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
        <div className="flex min-h-0 flex-1">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(v => !v)} />
          <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--c-bg-page)]" style={{ scrollbarGutter: 'stable' }}>
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
