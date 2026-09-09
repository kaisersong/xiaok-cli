import { randomUUID } from 'node:crypto';
import type { RuntimeActivity } from '../runtime/events.js';

/** Public execution facts only. This is not a resource/lifecycle authority. */
export interface SubAgentProgressEvent {
  kind: 'started' | 'activity' | 'finished';
  agentId: string;
  taskName: string;
  task: string;
  turn: number;
  timestamp: number;
  startedAt: number;
  elapsedMs: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  phase?: RuntimeActivity['phase'];
  currentTool?: string;
  executionHealth?: RuntimeActivity['executionHealth'];
  toolsCompleted: number;
  toolsFailed: number;
  toolCounts: Record<string, number>;
  resultSummary?: string;
}

export function publicAgentSummary(value: string, limit = 180): string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

export class SubAgentRunReporter {
  private readonly id: string;
  private turn = 0;
  private current?: SubAgentProgressEvent;

  constructor(private readonly taskName: string, id: string | undefined,
    private readonly observer?: (event: SubAgentProgressEvent) => void) {
    this.id = id ?? `subagent_${randomUUID()}`;
  }

  start(task: string): void {
    const now = Date.now();
    this.current = { kind: 'started', agentId: this.id, taskName: publicAgentSummary(this.taskName),
      task: publicAgentSummary(task), turn: ++this.turn, timestamp: now, startedAt: now, elapsedMs: 0,
      status: 'running', phase: 'starting', toolsCompleted: 0, toolsFailed: 0, toolCounts: {} };
    this.emit('started');
  }

  activity(activity: RuntimeActivity): void {
    if (!this.current || this.current.status !== 'running') return;
    this.current.phase = activity.phase;
    this.current.executionHealth = activity.executionHealth;
    this.current.currentTool = activity.toolName && publicAgentSummary(activity.toolName, 60);
    this.emit('activity');
  }

  toolFinished(name: string, ok: boolean): void {
    if (!this.current || this.current.status !== 'running') return;
    this.current.toolsCompleted += 1;
    if (!ok) this.current.toolsFailed += 1;
    const tool = publicAgentSummary(name, 60);
    const previous = this.current.toolCounts[tool];
    this.current.toolCounts = { ...this.current.toolCounts, [tool]: (typeof previous === 'number' ? previous : 0) + 1 };
    this.emit('activity');
  }

  finish(status: Exclude<SubAgentProgressEvent['status'], 'running'>, result?: string): void {
    if (!this.current || this.current.status !== 'running') return;
    this.current.status = status;
    this.current.currentTool = undefined;
    this.current.resultSummary = result ? publicAgentSummary(result) : undefined;
    this.emit('finished');
  }

  private emit(kind: SubAgentProgressEvent['kind']): void {
    if (!this.current || !this.observer) return;
    const timestamp = Date.now();
    try {
      this.observer({ ...this.current, kind, timestamp,
        elapsedMs: Math.max(0, timestamp - this.current.startedAt), toolCounts: { ...this.current.toolCounts } });
    } catch { /* A display observer cannot break execution or cleanup. */ }
  }
}
