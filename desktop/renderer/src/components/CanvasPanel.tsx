import { useState, useMemo, useEffect, useCallback } from 'react';
import { X, FolderTree, Code, Wrench, Maximize2, Minimize2 } from 'lucide-react';
import { WorkspaceTree } from './WorkspaceTree';
import { CanvasPreview, type CanvasPreviewModeRequest } from './CanvasPreview';
import { ToolsPanel } from './ToolsPanel';
import { CanvasEmptyState } from './CanvasEmptyState';
import { api } from '../api';
import { useLocale } from '../contexts/LocaleContext';
import type { DesktopTaskEvent } from '../../../shared/task-types';

interface CanvasPanelProps {
  events: DesktopTaskEvent[];
  onClose: () => void;
  initialPreviewFile?: string;
  initialPreviewContent?: string;
  initialPreviewModeRequest?: CanvasPreviewModeRequest;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onAnnotation?: (message: string) => void;
}

type CanvasTab = 'workspace' | 'preview' | 'tools';

const TABS: Array<{ key: CanvasTab; label: string; icon: typeof X }> = [
  { key: 'preview', label: 'Preview', icon: Code },
  { key: 'workspace', label: 'Workspace', icon: FolderTree },
  { key: 'tools', label: 'Tools', icon: Wrench },
];

export function CanvasPanel({ events, onClose, initialPreviewFile, initialPreviewContent, initialPreviewModeRequest, expanded, onToggleExpand, onAnnotation }: CanvasPanelProps) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<CanvasTab>('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');

  // When opened with an initial artifact, jump straight to preview
  useEffect(() => {
    if (initialPreviewFile) {
      setSelectedFile(initialPreviewFile);
      setPreviewContent(initialPreviewContent ?? '');
      setActiveTab('preview');
    }
  }, [initialPreviewFile, initialPreviewContent]);

  // Extract canvas-specific events
  const toolCalls = useMemo(() =>
    events.filter((e): e is Extract<DesktopTaskEvent, { type: 'canvas_tool_call' }> => e.type === 'canvas_tool_call'),
    [events]
  );

  const toolResults = useMemo(() =>
    events.filter((e): e is Extract<DesktopTaskEvent, { type: 'canvas_tool_result' }> => e.type === 'canvas_tool_result'),
    [events]
  );

  const fileChanges = useMemo(() => {
    // Primary source: canvas_file_changed events
    const changes: Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }>[] = events.filter(
      (e): e is Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }> => e.type === 'canvas_file_changed'
    );
    // Fallback: extract files from canvas_tool_call Write events for backward compatibility
    if (changes.length === 0) {
      for (const e of events) {
        if (e.type === 'canvas_tool_call') {
          const call = e as { toolName: string; input: Record<string, unknown> };
          const toolName = call.toolName.toLowerCase();
          if ((toolName === 'write' || toolName === 'bash') && call.input?.file_path) {
            changes.push({
              type: 'canvas_file_changed',
              filePath: call.input.file_path as string,
              change: 'add',
              eventId: (e as { eventId: string }).eventId,
            } as Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }>);
          }
        }
      }
    }
    return changes;
  }, [events]);

  // Extract file content from tool results (Write tool)
  const fileContents = useMemo(() => {
    const contents: Record<string, string> = {};
    for (const result of toolResults) {
      if (result.toolName === 'Write' && result.ok) {
        try {
          const response = typeof result.response === 'string' ? result.response : result.response;
          // Try to extract file path and content from Write response
          const parsed = JSON.parse(response);
          if (parsed.path) {
            contents[parsed.path] = parsed.content || response;
          }
        } catch {
          // Non-JSON response, skip
        }
      }
    }
    return contents;
  }, [toolResults]);

  const hasContent = fileChanges.length > 0 || toolCalls.length > 0;

  // Auto-refresh preview when the selected file is modified by Agent
  const fileChangesLen = fileChanges.length;
  const toolResultsLen = toolResults.length;
  useEffect(() => {
    if (!selectedFile) return;
    // Re-read content whenever events indicate the file may have changed
    (async () => {
      try {
        const r = await api.readFileContent(selectedFile);
        setPreviewContent(r.content);
      } catch { /* ignore */ }
    })();
  }, [fileChangesLen, toolResultsLen, selectedFile]);

  const handleRefreshPreview = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const r = await api.readFileContent(selectedFile);
      setPreviewContent(r.content);
    } catch { /* ignore */ }
  }, [selectedFile]);

  const handleFileSelect = useCallback(async (path: string) => {
    setSelectedFile(path);
    setActiveTab('preview');
    setPreviewContent('');
    try {
      const r = await api.readFileContent(path);
      setPreviewContent(r.content);
    } catch {
      setPreviewContent('');
    }
  }, []);

  return (
    <div
      className="flex h-full flex-col border-l border-[var(--c-border)] bg-[var(--c-bg-page)] transition-[width,min-width,max-width] duration-200"
      style={{ width: expanded ? '60%' : 360, minWidth: expanded ? 500 : 360, maxWidth: expanded ? '70%' : 480, flexShrink: 0 }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--c-border)] px-3 py-2">
        <span className="text-sm font-medium text-[var(--c-text-heading)]">Canvas</span>
        <div className="flex items-center gap-1">
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
              title={expanded ? t.canvasPanelCollapseCanvas : t.canvasPanelExpandCanvas}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
            title="Close Canvas"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b border-[var(--c-border)] bg-[var(--c-bg-card)]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 p-2 text-xs transition-colors ${
              activeTab === key
                ? 'border-b-2 border-[var(--c-accent)] font-medium text-[var(--c-text-heading)]'
                : 'text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]'
            }`}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'workspace' && (
          hasContent ? (
            <WorkspaceTree
              fileChanges={fileChanges}
              onSelectFile={handleFileSelect}
            />
          ) : (
            <CanvasEmptyState message="Start a task to see workspace files" />
          )
        )}

        {activeTab === 'preview' && selectedFile && (
          <CanvasPreview
            filePath={selectedFile}
            content={previewContent || fileContents[selectedFile] || ''}
            modeRequest={initialPreviewModeRequest}
            onAnnotation={onAnnotation}
            onRefresh={handleRefreshPreview}
          />
        )}
        {activeTab === 'preview' && !selectedFile && (
          <CanvasEmptyState message="Select a file to preview" />
        )}

        {activeTab === 'tools' && (
          hasContent ? (
            <ToolsPanel toolCalls={toolCalls} toolResults={toolResults} />
          ) : (
            <CanvasEmptyState message="Tool calls will appear here" />
          )
        )}
      </div>
    </div>
  );
}
