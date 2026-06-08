import { useRef, useEffect } from 'react'
import { ArtifactIframe, type ArtifactIframeHandle, type ArtifactAction } from './ArtifactIframe'
import type { ArtifactRef } from '../storage'
import { isA2UIMimeType } from '../../../../src/a2ui/index.js'
import { A2uiArtifactBlock } from './a2ui/A2uiArtifactBlock'

export type StreamingArtifactEntry = {
  toolCallIndex: number
  toolCallId?: string
  toolName?: string
  argumentsBuffer: string
  title?: string
  filename?: string
  display?: 'inline' | 'panel'
  kind?: string
  content?: string
  loadingMessages?: string[]
  complete: boolean
  artifactRef?: ArtifactRef
}

type Props = {
  entry: StreamingArtifactEntry
  accessToken?: string
  compact?: boolean
  onAction?: (action: ArtifactAction) => void
}

export function ArtifactStreamBlock({ entry, accessToken, compact = false, onAction }: Props) {
  const iframeRef = useRef<ArtifactIframeHandle>(null)
  const lastContentRef = useRef<string>('')

  useEffect(() => {
    if (!entry.content || entry.content === lastContentRef.current) return
    lastContentRef.current = entry.content
    if (entry.complete) {
      iframeRef.current?.finalizeContent(entry.content)
    } else {
      iframeRef.current?.setStreamingContent(entry.content)
    }
  }, [entry.content, entry.complete])

  // display=panel artifacts are not rendered inline during streaming;
  // they just show as a compact card
  if (entry.display === 'panel' && !entry.content) {
    return null
  }

  const isInline = entry.display !== 'panel'
  const title = entry.title || entry.filename || 'Artifact'
  const artifactMime = entry.artifactRef?.mime_type
  const isA2ui = entry.kind === 'a2ui' || isA2UIMimeType(artifactMime)

  if (entry.artifactRef && !isInline) {
    return null
  }

  if (isA2ui && (entry.artifactRef || entry.content)) {
    const artifactRef = entry.artifactRef ?? {
      artifactId: entry.toolCallId || `a2ui-${entry.toolCallIndex}`,
      type: 'artifact',
      title,
      filename: entry.filename,
      mime_type: 'application/vnd.xiaok.a2ui+json',
    }
    return (
      <div style={{ margin: compact ? '0 0 2px' : '8px 0', maxWidth: '720px' }}>
        <div style={{
          fontSize: compact ? '13px' : '12px',
          fontWeight: compact ? 400 : 500,
          color: 'var(--c-text-secondary)',
          marginBottom: compact ? '2px' : '6px',
          lineHeight: compact ? '20px' : undefined,
          padding: compact ? '4px 0 2px' : undefined,
        }}>
          {title}
        </div>
        <A2uiArtifactBlock artifactRef={artifactRef} accessToken={accessToken} content={entry.content} />
      </div>
    )
  }

  // already have static artifact? render static iframe
  if (entry.artifactRef && isInline) {
    return (
      <div style={{ margin: compact ? '0 0 2px' : '8px 0', maxWidth: '720px' }}>
        <div style={{
          fontSize: compact ? '13px' : '12px',
          fontWeight: compact ? 400 : 500,
          color: 'var(--c-text-secondary)',
          marginBottom: compact ? '2px' : '6px',
          lineHeight: compact ? '20px' : undefined,
          padding: compact ? '4px 0 2px' : undefined,
        }}>
          {title}
        </div>
        <ArtifactIframe
          mode="static"
          artifact={entry.artifactRef}
          accessToken={accessToken}
          onAction={onAction}
          frameTitle={title}
          compactSpacing={compact}
          style={{ minHeight: compact ? '280px' : '300px' }}
        />
      </div>
    )
  }

  // streaming mode
  return (
    <div style={{ margin: compact ? '0 0 2px' : '8px 0', maxWidth: '720px' }}>
      <div style={{
        fontSize: compact ? '13px' : '12px',
        fontWeight: compact ? 400 : 500,
        color: 'var(--c-text-secondary)',
        marginBottom: compact ? '2px' : '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        lineHeight: compact ? '20px' : undefined,
        padding: compact ? '4px 0 2px' : undefined,
      }}>
        {title}
        {!entry.complete && (
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--c-text-tertiary)',
            animation: '_fadeIn 0.6s ease infinite alternate',
          }} />
        )}
      </div>
      <ArtifactIframe
        ref={iframeRef}
        mode="streaming"
        onAction={onAction}
        frameTitle={title}
        compactSpacing={compact}
        style={{ minHeight: compact ? '184px' : '200px' }}
      />
    </div>
  )
}
