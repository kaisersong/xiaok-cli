import React, { useMemo, useContext } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import type { FileDiffOptions } from '@pierre/diffs/react'
import { AppearanceContext } from '../contexts/AppearanceContext'

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

function isValidPatch(text: string): boolean {
  if (!text.includes('diff --git')) return false
  if (!text.includes('@@')) return false
  return true
}

function countFileDiffs(text: string): number {
  const matches = text.match(/^diff --git /gm)
  return matches ? matches.length : 0
}

/** Extract the first file's diff from a multi-file patch */
function extractFirstFile(patch: string): string {
  const secondIdx = patch.indexOf('\ndiff --git ', 1)
  if (secondIdx === -1) return patch
  return patch.substring(0, secondIdx)
}

export function DiffView({
  diff,
  maxHeight = 280,
  layout = 'unified',
  enableLineNumbers = true,
  compact = false,
  hideHeader = true,
  fallbackText,
}: DiffViewProps) {
  const appearance = useContext(AppearanceContext)
  const isDark =
    appearance?.theme === 'dark' ||
    (appearance?.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  const analysis = useMemo(() => {
    if (!diff || !isValidPatch(diff)) return { valid: false, fileCount: 0 }
    const bytes = new Blob([diff]).size
    const lines = diff.split('\n').length
    if (bytes > MAX_DIFF_BYTES || lines > MAX_DIFF_LINES) return { valid: false, fileCount: 0 }
    return { valid: true, fileCount: countFileDiffs(diff) }
  }, [diff])

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

  const options: FileDiffOptions<undefined> = {
    diffStyle: layout,
    diffIndicators: 'classic',
    disableLineNumbers: !enableLineNumbers,
    disableFileHeader: hideHeader,
    disableBackground: false,
    overflow: 'wrap',
    themeType: isDark ? 'dark' : 'light',
  }

  const style: React.CSSProperties = { maxHeight, overflow: 'auto', fontFamily: MONO }

  // Multi-file: render first file with PatchDiff, note additional files
  if (analysis.fileCount > 1) {
    const firstFile = extractFirstFile(diff)
    return (
      <div>
        <PatchDiff patch={firstFile} options={options} style={style} />
        <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--c-text-muted)', borderTop: '0.5px solid var(--c-border-subtle)' }}>
          +{analysis.fileCount - 1} more file{analysis.fileCount > 2 ? 's' : ''}
        </div>
      </div>
    )
  }

  return <PatchDiff patch={diff} options={options} style={style} />
}