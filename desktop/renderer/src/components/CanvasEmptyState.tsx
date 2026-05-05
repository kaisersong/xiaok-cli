import { FileQuestion } from 'lucide-react';

interface CanvasEmptyStateProps {
  message: string;
}

export function CanvasEmptyState({ message }: CanvasEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-[var(--c-bg-card)] border border-[var(--c-border-subtle)]">
        <FileQuestion size={24} className="text-[var(--c-text-tertiary)]" />
      </div>
      <p className="text-center text-xs text-[var(--c-text-tertiary)]">{message}</p>
    </div>
  );
}
