import { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, Wrench, ChevronRight, ChevronDown } from 'lucide-react';

interface ToolCallEvent {
  type: 'canvas_tool_call';
  toolName: string;
  input: unknown;
  toolUseId: string;
  eventId: string;
}

interface ToolResultEvent {
  type: 'canvas_tool_result';
  toolName: string;
  toolUseId: string;
  ok: boolean;
  response: string;
  eventId: string;
}

interface ToolsPanelProps {
  toolCalls: ToolCallEvent[];
  toolResults: ToolResultEvent[];
}

export function ToolsPanel({ toolCalls, toolResults }: ToolsPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Merge tool calls with their results
  const toolRecords = useMemo(() => {
    const resultMap = new Map<string, ToolResultEvent>();
    for (const r of toolResults) {
      resultMap.set(r.toolUseId, r);
    }

    return toolCalls.map(call => ({
      call,
      result: resultMap.get(call.toolUseId),
    }));
  }, [toolCalls, toolResults]);

  const toggleExpand = (toolUseId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(toolUseId)) {
        next.delete(toolUseId);
      } else {
        next.add(toolUseId);
      }
      return next;
    });
  };

  if (toolRecords.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-[var(--c-text-tertiary)]">No tool calls yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {toolRecords.map(({ call, result }) => {
        const isExpanded = expandedIds.has(call.toolUseId);
        const ok = result?.ok ?? true;
        const duration = ''; // Would need timing info from runtime

        return (
          <div key={call.toolUseId} className="border-b border-[var(--c-border-subtle)] last:border-b-0">
            <button
              type="button"
              onClick={() => toggleExpand(call.toolUseId)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--c-bg-deep)]"
            >
              {isExpanded ? (
                <ChevronDown size={14} className="text-[var(--c-text-tertiary)] shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-[var(--c-text-tertiary)] shrink-0" />
              )}
              {ok ? (
                <CheckCircle2 size={14} className="text-green-500 shrink-0" />
              ) : (
                <XCircle size={14} className="text-red-500 shrink-0" />
              )}
              <Wrench size={14} className="text-[var(--c-text-tertiary)] shrink-0" />
              <span className="text-xs font-medium text-[var(--c-text-heading)]">{call.toolName}</span>
              <span className="truncate text-xs text-[var(--c-text-tertiary)]">
                {typeof call.input === 'object' && call.input !== null
                  ? (call.input as Record<string, unknown>).path || ''
                  : ''}
              </span>
              {duration && (
                <span className="ml-auto text-xs text-[var(--c-text-tertiary)]">{duration}</span>
              )}
            </button>
            {isExpanded && (
              <div className="px-3 pb-2">
                {/* Input */}
                <div className="mb-1 text-xs text-[var(--c-text-tertiary)]">Input:</div>
                <pre className="mb-2 max-h-32 overflow-auto rounded bg-[var(--c-bg-card)] p-2 text-xs text-[var(--c-text-secondary)]">
                  {typeof call.input === 'string' ? call.input : JSON.stringify(call.input, null, 2)}
                </pre>
                {/* Output */}
                {result && (
                  <>
                    <div className="mb-1 text-xs text-[var(--c-text-tertiary)]">
                      Output {result.ok ? '(success)' : '(error)'}:
                    </div>
                    <pre className={`max-h-48 overflow-auto rounded p-2 text-xs ${
                      result.ok
                        ? 'bg-[var(--c-bg-card)] text-[var(--c-text-secondary)]'
                        : 'bg-red-50 text-red-700'
                    }`}>
                      {result.response}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
