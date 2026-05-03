import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { DesktopTitleBar } from '../components/DesktopTitleBar';
import { Sidebar } from '../components/Sidebar';
import { DesktopSettings } from '../components/DesktopSettings';

export function AppLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (settingsOpen) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
        <DesktopTitleBar onOpenSettings={() => setSettingsOpen(false)} />
        <DesktopSettings onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
      <DesktopTitleBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
