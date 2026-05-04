import { useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { ErrorCallout as SharedErrorCallout, formatErrorForDisplay, type AppError } from '../shared'
import { useLocale } from '../contexts/LocaleContext'

const RUN_ERROR_TITLE_BG = '#ea4d3c'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

function flattenDetailLine(line: string): string {
  return line.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export function ErrorCallout({ error }: { error: AppError }) {
  const { locale, t } = useLocale()
  return <SharedErrorCallout error={error} locale={locale} requestFailedText={t.requestFailed} />
}

export function RunErrorNotice({ error, onDismiss }: { error: AppError; onDismiss: () => void }) {
  const { locale, t } = useLocale()
  const [expanded, setExpanded] = useState(true)
  const formatted = formatErrorForDisplay(error, locale, t.requestFailed)
  const detailLines = (formatted.detailLines.length > 0 ? formatted.detailLines : [formatted.title])
    .map(flattenDetailLine)
  const dismissLabel = locale === 'zh' ? '关闭' : 'Close'
  const toggleLabel = expanded
    ? (locale === 'zh' ? '收起' : 'Collapse')
    : (locale === 'zh' ? '展开' : 'Expand')

  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{
        background: 'var(--c-code-preview-bg)',
        border: '0.5px solid var(--c-border-subtle)',
      }}
    >
      <div
        style={{
          background: RUN_ERROR_TITLE_BG,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          padding: '8px 10px',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: '18px',
          }}
        >
          {formatted.title}
        </div>
        <button
          type="button"
          aria-label={toggleLabel}
          onClick={() => setExpanded((value) => !value)}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-opacity hover:opacity-80"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-opacity hover:opacity-80"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>
      {expanded && (
        <div
          style={{
            padding: '8px 10px',
            overflowX: 'auto',
            overflowY: 'hidden',
            fontFamily: MONO,
            fontSize: 12,
            lineHeight: '18px',
            color: 'var(--c-text-primary)',
            background: 'var(--c-code-preview-bg)',
          }}
        >
          {detailLines.map((line, index) => (
            <div
              key={`${index}:${line}`}
              style={{
                whiteSpace: 'nowrap',
                wordBreak: 'normal',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type { AppError }
