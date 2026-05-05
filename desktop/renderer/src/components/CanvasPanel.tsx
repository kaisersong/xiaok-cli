import { useState, useMemo, useEffect } from 'react';
import { X, FolderTree, Code, Wrench, Maximize2, Minimize2 } from 'lucide-react';
import { WorkspaceTree } from './WorkspaceTree';
import { CanvasPreview } from './CanvasPreview';
import { ToolsPanel } from './ToolsPanel';
import { CanvasEmptyState } from './CanvasEmptyState';
import type { DesktopTaskEvent } from '../../../../src/runtime/task-host/types';

interface CanvasPanelProps {
  events: DesktopTaskEvent[];
  onClose: () => void;
  initialPreviewFile?: string;
  initialPreviewContent?: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

type CanvasTab = 'workspace' | 'preview' | 'tools';

const TABS: Array<{ key: CanvasTab; label: string; icon: typeof X }> = [
  { key: 'workspace', label: 'Workspace', icon: FolderTree },
  { key: 'preview', label: 'Preview', icon: Code },
  { key: 'tools', label: 'Tools', icon: Wrench },
];

export function CanvasPanel({ events, onClose, initialPreviewFile, initialPreviewContent, expanded, onToggleExpand }: CanvasPanelProps) {
  const [activeTab, setActiveTab] = useState<CanvasTab>('workspace');
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

  const fileChanges = useMemo(() =>
    events.filter((e): e is Extract<DesktopTaskEvent, { type: 'canvas_file_changed' }> => e.type === 'canvas_file_changed'),
    [events]
  );

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

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    setActiveTab('preview');
  };

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
              title={expanded ? '收起 Canvas' : '展开 Canvas'}
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
            className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
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
