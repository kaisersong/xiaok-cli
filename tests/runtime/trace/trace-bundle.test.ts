import { describe, expect, it } from 'vitest';
import { validateTraceBundle, type TraceBundleV1 } from '../../../src/runtime/trace/schema.js';

function baseBundle(): TraceBundleV1 {
  return {
    schemaVersion: 1,
    bundleId: 'trace_test_1',
    createdAt: '2026-05-18T00:00:00.000Z',
    source: { app: 'kswarm', version: '1.3.1' },
    scope: { kind: 'project', projectId: 'proj-1', workspaceRoot: '/Users/[USER]/projects/example' },
    environment: { cwd: '/Users/[USER]/projects/example', branch: 'feat/ahe-lite-mvp' },
    turns: [],
    events: [
      { id: 'event-1', ts: '2026-05-18T00:00:01.000Z', source: 'kswarm', type: 'project.health', refs: { taskId: 'item-3' } },
    ],
    toolCalls: [],
    approvals: [],
    tasks: [
      { id: 'item-1', title: 'Accepted task', status: 'accepted' },
      { id: 'item-2', title: 'Submitted task', status: 'submitted' },
      { id: 'item-3', title: 'Blocked task', status: 'blocked', blockedReason: 'missing_review_evidence' },
    ],
    agents: [
      { id: 'agent-1', name: 'CLI Claude', status: 'waiting' },
      { id: 'agent-2', name: 'CLI Codex', status: 'completed' },
    ],
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: { eventCount: 1, taskCount: 3, artifactCount: 0 },
  };
}

describe('trace bundle schema', () => {
  it('accepts KSwarm project status values needed by desktop contract sync', () => {
    expect(validateTraceBundle(baseBundle())).toEqual({ ok: true });
  });

  it('rejects missing required top-level fields with field paths', () => {
    const bundle = baseBundle() as unknown as Record<string, unknown>;
    delete bundle.bundleId;
    delete bundle.source;

    expect(validateTraceBundle(bundle)).toEqual({
      ok: false,
      errors: ['bundleId', 'source.app'],
    });
  });

  it('rejects duplicate event ids and bad refs', () => {
    const bundle = baseBundle();
    bundle.events.push({
      id: 'event-1',
      ts: '2026-05-18T00:00:02.000Z',
      source: 'diagnoser',
      type: 'finding',
      refs: { taskId: 'missing-task' },
    });

    const result = validateTraceBundle(bundle);

    expect(result).toEqual({
      ok: false,
      errors: ['events[1].id:duplicate', 'events[1].refs.taskId:missing-task'],
    });
  });

  it('rejects unknown task and agent statuses', () => {
    const bundle = baseBundle();
    bundle.tasks[0].status = 'mystery';
    bundle.agents[0].status = 'confused';

    const result = validateTraceBundle(bundle);

    expect(result).toEqual({
      ok: false,
      errors: ['tasks[0].status:mystery', 'agents[0].status:confused'],
    });
  });
});
