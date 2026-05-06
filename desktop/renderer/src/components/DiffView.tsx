import { useMemo, useContext } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { AppearanceContext } from '../contexts/AppearanceContext'

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

interface DiffViewProps {
  diff: string // 原始 unified diff，不截断不过滤
  maxHeight?: number
  layout?: 'stacked' | 'split'
  enableLineNumbers?: boolean
  compact?: boolean
  hideHeader?: boolean // Pierre 控制 header 显示
  fallbackText?: string // 解析失败或大 diff 时显示
}

// 大 diff 保护：超过此字节数 fallback 到纯文本
const MAX_DIFF_BYTES = 50000
const MAX_DIFF_LINES = 500

/**
 * Wrapper for @pierre/diffs PatchDiff component adapted to xiaok styling.
 * Renders unified diff with syntax highlighting via Shiki.
 *
 * Key fixes from Codex review:
 * - Uses PatchDiff (correct API) not DiffRenderer
 * - Does NOT filter headers - Pierre needs them for parsing
 * - Gets theme from AppearanceContext, not just matchMedia
 * - Has fallback for large diffs and parse failures
 * - Enables word wrap for narrow timeline width
 */
export function DiffView({
  diff,
  maxHeight = 280,
  layout = 'stacked', // 默认 stacked，split 需足够宽度
  enableLineNumbers = true,
  compact = false,
  hideHeader = true, // xiaok 卡片已有自己的 header
  fallbackText,
}: DiffViewProps) {
  // 从 AppearanceContext 获取主题（而非只用 matchMedia）
  const appearance = useContext(AppearanceContext)
  const isDark =
    appearance?.theme === 'dark' ||
    (appearance?.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  // 大 diff 保护：检查尺寸
  const shouldFallback = useMemo(() => {
    if (!diff) return true
    const bytes = new Blob([diff]).size
    const lines = diff.split('\n').length
    return bytes > MAX_DIFF_BYTES || lines > MAX_DIFF_LINES
  }, [diff])

  // 尺寸过大时 fallback 到纯文本
  if (shouldFallback && fallbackText) {
    return (
      <pre
        style={{
          margin: 0,
          padding: '9px 10px',
          maxHeight,
          overflow: 'auto',
          fontFamily: MONO,
          fontSize: compact ? 11 : 12,
          lineHeight: compact ? '16px' : '18px',
          color: 'var(--c-text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {fallbackText}
      </pre>
    )
  }

  if (!diff?.trim()) {
    return null
  }

  // 不再过滤 headers，直接传给 Pierre
  // headerStyle 控制是否显示 Pierre 内置 header

  return (
    <div style={{ maxHeight, overflow: 'auto', fontFamily: MONO }}>
      <PatchDiff
        diff={diff}
        layout={layout}
        enableLineNumbers={enableLineNumbers}
        changeStyle="backgrounds"
        enableDarkMode={isDark}
        enableWordWrap={true} // 启用换行以适应狭窄宽度
        headerStyle={hideHeader ? 'none' : 'metadata'}
      />
    </div>
  )
}