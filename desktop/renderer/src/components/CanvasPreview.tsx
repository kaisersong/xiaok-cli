import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Code, Eye, Download } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ArtifactEditableViewer, type AnnotationPayload } from './ArtifactEditableViewer';
import { formatAnnotationForChat } from '../hooks/useArtifactAnnotation';
import { getDesktopApi } from '../shared/desktop';

interface CanvasPreviewProps {
  filePath: string;
  content: string;
  /** Called when user submits an annotation from the artifact toolbar */
  onAnnotation?: (message: string) => void;
  /** Called when user clicks refresh button */
  onRefresh?: () => void;
}

const textLikeMimeTypes = new Set([
  'application/json', 'application/xml', 'application/javascript',
  'application/yaml', 'application/x-yaml', 'application/toml',
  'application/markdown', 'application/x-markdown',
]);

const textFallbackExtensions = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'xml', 'yml', 'yaml', 'toml',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'css', 'html', 'htm', 'sh', 'bash', 'zsh',
  'py', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'sql', 'csv', 'tsv',
]);

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).trim().toLowerCase();
}

function isTextFile(path: string, content: string): boolean {
  const ext = getFileExtension(path);
  if (ext === 'pdf') return false;
  if (textFallbackExtensions.has(ext)) return true;
  // Check for binary content markers
  if (content.includes('\0')) return false;
  return true;
}

function isHtmlFile(path: string): boolean {
  return path.endsWith('.html') || path.endsWith('.htm');
}

function isMarkdownFile(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.markdown');
}

function isImageFile(path: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(path);
}

function isPdfFile(path: string): boolean {
  return /\.pdf$/i.test(path);
}

function isPdfDataUrl(content: string): boolean {
  return /^data:application\/pdf(?:;[^,]*)*;base64,/i.test(content.trimStart());
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path || 'download';
}

export function CanvasPreview({ filePath, content, onAnnotation, onRefresh }: CanvasPreviewProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const iframeSrc = useRef<string | null>(null);

  const isHtml = isHtmlFile(filePath);
  const isMarkdown = isMarkdownFile(filePath);
  const isImage = isImageFile(filePath);
  const isPdf = isPdfFile(filePath);
  const isText = isTextFile(filePath, content);
  const fileName = useMemo(() => getFileName(filePath), [filePath]);
  const pdfSrc = useMemo(() => (
    isPdf && isPdfDataUrl(content) ? content.trim() : null
  ), [content, isPdf]);

  // Create blob URL for HTML preview
  const htmlBlobUrl = useMemo(() => {
    if (!isHtml || !content) return null;
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframeSrc.current = url;
    return url;
  }, [isHtml, content]);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (iframeSrc.current) {
        URL.revokeObjectURL(iframeSrc.current);
        iframeSrc.current = null;
      }
    };
  }, []);

  // Auto-select code mode for non-previewable files
  useEffect(() => {
    if (!isHtml && !isMarkdown && !isImage && !isPdf) {
      setViewMode('code');
    } else {
      setViewMode('preview');
    }
  }, [filePath, isHtml, isMarkdown, isImage, isPdf]);

  const handleAnnotation = useCallback((payload: AnnotationPayload) => {
    if (onAnnotation) {
      onAnnotation(formatAnnotationForChat(payload, filePath));
    }
  }, [onAnnotation, filePath]);

  const handleRevert = useCallback(() => {
    // Trigger revert via IPC
    if (typeof window !== 'undefined' && (getDesktopApi() as any)?.artifactRevert) {
      (getDesktopApi() as any).artifactRevert(filePath);
    }
  }, [filePath]);

  const handleFinish = useCallback(() => {
    // Cleanup backups via IPC
    if (typeof window !== 'undefined' && (getDesktopApi() as any)?.artifactCleanup) {
      (getDesktopApi() as any).artifactCleanup(filePath);
    }
  }, [filePath]);

  const handleDownload = useCallback(async () => {
    const api = getDesktopApi() as any;
    if (api?.showSaveDialog && api?.saveFile) {
      const { canceled, filePath: savePath } = await api.showSaveDialog({
        defaultPath: fileName,
        ...(isPdf ? { filters: [{ name: 'PDF', extensions: ['pdf'] }] } : {}),
      });
      if (canceled || !savePath) return;
      await api.saveFile({ filePath: savePath, content });
    } else {
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [content, fileName, isPdf]);

  const hasCodeView = isText;
  const hasPreview = isHtml || isMarkdown || isImage || isPdf;
  const isFramedPreview = viewMode === 'preview' && (isHtml || isPdf);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      {(hasCodeView || hasPreview) && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1">
          {(hasCodeView && hasPreview) && (
            <div className="flex rounded-lg bg-[var(--c-bg-page)] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-[var(--c-bg-card)] text-[var(--c-text-heading)] shadow-sm'
                    : 'text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]'
                }`}
              >
                <Eye size={12} /> Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode('code')}
                className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                  viewMode === 'code'
                    ? 'bg-[var(--c-bg-card)] text-[var(--c-text-heading)] shadow-sm'
                    : 'text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]'
                }`}
              >
                <Code size={12} /> Code
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleDownload}
            className="ml-auto flex items-center gap-1 rounded p-1 text-xs text-[var(--c-text-tertiary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)]"
            title="下载到本地"
          >
            <Download size={12} />
          </button>
          <span className="truncate text-xs text-[var(--c-text-tertiary)]">{filePath}</span>
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 min-h-0 ${isFramedPreview ? 'flex flex-col overflow-hidden' : 'overflow-auto'}`}>
        {viewMode === 'preview' && isHtml && content && (
          <ArtifactEditableViewer
            htmlContent={content}
            filePath={filePath}
            onAnnotation={handleAnnotation}
            onRevert={handleRevert}
            onFinish={handleFinish}
            onRefresh={onRefresh}
          />
        )}

        {viewMode === 'preview' && isMarkdown && (
          <div className="h-full overflow-auto bg-[var(--c-bg-card)] p-4">
            <MarkdownRenderer content={content} />
          </div>
        )}

        {viewMode === 'preview' && isImage && (
          <div className="flex h-full items-center justify-center bg-[var(--c-bg-page)] p-4">
            <img src={content} alt={filePath} className="max-h-full max-w-full object-contain" />
          </div>
        )}

        {viewMode === 'preview' && isPdf && (
          pdfSrc ? (
            <iframe
              title={`PDF preview: ${fileName}`}
              src={pdfSrc}
              className="h-full w-full border-0 bg-[var(--c-bg-card)]"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-xs text-[var(--c-text-tertiary)]">PDF preview is loading...</p>
            </div>
          )
        )}

        {viewMode === 'code' && (
          <pre className="h-full overflow-auto bg-[var(--c-bg-card)] p-3 text-xs text-[var(--c-text-secondary)]">
            <code>{content}</code>
          </pre>
        )}

        {!hasPreview && !hasCodeView && (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-xs text-[var(--c-text-tertiary)]">Preview not available for this file type</p>
          </div>
        )}
      </div>
    </div>
  );
}
