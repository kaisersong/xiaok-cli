import { useState, useEffect, useRef } from 'react';
import type { ToolStep } from './ChatView';
import { DiffView } from './DiffView';
import { ChangedFilesTree } from './ChangedFilesTree';

interface Props {
  steps: ToolStep[];
  live: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function formatParams(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const entries = Object.entries(input as Record<string, unknown>).slice(0, 3);
  return entries
    .map(([k, v]) => {
      const val =
        typeof v === 'string'
          ? v.slice(0, 40)
          : JSON.stringify(v).slice(0, 40);
      return `${k}=${val}`;
    })
    .join(' ');
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size, flexShrink: 0 }}
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        style={{ color: 'var(--c-accent)' }}
      />
      <path
        className="opacity-80"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M4 12a8 8 0 0 1 8-8"
        style={{ color: 'var(--c-accent)' }}
      />
    </svg>
  );
}

// Group consecutive same-tool calls
interface StepGroup {
  toolName: string;
  steps: ToolStep[];
}

function groupSteps(steps: ToolStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.toolName === step.toolName) {
      last.steps.push(step);
    } else {
      groups.push({ toolName: step.toolName, steps: [step] });
    }
  }
  return groups;
}

function StepRow({
  step,
  expanded,
  onToggle,
  elapsed,
}: {
  step: ToolStep;
  expanded: boolean;
  onToggle: () => void;
  elapsed?: number;
}) {
  const params = formatParams(step.input);
  const hasResponse = !!step.response;
  const duration = step.finishedAt && step.startedAt ? step.finishedAt - step.startedAt : undefined;

  return (
    <div>
      <button
        type="button"
        onClick={hasResponse ? onToggle : undefined}
        className="flex items-center gap-1.5 w-full text-left py-0.5 text-[var(--c-text-secondary)] transition-colors"
        style={{ cursor: hasResponse ? 'pointer' : 'default' }}
      >
        <span style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {step.status === 'running' ? (
            <Spinner size={11} />
          ) : step.status === 'error' ? (
            <span style={{ color: '#ef4444', fontSize: 11 }}>✕</span>
          ) : (
            <span style={{ color: '#22c55e', fontSize: 11 }}>✓</span>
          )}
        </span>
        <span className="font-mono text-xs">{step.toolName}</span>
        {params && (
          <span
            className="text-xs truncate"
            style={{ opacity: 0.45, maxWidth: 300 }}
          >
            {params}
          </span>
        )}
        <span className="ml-auto text-xs shrink-0" style={{ opacity: 0.5 }}>
          {step.status === 'running' && elapsed != null
            ? formatDuration(elapsed)
            : duration != null
              ? formatDuration(duration)
              : ''}
        </span>
        {hasResponse && (
          <span
            className="text-xs"
            style={{ opacity: 0.35, flexShrink: 0 }}
          >
            {expanded ? '∨' : '>'}
          </span>
        )}
      </button>
      {expanded && hasResponse && (() => {
        const isEdit = step.toolName === 'edit' || step.toolName === 'Edit' || step.toolName === 'edit_file'
        const isDiff = isEdit && step.response?.includes('diff --git')
        if (isDiff) {
          return (
            <div className="mt-0.5 mb-1 ml-5 rounded overflow-y-auto" style={{ background: 'var(--c-bg-deep)', maxHeight: 300 }}>
              <DiffView diff={step.response!} maxHeight={300} fallbackText={step.response!} />
            </div>
          )
        }
        return (
          <div
            className="mt-0.5 mb-1 ml-5 rounded font-mono text-xs whitespace-pre-wrap break-all overflow-y-auto"
            style={{
              background: 'var(--c-bg-deep)',
              padding: '6px 10px',
              color: 'var(--c-text-secondary)',
              maxHeight: 160,
            }}
          >
            {step.response}
          </div>
        )
      })()}
    </div>
  );
}

// Live elapsed timer for running step
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      setElapsed(Date.now() - startedAt);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startedAt]);

  return (
    <span className="font-mono text-xs" style={{ color: 'var(--c-accent)' }}>
      {formatDuration(elapsed)}
    </span>
  );
}

export function ToolStepsMessage({ steps, live }: Props) {
  const [expanded, setExpanded] = useState(live);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!live) setExpanded(false);
  }, [live]);

  const doneCount = steps.filter((s) => s.status !== 'running').length;
  const activeStep = steps.find((s) => s.status === 'running');

  // Compute total elapsed time
  const firstStart = steps.reduce((min, s) => {
    if (s.startedAt && (!min || s.startedAt < min)) return s.startedAt;
    return min;
  }, 0 as number | null);
  const lastFinish = steps.reduce((max, s) => {
    if (s.finishedAt && (!max || s.finishedAt > max)) return s.finishedAt;
    return max;
  }, 0 as number | null);
  const totalMs = firstStart && lastFinish ? lastFinish - firstStart : undefined;

  const toggleStep = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const groups = groupSteps(steps);

  return (
    <div className="py-1 text-sm" style={{ maxWidth: 663 }}>
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] transition-colors"
        style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer' }}
      >
        {live && activeStep ? (
          <Spinner size={12} />
        ) : null}
        <span style={{ fontSize: 13 }}>
          {live
            ? `${doneCount}/${steps.length} step${steps.length !== 1 ? 's' : ''} · running ${activeStep?.toolName ?? ''}...`
            : `${steps.length} step${steps.length !== 1 ? 's' : ''} completed`}
        </span>
        {!live && totalMs != null && (
          <span className="text-xs" style={{ opacity: 0.5 }}>{formatDuration(totalMs)}</span>
        )}
        {live && activeStep?.startedAt && (
          <ElapsedTimer startedAt={activeStep.startedAt} />
        )}
        <span style={{ fontSize: 11, opacity: 0.5 }}>{expanded ? '∨' : '>'}</span>
      </button>

      {/* Step list */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: expanded ? `${steps.length * 120 + 200}px` : '0px',
          transition: 'max-height 0.2s ease',
        }}
      >
        {!live && (() => {
          try {
            return <ChangedFilesTree steps={steps} onFileSelect={(fp) => {
              const s = steps.find(s => {
                const p = s.input && typeof s.input === 'object' ? (s.input as Record<string, unknown>).file_path : null
                return typeof p === 'string' && p.endsWith(fp.split('/').pop() || '')
              })
              if (s) toggleStep(s.toolUseId)
            }} />
          } catch { return null }
        })()}
        <div
          className="mt-1.5 space-y-0.5 pl-3"
          style={{ borderLeft: '1.5px solid var(--c-border, #e0e0e0)' }}
        >
          {groups.map((group) => {
            if (group.steps.length === 1) {
              const step = group.steps[0];
              return (
                <StepRow
                  key={step.toolUseId}
                  step={step}
                  expanded={expandedSteps.has(step.toolUseId)}
                  onToggle={() => toggleStep(step.toolUseId)}
                  elapsed={live && step.status === 'running' && step.startedAt ? Date.now() - step.startedAt : undefined}
                />
              );
            }
            // Group header + individual steps
            const groupDuration = group.steps.reduce((sum, s) => {
              if (s.startedAt && s.finishedAt) return sum + (s.finishedAt - s.startedAt);
              return sum;
            }, 0);
            return (
              <div key={group.steps[0].toolUseId + '-group'}>
                <div className="flex items-center gap-1 py-0.5">
                  <span className="text-xs font-medium" style={{ opacity: 0.6 }}>{group.toolName}</span>
                  <span className="text-xs" style={{ opacity: 0.4 }}>×{group.steps.length}</span>
                  {groupDuration > 0 && (
                    <span className="text-xs ml-1" style={{ opacity: 0.4 }}>{formatDuration(groupDuration)}</span>
                  )}
                </div>
                <div className="pl-4 space-y-0.5">
                  {group.steps.map((step) => (
                    <StepRow
                      key={step.toolUseId}
                      step={step}
                      expanded={expandedSteps.has(step.toolUseId)}
                      onToggle={() => toggleStep(step.toolUseId)}
                      elapsed={live && step.status === 'running' && step.startedAt ? Date.now() - step.startedAt : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
