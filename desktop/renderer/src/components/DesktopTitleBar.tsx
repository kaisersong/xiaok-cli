import { Menu, Settings } from 'lucide-react';

interface DesktopTitleBarProps {
  onOpenSettings?: () => void;
}

export function DesktopTitleBar({ onOpenSettings }: DesktopTitleBarProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-4">
      <div className="flex items-center gap-2">
        <button type="button" className="p-1 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]">
          <Menu className="size-5" />
        </button>
        <span className="font-medium">Work</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--c-text-secondary)]">xiaok desktop</span>
        <button type="button" onClick={onOpenSettings} className="p-1 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]">
          <Settings className="size-5" />
        </button>
      </div>
    </header>
  );
}