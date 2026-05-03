import { useState } from 'react'
import { formatShortDate, formatFullDate } from './utils'

export function MessageDate({ createdAt, isWorkMode }: { createdAt: string; isWorkMode?: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        fontSize: '11px',
        lineHeight: 1,
        color: 'var(--c-text-muted)',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        cursor: 'default',
      }}
    >
      {formatShortDate(createdAt)}
      {hovered && (
        <span
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: isWorkMode ? undefined : 0,
            left: isWorkMode ? 0 : undefined,
            fontSize: '11px',
            lineHeight: 1,
            color: 'var(--c-text-primary)',
            background: 'var(--c-bg-deep)',
            borderRadius: '6px',
            padding: '4px 8px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {formatFullDate(createdAt)}
        </span>
      )}
    </span>
  )
}
