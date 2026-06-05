/**
 * ArtifactPreviewModal — inline preview with Markdown rendering, HTML iframe, JSON formatting.
 */

import { useState, useEffect } from 'react';
import { X, Download } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmArtifact } from '../../hooks/useKSwarmClient';
import { artifactDisplayName, downloadArtifact, resolveArtifactUrl } from './artifactActions';

interface ArtifactPreviewModalProps {
  artifact: KSwarmArtifact;
  onClose(): void;
}

export function ArtifactPreviewModal({ artifact, onClose }: ArtifactPreviewModalProps) {
  const { t } = useLocale();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const displayName = artifactDisplayName(artifact);

  const isPreviewable = /\.(md|markdown|html|htm|txt|json|svg)$/i.test(displayName) ||
    /text|json|html|markdown|svg/.test(artifact.mimeType || '');

  useEffect(() => {
    setContent(null);
    setError(null);
    setLoading(true);

    if (!isPreviewable) {
      setLoading(false);
      return;
    }

    const loadContent = async () => {
      try {
        const url = resolveArtifactUrl(artifact);
        if (!url) {
          setError(t.projectsArtifactNoPath);
          setLoading(false);
          return;
        }
        const api = (window as any).xiaokDesktop;
        let text: string;
        const kswarmBase = 'http://127.0.0.1:4400';
        if (url.startsWith(kswarmBase) && api?.kswarmProxyGet) {
          const path = url.slice(kswarmBase.length);
          const data = await api.kswarmProxyGet(path);
          if (data === null || data === undefined) throw new Error('fetch failed');
          text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${res.status}`);
          text = await res.text();
        }
        setContent(text);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadContent();
  }, [artifact, isPreviewable]);

  const handleDownload = () => {
    downloadArtifact(artifact);
  };

  const isHtml = /\.(html|htm|svg)$/i.test(displayName) || artifact.mimeType?.includes('html') || artifact.mimeType?.includes('svg');
  const isJson = /\.json$/i.test(displayName) || artifact.mimeType?.includes('json');
  const isMarkdown = /\.(md|markdown)$/i.test(displayName) || artifact.mimeType?.includes('markdown');

  const renderMarkdown = (md: string) => {
    const html = md
      .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:600;margin:12px 0 6px;color:var(--c-text-primary)">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;margin:10px 0 4px;color:var(--c-text-primary)">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--c-text-primary)">$1</strong>')
      .replace(/^- (.+)$/gm, '<li style="margin-left:16px;color:var(--c-text-secondary);font-size:12px">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-left:16px;color:var(--c-text-secondary);font-size:12px">$1. $2</li>')
      .replace(/`([^`]+)`/g, '<code style="background:var(--c-bg-deep);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="size-5 animate-spin rounded-full border-2 border-[var(--c-text-muted)] border-t-transparent" />
        </div>
      );
    }
    if (error) {
      return <p className="py-8 text-center text-sm text-[var(--c-status-error-text)]">{t.projectsArtifactLoadFailed}: {error}</p>;
    }
    if (!isPreviewable) {
      return <p className="py-8 text-center text-sm text-[var(--c-text-tertiary)]">{t.projectsArtifactUnsupported}</p>;
    }
    if (!content) {
      return <p className="py-8 text-center text-sm text-[var(--c-text-tertiary)]">{t.projectsArtifactEmpty}</p>;
    }

    if (isHtml) {
      const previewContent = prepareHtmlArtifactPreview(content);
      return (
        <iframe srcDoc={previewContent} className="h-[60vh] w-full rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-white" sandbox="allow-same-origin" title={displayName} />
      );
    }

    if (isMarkdown) {
      return (
        <div className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--c-md-code-block-bg)] p-4 text-[13px] text-[var(--c-text-primary)]">
          {renderMarkdown(content)}
        </div>
      );
    }

    if (isJson) {
      try {
        const formatted = JSON.stringify(JSON.parse(content), null, 2);
        return <pre className="max-h-[60vh] overflow-auto rounded-lg bg-[var(--c-md-code-block-bg)] p-4 text-[12px] font-mono text-[var(--c-text-primary)]">{formatted}</pre>;
      } catch { /* fallthrough */ }
    }

    return <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--c-md-code-block-bg)] p-4 text-[13px] text-[var(--c-text-primary)]">{content}</pre>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/12 backdrop-blur-[2px]"
        role="presentation"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--c-border-subtle)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--c-text-heading)] truncate">{displayName}</p>
            <p className="text-[10px] text-[var(--c-text-muted)]">{artifact.mimeType || t.projectsDeliverableUnknownType}</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Download artifact" onClick={handleDownload} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]" title="下载"><Download size={15} /></button>
            <button type="button" aria-label="Close artifact preview" onClick={onClose} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"><X size={15} /></button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">{renderContent()}</div>
      </div>
    </div>
  );
}

function prepareHtmlArtifactPreview(html: string): string {
  if (!needsNoScriptAnimationFallback(html)) return html;
  return injectPreviewFallbackStyle(addNoAnimationsBodyClass(html));
}

function needsNoScriptAnimationFallback(html: string): boolean {
  return /\bfade-in-up\b|\bstagger-ready\b|body\.no-animations|IntersectionObserver/.test(html);
}

function addNoAnimationsBodyClass(html: string): string {
  return html.replace(/<body\b([^>]*)>/i, (_match, attrs: string) => {
    if (/\bclass\s*=\s*(['"])(.*?)\1/i.test(attrs)) {
      const nextAttrs = attrs.replace(/\bclass\s*=\s*(['"])(.*?)\1/i, (_classMatch, quote: string, value: string) => {
        const classes = value.split(/\s+/).filter(Boolean);
        if (!classes.includes('no-animations')) classes.push('no-animations');
        return `class=${quote}${classes.join(' ')}${quote}`;
      });
      return `<body${nextAttrs}>`;
    }
    return `<body${attrs} class="no-animations">`;
  });
}

function injectPreviewFallbackStyle(html: string): string {
  if (html.includes('data-xiaok-preview-fallback')) return html;
  const style = `<style data-xiaok-preview-fallback>.fade-in-up{opacity:1!important;transform:none!important;transition:none!important}.kpi-grid .kpi-card,.timeline .timeline-item{opacity:1!important;transform:none!important;transition:none!important}</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`);
  }
  return `${style}${html}`;
}
