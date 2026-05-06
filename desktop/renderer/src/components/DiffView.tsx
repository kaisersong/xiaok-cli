import React, { useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
// @ts-expect-error FileDiffOptions is exported from @pierre/diffs internal but not react
import type { FileDiffOptions } from '@pierre/diffs/react'

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
  const isDark = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches

  const analysis = useMemo(() => {
    if (!diff) return { valid: false, fileCount: 0, patch: '' }
    const patch = extractDiffPatch(diff)
    if (!isValidPatch(patch)) return { valid: false, fileCount: 0, patch }
    const bytes = new Blob([patch]).size
    const lines = patch.split('\n').length
    if (bytes > MAX_DIFF_BYTES || lines > MAX_DIFF_LINES) return { valid: false, fileCount: 0, patch }
    return { valid: true, fileCount: countFileDiffs(patch), patch }
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

  // Multi-file: render first file with PatchDiff, note additional files
  if (analysis.fileCount > 1) {
    const firstFile = extractFirstFile(analysis.patch)
    return (
      <div>
        <PatchDiff patch={firstFile} options={options} style={style} />
        <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--c-text-muted)', borderTop: '0.5px solid var(--c-border-subtle)' }}>
          +{analysis.fileCount - 1} more file{analysis.fileCount > 2 ? 's' : ''}
        </div>
      </div>
    )
  }

  return <PatchDiff patch={analysis.patch} options={options} style={style} />
}