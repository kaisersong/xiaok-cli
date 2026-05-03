import { Outlet } from 'react-router-dom';
import { DesktopTitleBar } from '../components/DesktopTitleBar';
import { Sidebar } from '../components/Sidebar';

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--c-bg-page)]">
      <DesktopTitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
