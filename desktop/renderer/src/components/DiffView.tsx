import React, { useMemo, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { useLocale } from '../contexts/LocaleContext'

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

interface DiffViewProps {
  diff: string
  maxHeight?: number
  layout?: 'unified' | 'split'
  enableLineNumbers?: boolean
  compact?: boolean
  hideHeader?: boolean
  fallbackText?: string
}

const MAX_DIFF_BYTES = 50000
const MAX_DIFF_LINES = 500

/** Extract the unified diff portion from a mixed string (diff + trailing message) */
function extractDiffPatch(text: string): string {
  const startIdx = text.indexOf('diff --git')
  if (startIdx === -1) return text
  const fromDiff = text.substring(startIdx)
  // Find the last line that looks like diff content
  const lines = fromDiff.split('\n')
  let lastDiffLine = lines.length - 1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line === '') continue
    if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++') ||
        line.startsWith('@@') || line.startsWith('-') || line.startsWith('+') || line.startsWith(' ')) {
      lastDiffLine = i
      break
    }
    // Non-diff content — truncate here
    lastDiffLine = i - 1
    break
  }
  return lines.slice(0, lastDiffLine + 1).join('\n')
}

function isValidPatch(text: string): boolean {
  if (!text.includes('diff --git')) return false
  if (!text.includes('@@')) return false
  return true
}

export function DiffView(props: DiffViewProps) {
  return <DiffViewContent key={props.diff} {...props} />
}

function DiffViewContent({
  diff,
  maxHeight = 280,
  layout = 'unified',
  enableLineNumbers = true,
  compact = false,
  hideHeader = true,
  fallbackText,
}: DiffViewProps) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const isDark = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches

  const analysis = useMemo(() => {
    if (!diff) return { valid: false, oversized: false, patch: '' }
    const patch = extractDiffPatch(diff)
    if (!isValidPatch(patch)) return { valid: false, oversized: false, patch }
    const bytes = new Blob([patch]).size
    const lines = patch.split('\n').length
    return { valid: true, oversized: bytes > MAX_DIFF_BYTES || lines > MAX_DIFF_LINES, patch }
  }, [diff])

  if (analysis.valid && analysis.oversized && !expanded) {
    return <div>
      {fallbackText && <pre style={{ maxHeight, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{fallbackText}</pre>}
      <button type="button" onClick={() => setExpanded(true)} className="rounded border border-[var(--c-border-subtle)] px-3 py-1 text-xs text-[var(--c-text-secondary)]">
        {t.diffView.showFull}
      </button>
    </div>
  }

  if (!analysis.valid) {
    if (fallbackText) {
      return (
        <pre
          style={{
            margin: 0, padding: '9px 10px', maxHeight, overflow: 'auto',
            fontFamily: MONO, fontSize: compact ? 11 : 12,
            lineHeight: compact ? '16px' : '18px',
            color: 'var(--c-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {fallbackText}
        </pre>
      )
    }
    return null
  }

  const options: any = {
    diffStyle: layout,
    diffIndicators: 'classic',
    disableLineNumbers: !enableLineNumbers,
    disableFileHeader: hideHeader,
    disableBackground: false,
    overflow: 'wrap',
    themeType: isDark ? 'dark' : 'light',
  }

  const style: React.CSSProperties = { maxHeight, overflow: 'auto', fontFamily: MONO }

  // Split only at file boundaries; never truncate a hunk before passing it to Pierre.
  const patches = analysis.patch.split(/\n(?=diff --git )/)
  if (patches.length > 1) {
    return <div style={style}>{patches.map((patch, index) =>
      <PatchDiff key={index} patch={patch} options={options} style={style} />
    )}</div>
  }
  return <PatchDiff patch={analysis.patch} options={options} style={style} />
}
