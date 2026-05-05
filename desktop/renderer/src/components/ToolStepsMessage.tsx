import { useState, useEffect } from 'react';
import type { ToolStep } from './ChatView';

interface Props {
  steps: ToolStep[];
  live: boolean;
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

function StepRow({
  step,
  expanded,
  onToggle,
}: {
  step: ToolStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  const params = formatParams(step.input);
  const hasResponse = !!step.response;

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
        {hasResponse && (
          <span
            className="ml-auto text-xs"
            style={{ opacity: 0.35, flexShrink: 0 }}
          >
            {expanded ? '∨' : '>'}
          </span>
        )}
      </button>
      {expanded && hasResponse && (
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
      )}
    </div>
  );
}

export function ToolStepsMessage({ steps, live }: Props) {
  const [expanded, setExpanded] = useState(live);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Auto-collapse when task completes
  useEffect(() => {
    if (!live) setExpanded(false);
  }, [live]);

  const doneCount = steps.filter((s) => s.status !== 'running').length;
  const activeStep = steps.find((s) => s.status === 'running');

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
            ? `${doneCount} step${doneCount !== 1 ? 's' : ''} completed, running ${activeStep?.toolName ?? ''}...`
            : `${steps.length} step${steps.length !== 1 ? 's' : ''} completed`}
        </span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{expanded ? '∨' : '>'}</span>
      </button>

      {/* Step list — CSS max-height transition */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: expanded ? `${steps.length * 120 + 20}px` : '0px',
          transition: 'max-height 0.2s ease',
        }}
      >
        <div
          className="mt-1.5 space-y-0.5 pl-3"
          style={{ borderLeft: '1.5px solid var(--c-border, #e0e0e0)' }}
        >
          {steps.map((step) => (
            <StepRow
              key={step.toolUseId}
              step={step}
              expanded={expandedSteps.has(step.toolUseId)}
              onToggle={() => toggleStep(step.toolUseId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
