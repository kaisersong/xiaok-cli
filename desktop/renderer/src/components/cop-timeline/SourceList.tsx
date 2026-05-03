import { useState, useEffect, useMemo, memo } from 'react'
import { Globe } from 'lucide-react'
import type { WebSource } from '../../storage'
import { useLocale } from '../../contexts/LocaleContext'
import { handleExternalAnchorClick } from '../../openExternal'
import { getDomain, getDomainShort, isHttpUrl, REVIEWING_SOURCE_PREVIEW_COUNT, FAVICON_REVEAL_DELAY_MS } from './utils'

export const SourceFavicon = memo(function SourceFavicon({
  domain,
  isFailed = false,
}: {
  domain: string
  isFailed?: boolean
}) {
  const [shouldLoad, setShouldLoad] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setLoadFailed(false)
    setShouldLoad(false)
    if (!domain) return
    const timerId = window.setTimeout(() => setShouldLoad(true), FAVICON_REVEAL_DELAY_MS)
    return () => window.clearTimeout(timerId)
  }, [domain])

  if (!domain || isFailed || loadFailed || !shouldLoad) {
    return (
      <Globe
        size={11}
        style={{
          color: isFailed ? 'var(--c-status-error-text, #ef4444)' : 'var(--c-text-muted)',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=16&domain=${domain}`}
      alt=""
      width={14}
      height={14}
      style={{ flexShrink: 0, borderRadius: '2px' }}
      onError={() => setLoadFailed(true)}
    />
  )
})

export const SourceItem = memo(function SourceItem({ source }: { source: WebSource }) {
  if (!isHttpUrl(source.url)) return null
  const domain = getDomain(source.url)
  const shortDomain = getDomainShort(source.url)
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => handleExternalAnchorClick(event, source.url)}
      className="hover:bg-[var(--c-bg-deep)]"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        borderRadius: '8px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background 0.1s',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '16px',
          height: '16px',
          flexShrink: 0,
        }}
      >
        <SourceFavicon domain={domain} />
      </div>
      <span
        style={{
          fontSize: '12px',
          color: 'var(--c-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {source.title || domain}
      </span>
      <span style={{ fontSize: '11px', color: 'var(--c-text-muted)', flexShrink: 0 }}>
        {shortDomain}
      </span>
    </a>
  )
})

export const SourceListCard = memo(function SourceListCard({ sources }: { sources: WebSource[] }) {
  const { t } = useLocale()
  const httpSources = useMemo(
    () => sources.filter((source) => isHttpUrl(source.url)),
    [sources],
  )
  const canCollapse = httpSources.length > REVIEWING_SOURCE_PREVIEW_COUNT
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [httpSources.length])

  const visibleSources = expanded || !canCollapse
    ? httpSources
    : httpSources.slice(0, REVIEWING_SOURCE_PREVIEW_COUNT)
  const hiddenCount = Math.max(0, httpSources.length - visibleSources.length)

  if (httpSources.length === 0) {
    return null
  }

  return (
    <div
      style={{
        marginTop: '8px',
        borderRadius: '10px',
        border: '0.5px solid var(--c-border-subtle)',
        background: 'var(--c-bg-menu)',
        maxHeight: '240px',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '4px',
      }}
    >
      {visibleSources.map((source, index) => (
        <div key={`${source.url}-${index}`}>
          <SourceItem source={source} />
        </div>
      ))}
      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            marginTop: '4px',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '0.5px solid var(--c-border-subtle)',
            background: 'var(--c-bg-page)',
            color: 'var(--c-text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          className="hover:bg-[var(--c-bg-deep)]"
        >
          {expanded ? t.copTimelineShowFewerSources : t.copTimelineShowMoreSources(hiddenCount)}
        </button>
      )}
    </div>
  )
})
