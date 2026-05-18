import type { TraceEvent } from '../trace/schema.js';

export type GuardMode = 'off' | 'pass' | 'warn' | 'block';

export type GuardDecision =
  | { ok: true; mode: 'off' | 'pass'; events: TraceEvent[] }
  | { ok: false; mode: 'warn' | 'block'; reason: string; action: string; events: TraceEvent[]; allowOverride: boolean };

export interface ExecutionScope {
  kind: 'code' | 'document' | 'slide' | 'data' | 'general' | 'project' | 'unknown';
  confidence: number;
}

export function guardEvent(input: {
  guardId: string;
  mode: 'passed' | 'warned' | 'blocked' | 'override';
  target?: string;
  taskId?: string;
  artifactId?: string;
  category?: string;
  reason?: string;
  action?: string;
  override?: { actor: string; reason: string };
}): TraceEvent {
  const refs: TraceEvent['refs'] = {};
  if (input.taskId) refs.taskId = input.taskId;
  if (input.artifactId) refs.artifactId = input.artifactId;
  return {
    id: `guard:${input.guardId}:${input.mode}:${safeId(input.target ?? input.taskId ?? input.artifactId ?? 'target')}`,
    ts: new Date().toISOString(),
    source: 'guard',
    type: `guard.${input.mode}`,
    severity: input.mode === 'blocked' ? 'error' : input.mode === 'warned' ? 'warn' : 'info',
    refs,
    data: {
      guardId: input.guardId,
      category: input.category,
      reason: input.reason,
      action: input.action,
      target: input.target,
      override: input.override,
    },
  };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
