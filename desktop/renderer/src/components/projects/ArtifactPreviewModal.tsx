/**
 * ArtifactPreviewModal — inline preview with Markdown rendering, HTML iframe, JSON formatting.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Download, BookOpen, Maximize2, Minimize2, MessageSquare, PencilLine } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
import type { KSwarmArtifact } from '../../hooks/useKSwarmClient';
import { artifactDisplayName, downloadArtifact, resolveArtifactProxyPath, resolveArtifactUrl } from './artifactActions';
import { getDesktopApi } from '../../shared/desktop';
import { api } from '../../api';
import { ArtifactEditableViewer } from '../ArtifactEditableViewer';

interface ArtifactPreviewModalProps {
  artifact: KSwarmArtifact;
  onClose(): void;
}

type HtmlEditSaveResult = { ok?: boolean; success?: boolean; error?: string };

interface ArtifactPreviewDesktopApi {
  kswarmProxyPut?: (path: string, body: unknown) => Promise<unknown>;
  saveFile?: (input: { filePath: string; content: string; purpose?: 'html-edit' }) => Promise<HtmlEditSaveResult>;
}

export function ArtifactPreviewModal({ artifact, onClose }: ArtifactPreviewModalProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kbSaving, setKbSaving] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [htmlEditMode, setHtmlEditMode] = useState(false);
  const [htmlEditRequest, setHtmlEditRequest] = useState({ id: 0, startInEditMode: false });
  const displayName = artifactDisplayName(artifact);

  const isPreviewable = /\.(md|markdown|html|htm|txt|json|svg)$/i.test(displayName) ||
    /text|json|html|markdown|svg/.test(artifact.mimeType || '');

  const loadContent = useCallback(async () => {
    setContent(null);
    setError(null);
    setLoading(true);

    if (!isPreviewable) {
      setLoading(false);
      return;
    }

    try {
      const url = resolveArtifactUrl(artifact);
      if (!url) {
        setError(t.projectsArtifactNoPath);
        setLoading(false);
        return;
      }
      const api = getDesktopApi();
      let text: string;
      if (url.includes(':4400') && api?.kswarmProxyGetText) {
        const path = new URL(url).pathname;
        const data = await api.kswarmProxyGetText(path);
        if (data === null || data === undefined) throw new Error('fetch failed');
        text = data;
      } else if (api?.readFileContent && (artifact.path || artifact.filename)) {
        const filePath = artifact.path || artifact.filename || '';
        const data = await api.readFileContent(filePath);
        text = typeof data === 'string' ? data : (data as any)?.text ?? '';
        if (!text) throw new Error('empty content');
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
  }, [artifact, isPreviewable, t.projectsArtifactNoPath]);

  useEffect(() => {
    setHtmlEditMode(false);
    setHtmlEditRequest((request) => ({ id: request.id + 1, startInEditMode: false }));
    void loadContent();
  }, [loadContent]);

  const handleDownload = () => {
    downloadArtifact(artifact);
  };

  const handleSaveToKb = async () => {
    const desktop = getDesktopApi();
    if (!desktop?.kbListCollections || !desktop?.kbAddSource || !content) return;
    setKbSaving(true);
    try {
      const cols = await desktop.kbListCollections() as Array<{ id: string; name: string }>;
      if (cols.length === 0) {
        setKbSaving(false);
        return;
      }
      const filePath = artifact.path || artifact.filename;
      if (filePath && /\.(pdf|docx|pptx|xlsx|html|htm)$/i.test(filePath)) {
        await desktop.kbAddSource({ collectionId: cols[0].id, kind: 'file', title: displayName, filePath, mimeType: artifact.mimeType || 'application/octet-stream' });
      } else {
        await desktop.kbAddSource({ collectionId: cols[0].id, kind: 'paste', title: displayName, text: content });
      }
      setKbSaved(true);
      setTimeout(() => setKbSaved(false), 2500);
    } catch { /* ignore */ }
    setKbSaving(false);
  };

  const handleSendToChat = async () => {
    try {
      const filePath = artifact.path || artifact.filename || '';
      if (!filePath) return;
      const thread = await api.createThread({ title: t.projectsDiscussPrefix(displayName).slice(0, 40) });
      onClose();
      navigate(`/t/${thread.id}`, {
        state: {
          initialFiles: [{ filePath, name: displayName, isImage: false }],
        },
      });
    } catch { /* ignore */ }
  };

  const isHtml = /\.(html|htm|svg)$/i.test(displayName) || artifact.mimeType?.includes('html') || artifact.mimeType?.includes('svg');
  const isJson = /\.json$/i.test(displayName) || artifact.mimeType?.includes('json');
  const isMarkdown = /\.(md|markdown)$/i.test(displayName) || artifact.mimeType?.includes('markdown');
  const artifactProxyPath = isHtml ? resolveArtifactProxyPath(artifact) : null;
  const editableHtmlFilePath = isHtml ? (artifact.path || artifactProxyPath || artifact.filename || displayName) : '';
  const canDirectEditHtml = Boolean(content && editableHtmlFilePath);

  const handleStartHtmlEdit = () => {
    if (!canDirectEditHtml) return;
    setHtmlEditMode(true);
    setHtmlEditRequest((request) => ({ id: request.id + 1, startInEditMode: true }));
  };

  const handleSaveHtmlEdit = useCallback(async (source: string): Promise<HtmlEditSaveResult | null> => {
    const desktop = getDesktopApi() as ArtifactPreviewDesktopApi | null;
    if (artifactProxyPath && desktop?.kswarmProxyPut) {
      return await desktop.kswarmProxyPut(artifactProxyPath, { content: source }) as HtmlEditSaveResult | null;
    }
    if (artifact.path && desktop?.saveFile) {
      return await desktop.saveFile({ filePath: artifact.path, content: source, purpose: 'html-edit' });
    }
    return { success: false, error: 'save_unavailable' };
  }, [artifact.path, artifactProxyPath]);

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
      if (htmlEditMode && editableHtmlFilePath) {
        return (
          <ArtifactEditableViewer
            htmlContent={content}
            filePath={editableHtmlFilePath}
            onSaveHtmlEdit={artifactProxyPath || artifact.path ? handleSaveHtmlEdit : undefined}
            editModeRequest={htmlEditRequest}
            onAnnotation={() => {}}
            onRevert={() => {
              setHtmlEditMode(false);
              void loadContent();
            }}
            onFinish={() => {
              setHtmlEditMode(false);
              void loadContent();
            }}
            onRefresh={() => void loadContent()}
          />
        );
      }
      const previewContent = prepareHtmlArtifactPreview(content);
      return (
        <iframe srcDoc={previewContent} className="h-full w-full rounded-lg border-[0.5px] border-[var(--c-border-subtle)] bg-white" sandbox="allow-scripts" title={displayName} />
      );
    }

    if (isMarkdown) {
      return (
        <div className="h-full overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--c-md-code-block-bg)] p-4 text-[13px] text-[var(--c-text-primary)]">
          {renderMarkdown(content)}
        </div>
      );
    }

    if (isJson) {
      try {
        const formatted = JSON.stringify(JSON.parse(content), null, 2);
        return <pre className="h-full overflow-auto rounded-lg bg-[var(--c-md-code-block-bg)] p-4 text-[12px] font-mono text-[var(--c-text-primary)]">{formatted}</pre>;
      } catch { /* fallthrough */ }
    }

    return <pre className="h-full overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--c-md-code-block-bg)] p-4 text-[13px] text-[var(--c-text-primary)]">{content}</pre>;
  };

  const modalSizeClass = fullscreen
    ? 'w-[calc(100vw-32px)] h-[calc(100vh-32px)]'
    : 'w-[90vw] max-w-5xl h-[90vh]';
  const isEditingHtmlPreview = isHtml && htmlEditMode && Boolean(editableHtmlFilePath);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/12 backdrop-blur-[2px]"
        role="presentation"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      />
      <div className={`relative ${modalSizeClass} overflow-hidden rounded-2xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] shadow-xl flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--c-border-subtle)] px-5 py-3 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--c-text-heading)] truncate">{displayName}</p>
            <p className="text-[10px] text-[var(--c-text-muted)]">{artifact.mimeType || t.projectsDeliverableUnknownType}</p>
          </div>
          <div className="flex items-center gap-1">
            {canDirectEditHtml && !htmlEditMode && (
              <button
                type="button"
                aria-label={t.artifactHtmlEdit}
                onClick={handleStartHtmlEdit}
                className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
                title={t.artifactHtmlEdit}
              >
                <PencilLine size={15} />
              </button>
            )}
            {content && (
              <button
                type="button"
                aria-label={t.projectsArtifactAddToKb}
                onClick={() => void handleSaveToKb()}
                disabled={kbSaving}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] disabled:opacity-50"
                title={t.projectsArtifactAddToKb}
              >
                {kbSaved ? (
                  <span className="text-[11px] text-green-600">{t.projectsArtifactKbAdded}</span>
                ) : (
                  <>
                    <BookOpen size={14} />
                    <span className="text-[11px]">{t.projectsArtifactKb}</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              aria-label={t.projectsArtifactSendToChat}
              onClick={() => void handleSendToChat()}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
              title={t.projectsArtifactSendToChat}
            >
              <MessageSquare size={14} />
              <span className="text-[11px]">{t.projectsArtifactDiscuss}</span>
            </button>
            <button type="button" aria-label="Toggle fullscreen" onClick={() => setFullscreen(f => !f)} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]" title={fullscreen ? t.projectsArtifactExitFullscreen : t.projectsArtifactFullscreen}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button type="button" aria-label="Download artifact" onClick={handleDownload} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]" title={t.projectsArtifactDownload}><Download size={15} /></button>
            <button type="button" aria-label="Close artifact preview" onClick={onClose} className="rounded-md p-1.5 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]"><X size={15} /></button>
          </div>
        </div>
        {/* Content */}
        <div className={`artifact-preview-modal__content ${isEditingHtmlPreview ? 'artifact-preview-modal__content--editing' : ''}`}>
          {renderContent()}
        </div>
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
