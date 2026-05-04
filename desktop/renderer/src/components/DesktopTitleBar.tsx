export function DesktopTitleBar() {
  return (
    <header className="flex h-12 items-center justify-between border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--c-text-secondary)]">xiaok desktop</span>
      </div>
      <div className="flex items-center gap-2" />
    </header>
  );
}