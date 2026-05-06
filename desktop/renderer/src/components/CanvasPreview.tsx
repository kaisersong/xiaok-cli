import { useMemo, useRef, useEffect, useState } from 'react';
import { Code, Eye } from 'lucide-react';
import { ArtifactIframe } from './ArtifactIframe';
import { MarkdownRenderer } from './MarkdownRenderer';

interface CanvasPreviewProps {
  filePath: string;
  content: string;
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

export function CanvasPreview({ filePath, content }: CanvasPreviewProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const iframeSrc = useRef<string | null>(null);

  const isHtml = isHtmlFile(filePath);
  const isMarkdown = isMarkdownFile(filePath);
  const isImage = isImageFile(filePath);
  const isText = isTextFile(filePath, content);

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
    if (!isHtml && !isMarkdown && !isImage) {
      setViewMode('code');
    } else {
      setViewMode('preview');
    }
  }, [filePath, isHtml, isMarkdown, isImage]);

  const hasCodeView = isText;
  const hasPreview = isHtml || isMarkdown || isImage;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      {(hasCodeView && hasPreview) && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1">
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
          <span className="ml-auto truncate text-xs text-[var(--c-text-tertiary)]">{filePath}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'preview' && isHtml && htmlBlobUrl && (
          <div className="h-full bg-white">
            <iframe
              src={htmlBlobUrl}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin"
              title={filePath}
            />
          </div>
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
