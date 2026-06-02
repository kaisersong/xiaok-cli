import { useRef, useEffect, useState, useCallback } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import mermaid from 'mermaid'

const DEBOUNCE_MS = 200
const MIN_HEIGHT = 200
const COLLAPSED_MAX_HEIGHT = 400

let mermaidInitialized = false
function ensureMermaidInit() {
  if (mermaidInitialized) return
  mermaid.initialize(createMermaidConfig())
  mermaidInitialized = true
}

export function createMermaidConfig() {
  return {
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#f7f5ef',
      primaryTextColor: '#1f2933',
      primaryBorderColor: '#d9d4c9',
      lineColor: '#7b756a',
      secondaryColor: '#f3f0e8',
      tertiaryColor: '#fbfaf7',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    flowchart: { htmlLabels: false, curve: 'basis' },
    securityLevel: 'strict',
  } as const
}

let renderCounter = 0

type Props = {
  content: string
}

export function MermaidBlock({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renderState, setRenderState] = useState<'idle' | 'loading' | 'rendered' | 'source_fallback'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastContentRef = useRef('')

  const renderMermaid = useCallback(async (code: string) => {
    const source = code.trim()
    if (!containerRef.current) return
    if (!source) {
      containerRef.current.innerHTML = ''
      setError(null)
      setRenderState('source_fallback')
      return
    }
    setRenderState('loading')

    const id = `mermaid-${++renderCounter}`
    try {
      ensureMermaidInit()
      const { svg } = await mermaid.render(id, source)
      if (containerRef.current) {
        if (!shouldFallbackToMermaidSource(svg, source)) {
          containerRef.current.innerHTML = svg
          setError(null)
          setRenderState('rendered')
        } else {
          containerRef.current.innerHTML = ''
          setError(null)
          setRenderState('source_fallback')
        }
      }
    } catch (e) {
      // mermaid may inject error SVG into document body before throwing — clean it up
      const orphan = document.getElementById(id)
      if (orphan) orphan.remove()
      // Also remove the temp container mermaid uses (d + id pattern)
      const tempContainer = document.querySelector(`#d${id}`)
      if (tempContainer) tempContainer.remove()
      if (containerRef.current) containerRef.current.innerHTML = ''
      setError(e instanceof Error ? e.message : String(e))
      setRenderState('source_fallback')
    }
  }, [])

  useEffect(() => {
    if (content === lastContentRef.current) return
    lastContentRef.current = content
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void renderMermaid(content), DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content, renderMermaid])

  return (
    <div
      style={{
        position: 'relative',
        margin: '1em 0',
        border: '0.5px solid var(--c-border-subtle)',
        borderRadius: '10px',
        background: 'var(--c-bg-page)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          height: '28px',
          borderBottom: '0.5px solid var(--c-border-subtle)',
          background: 'var(--c-md-code-label-bg, var(--c-bg-sub))',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            letterSpacing: '0.18px',
            color: 'var(--c-text-secondary)',
            userSelect: 'none',
          }}
        >
          mermaid
        </span>
        <button type="button"
          onClick={() => setExpanded(prev => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            borderRadius: '5px',
            border: 'none',
            background: 'transparent',
            color: 'var(--c-text-icon)',
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          className="opacity-60 hover:opacity-100"
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>
      {error ? (
        <div
          style={{
            padding: '16px',
            color: 'var(--c-status-error)',
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
            maxHeight: expanded ? undefined : `${COLLAPSED_MAX_HEIGHT}px`,
          }}
        >
          {error}
          {content.trim() ? `\n\n${content.trim()}` : ''}
        </div>
      ) : renderState === 'source_fallback' ? (
        <pre
          style={{
            margin: 0,
            padding: '16px',
            color: content.trim() ? 'var(--c-text-secondary)' : 'var(--c-text-tertiary)',
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
            maxHeight: expanded ? undefined : `${COLLAPSED_MAX_HEIGHT}px`,
          }}
        >
          {content.trim() || 'Mermaid 图表内容为空'}
        </pre>
      ) : (
        <div style={{ position: 'relative' }}>
          {renderState === 'loading' ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--c-text-tertiary)',
                fontSize: '12px',
                pointerEvents: 'none',
              }}
            >
              正在渲染图表...
            </div>
          ) : null}
          <div
            ref={containerRef}
            style={{
              width: '100%',
              minHeight: `${MIN_HEIGHT}px`,
              maxHeight: expanded ? undefined : `${COLLAPSED_MAX_HEIGHT}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
              transition: 'max-height 0.2s ease',
            }}
          />
        </div>
      )}
    </div>
  )
}

export function shouldFallbackToMermaidSource(svg: string, source: string): boolean {
  if (!source.trim()) return true
  if (!svg || !svg.includes('<svg')) return true
  if (!/<(text|path|rect|line|circle|ellipse|polygon|polyline|g)\b/i.test(svg)) return true

  // Mermaid can occasionally return a structural SVG with paths/groups but no
  // readable labels. In the chat surface that appears as a blank diagram, so
  // show the source instead of leaving an empty framed block.
  const readableText = svg
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
  return readableText.length === 0
}
