import React, { useMemo, useState, useCallback } from 'react'
import { PatchDiff } from '@pierre/diffs/react'

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

const MAX_DIFF_BYTES = 50000
const MAX_DIFF_LINES = 500
const INITIAL_RENDER_BYTES = 30000

interface DiffViewProps {
  diff: string
  maxHeight?: number
  layout?: 'unified' | 'split'
  enableLineNumbers?: boolean
  compact?: boolean
  hideHeader?: boolean
  fallbackText?: string
}

/** Extract the unified diff portion from a mixed string */
function extractDiffPatch(text: string): string {
  const startIdx = text.indexOf('diff --git')
  if (startIdx === -1) return text
  const fromDiff = text.substring(startIdx)
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

function splitFiles(patch: string): string[] {
  const parts: string[] = []
  let idx = 0
  while (idx < patch.length) {
    const nextIdx = idx === 0
      ? patch.indexOf('\ndiff --git ', idx)
      : patch.indexOf('\ndiff --git ', idx + 1)
    if (nextIdx === -1) {
      parts.push(patch.substring(idx))
      break
    }
    parts.push(patch.substring(idx, nextIdx + 1))
    idx = nextIdx + 1
  }
  return parts.filter(p => p.trim())
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

  const [showAll, setShowAll] = useState(false)

  const analysis = useMemo(() => {
    if (!diff) return { valid: false, fileCount: 0, patch: '', oversized: false }
    const patch = extractDiffPatch(diff)
    if (!isValidPatch(patch)) return { valid: false, fileCount: 0, patch, oversized: false }
    const bytes = new Blob([patch]).size
    const lines = patch.split('\n').length
    const oversized = bytes > MAX_DIFF_BYTES || lines > MAX_DIFF_LINES

    // When oversized, take initial portion for rendering
    const renderPatch = oversized && !showAll
      ? patch.substring(0, INITIAL_RENDER_BYTES)
      : patch

    return {
      valid: true,
      fileCount: countFileDiffs(patch),
      patch: renderPatch,
      fullPatch: patch,
      oversized,
      hasMore: oversized && !showAll,
    }
  }, [diff, showAll])

  if (!analysis.valid) {
    if (fallbackText) {
      return (
        <pre style={{
          margin: 0, padding: '9px 10px', maxHeight, overflow: 'auto',
          fontFamily: MONO, fontSize: compact ? 11 : 12,
          lineHeight: compact ? '16px' : '18px',
          color: 'var(--c-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
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

  const handleLoadMore = useCallback(() => setShowAll(true), [])

  // Render all files (multi-file support)
  const files = splitFiles(analysis.patch)
  if (files.length > 1) {
    return (
      <div>
        {files.map((file, i) => (
          <PatchDiff key={i} patch={file} options={options} style={style} />
        ))}
        {analysis.hasMore && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <button
              onClick={handleLoadMore}
              style={{
                padding: '4px 16px', cursor: 'pointer',
                border: '1px solid var(--c-border-subtle)',
                background: 'var(--c-bg)', color: 'var(--c-text-primary)',
                borderRadius: '4px', fontSize: '12px',
              }}
            >
              Load remaining {Math.max(0, analysis.fileCount - files.length)} more file(s)…
            </button>
          </div>
        )}
      </div>
    )
  }

  // Single file
  return (
    <div>
      <PatchDiff patch={analysis.patch} options={options} style={style} />
      {analysis.hasMore && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <button
            onClick={handleLoadMore}
            style={{
              padding: '4px 16px', cursor: 'pointer',
              border: '1px solid var(--c-border-subtle)',
              background: 'var(--c-bg)', color: 'var(--c-text-primary)',
              borderRadius: '4px', fontSize: '12px',
            }}
          >
            Load more…
          </button>
        </div>
      )}
    </div>
  )
}
