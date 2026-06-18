import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface ExpandableCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  expanded?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (next: boolean) => void;
  header: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export const ExpandableCard = forwardRef<HTMLDivElement, ExpandableCardProps>(
  function ExpandableCard(
    { expanded, defaultExpanded = false, onToggle, header, children, className, disabled, ...rest },
    ref,
  ) {
    const [internal, setInternal] = useState(defaultExpanded);
    const isExpanded = expanded !== undefined ? expanded : internal;

    const toggle = () => {
      if (disabled) return;
      const next = !isExpanded;
      if (expanded === undefined) setInternal(next);
      onToggle?.(next);
    };

    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    };

    return (
      <div
        ref={ref}
        className={cn(
          'overflow-hidden rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)]',
          className,
        )}
        {...rest}
      >
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={isExpanded}
          aria-disabled={disabled || undefined}
          onClick={toggle}
          onKeyDown={onKey}
          className={cn(
            'flex w-full items-center justify-between px-3 py-2 text-left',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[var(--c-bg-deep)]',
          )}
        >
          {header}
        </div>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div className="border-t border-[var(--c-border-subtle)] px-3 py-2">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);
