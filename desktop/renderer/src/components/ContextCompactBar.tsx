import { motion } from 'framer-motion'
import { AlertCircle, Check, Loader2 } from 'lucide-react'

export function ContextCompactBar({
  variant,
  runningLabel,
  doneLabel,
  trimLabel,
  llmFailedLabel,
}: {
  variant: { type: 'persist'; status: 'running' | 'done' | 'llm_failed' } | { type: 'trim'; status: 'done'; dropped: number }
  runningLabel: string
  doneLabel: string
  trimLabel: string
  llmFailedLabel: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      style={{ overflow: 'hidden' }}
    >
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-[var(--c-border-subtle)]" />
        <span className="flex items-center gap-1.5 text-xs text-[var(--c-text-muted)]">
          {variant.type === 'persist' && variant.status === 'running' ? (
            <Loader2 size={12} strokeWidth={1.5} className="shrink-0 animate-spin opacity-80" />
          ) : variant.type === 'persist' && variant.status === 'llm_failed' ? (
            <AlertCircle size={12} strokeWidth={1.5} className="shrink-0 opacity-80 text-[var(--c-status-warning)]" />
          ) : (
            <Check size={12} strokeWidth={1.5} className="shrink-0 opacity-80" />
          )}
          {variant.type === 'persist'
            ? variant.status === 'running'
              ? runningLabel
              : variant.status === 'llm_failed'
                ? llmFailedLabel
                : doneLabel
            : trimLabel.replace('{n}', String(variant.dropped))}
        </span>
        <div className="h-px flex-1 bg-[var(--c-border-subtle)]" />
      </div>
    </motion.div>
  )
}
