import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface DirectionAwareTab<TKey extends string = string> {
  id: TKey;
  label: string;
}

interface DirectionAwareTabsProps<TKey extends string = string> {
  tabs: ReadonlyArray<DirectionAwareTab<TKey>>;
  activeId: TKey;
  onChange: (id: TKey) => void;
  className?: string;
  layoutId?: string;
  ariaLabel?: string;
}

export function DirectionAwareTabs<TKey extends string = string>({
  tabs,
  activeId,
  onChange,
  className,
  layoutId = 'direction-aware-tabs-pill',
  ariaLabel,
}: DirectionAwareTabsProps<TKey>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) onChange(tab.id);
            }}
            className={cn(
              'relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] focus-visible:ring-offset-1',
              selected
                ? 'text-[var(--c-accent)]'
                : 'text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]',
            )}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-0 rounded-md bg-[var(--c-accent)]/10"
                transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
