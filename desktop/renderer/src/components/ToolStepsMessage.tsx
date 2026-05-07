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

function toolLabel(name: string): string {
  switch (name) {
    case 'read': case 'read_file': return 'read';
    case 'write': case 'write_file': return 'write';
    case 'edit': case 'edit_file': return 'edit';
    case 'bash': return 'shell';
    case 'glob': return 'glob';
    case 'grep': return 'grep';
    default: return name;
  }
}

function stepPreview(step: ToolStep): string {
  const input = step.input as Record<string, unknown> | null;
  if (!input) return '';
  if (step.toolName === 'bash' && input.command) return String(input.command).split('\n')[0].slice(0, 80);
  if (step.toolName === 'read' && input.file_path) return String(input.file_path).split('/').pop() || '';
  if (step.toolName === 'write' && input.file_path) return String(input.file_path).split('/').pop() || '';
  if (step.toolName === 'edit' && input.file_path) return String(input.file_path).split('/').pop() || '';
  if (step.toolName === 'glob' && input.pattern) return String(input.pattern);
  if (step.toolName === 'grep' && input.pattern) return String(input.pattern);
  const vals = Object.values(input).slice(0, 2).map(v => typeof v === 'string' ? v.slice(0, 30) : '');
  return vals.filter(Boolean).join(' · ');
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size, flexShrink: 0 }} viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" style={{ color: 'var(--c-accent)' }} />
      <path className="opacity-80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 12a8 8 0 0 1 8-8" style={{ color: 'var(--c-accent)' }} />
    </svg>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const tick = () => { setElapsed(Date.now() - startedAt); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startedAt]);
  return <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-accent)' }}>{formatDuration(elapsed)}</span>;
}

function StepCard({ step, elapsed }: { step: ToolStep; elapsed?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasResponse = !!step.response;
  const duration = step.finishedAt && step.startedAt ? step.finishedAt - step.startedAt : undefined;
  const preview = stepPreview(step);

  return (
    <div style={{ padding: '2px 0' }}>
      {/* Trigger row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (hasResponse) setExpanded(v => !v); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && hasResponse) { e.preventDefault(); setExpanded(v => !v); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          cursor: hasResponse ? 'pointer' : 'default',
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        {/* Status icon */}
        <span style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {step.status === 'running' ? <Spinner size={11} />
            : step.status === 'error' ? <span style={{ color: '#ef4444', fontSize: 11 }}>✕</span>
            : <span style={{ color: '#22c55e', fontSize: 11 }}>✓</span>}
        </span>
        {/* Tool label */}
        <span className="font-mono" style={{ fontSize: 11, opacity: 0.7 }}>{toolLabel(step.toolName)}</span>
        {/* Preview */}
        {preview && (
          <span className="truncate" style={{ fontSize: 12, maxWidth: 320, opacity: 0.55 }}>{preview}</span>
        )}
        {/* Timing */}
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.4, flexShrink: 0 }}>
          {step.status === 'running' && elapsed != null ? formatDuration(elapsed)
            : duration != null ? formatDuration(duration) : ''}
        </span>
        {/* Expand arrow */}
        {hasResponse && (
          <span style={{ fontSize: 10, opacity: 0.35, flexShrink: 0 }}>{expanded ? '∨' : '>'}</span>
        )}
      </div>

      {/* Expanded body */}
      {expanded && hasResponse && (() => {
        const isEdit = step.toolName === 'edit' || step.toolName === 'edit_file';
        const isDiff = isEdit && step.response?.includes('diff --git');
        if (isDiff) {
          return (
            <div className="mt-0.5 mb-1 ml-5 rounded overflow-y-auto" style={{ background: 'var(--c-bg-deep)', maxHeight: 300 }}>
              <DiffView diff={step.response!} maxHeight={300} fallbackText={step.response!} />
            </div>
          );
        }
        return (
          <div className="mt-0.5 mb-1 ml-5 rounded font-mono text-xs whitespace-pre-wrap break-all overflow-y-auto"
            style={{ background: 'var(--c-bg-deep)', padding: '6px 10px', color: 'var(--c-text-secondary)', maxHeight: 160 }}>
            {step.response}
          </div>
        );
      })()}
    </div>
  );
}

export function ToolStepsMessage({ steps, live }: Props) {
  const [expanded, setExpanded] = useState(live);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  useEffect(() => { if (!live) setExpanded(false); }, [live]);

  const doneCount = steps.filter(s => s.status !== 'running').length;
  const activeStep = steps.find(s => s.status === 'running');

  const firstStart = steps.reduce<number>((min, s) => s.startedAt && (!min || s.startedAt < min) ? s.startedAt : min, 0);
  const lastFinish = steps.reduce<number>((max, s) => s.finishedAt && (!max || s.finishedAt > max) ? s.finishedAt : max, 0);
  const totalMs = firstStart && lastFinish ? lastFinish - firstStart : undefined;

  return (
    <div className="py-1 text-sm" style={{ maxWidth: 663 }}>
      {/* Summary header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] transition-colors"
        style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer' }}
      >
        {live && activeStep && <Spinner size={12} />}
        <span style={{ fontSize: 13 }}>
          {live
            ? `${doneCount}/${steps.length} steps · running ${activeStep?.toolName ?? ''}...`
            : `${steps.length} steps completed`}
        </span>
        {!live && totalMs != null && (
          <span className="text-xs" style={{ opacity: 0.5 }}>{formatDuration(totalMs)}</span>
        )}
        {live && activeStep?.startedAt && <ElapsedTimer startedAt={activeStep.startedAt} />}
        <span style={{ fontSize: 11, opacity: 0.5 }}>{expanded ? '∨' : '>'}</span>
      </button>

      {/* Step cards */}
      <div style={{
        overflow: 'hidden',
        maxHeight: expanded ? `${steps.length * 80 + 200}px` : '0px',
        transition: 'max-height 0.2s ease',
      }}>
        {!live && (() => {
          try { return <ChangedFilesTree steps={steps} onFileSelect={(fp) => {
            const s = steps.find(s => {
              const p = s.input && typeof s.input === 'object' ? (s.input as Record<string, unknown>).file_path : null;
              return typeof p === 'string' && p.endsWith(fp.split('/').pop() || '');
            });
            if (s) setExpandedSteps(prev => { const next = new Set(prev); next.add(s.toolUseId); return next; });
          }} />; } catch { return null; }
        })()}
        <div className="mt-1.5 pl-3 space-y-px" style={{ borderLeft: '1.5px solid var(--c-border, #e0e0e0)' }}>
          {steps.map(step => (
            <StepCard
              key={step.toolUseId}
              step={step}
              elapsed={live && step.status === 'running' && step.startedAt ? Date.now() - step.startedAt : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
