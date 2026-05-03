import { motion } from 'framer-motion'
import { Glasses } from 'lucide-react'

export function IncognitoDivider({ text, onComplete }: { text: string; onComplete?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      style={{ overflow: 'hidden' }}
      onAnimationComplete={onComplete}
    >
      <div className="flex items-center gap-3 py-1 mt-6">
        <div className="h-px flex-1" style={{ background: 'var(--c-border-subtle)' }} />
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--c-text-muted)' }}>
          <Glasses size={12} strokeWidth={1.5} style={{ opacity: 0.7 }} />
          {text}
        </span>
        <div className="h-px flex-1" style={{ background: 'var(--c-border-subtle)' }} />
      </div>
    </motion.div>
  )
}
