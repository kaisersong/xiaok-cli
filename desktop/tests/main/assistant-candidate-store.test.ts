import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSISTANT_EVENING_LOOP_ID } from '../../electron/assistant-types.js';
import { LoopStore } from '../../electron/loop-store.js';

describe('assistant candidates in LoopStore', () => {
  let rootDir: string;
  let store: LoopStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-assistant-candidate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new LoopStore(join(rootDir, 'loop-evidence.sqlite'));
    store.ensureBuiltInLoops(1_000);
    store.setLoopStatus(ASSISTANT_EVENING_LOOP_ID, 'active', 1_001);
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('keeps staged candidates invisible until the loop success finalizer publishes them atomically', () => {
    const started = store.beginLoopRun(
      ASSISTANT_EVENING_LOOP_ID,
      { kind: 'assistant', logicalRunKey: 'assistant:default-personal-assistant:evening:Asia/Shanghai:2026-08-14' },
      2_000,
      60_000,
    );
    if (started.status !== 'started') throw new Error(`expected started, got ${started.status}`);

    const [candidate] = store.stageAssistantCandidates(started.run.id, [{
      kind: 'memory',
      title: '偏好',
      content: '用户偏好中文回复。',
      scope: 'global',
      confidence: 0.9,
      evidenceRefs: [{ kind: 'thread', id: 'thread-1' }],
      dedupeKey: 'memory:language:zh',
    }], 2_100);

    expect(candidate.status).toBe('staged');
    expect(store.listAssistantCandidates({ statuses: ['pending'] })).toEqual([]);

    const run = store.finishAssistantLoopRunSuccess(started.run.id, ['evidence-1'], 2_200, 'done');

    expect(run?.status).toBe('success');
    expect(store.listAssistantCandidates({ statuses: ['pending'] })).toEqual([
      expect.objectContaining({ id: candidate.id, runId: started.run.id, status: 'pending' }),
    ]);
  });

  it('supersedes staged candidates when a run fails and protects assistant history from deletion', () => {
    const started = store.beginLoopRun(ASSISTANT_EVENING_LOOP_ID, { kind: 'manual' }, 2_000, 60_000);
    if (started.status !== 'started') throw new Error(`expected started, got ${started.status}`);
    const [candidate] = store.stageAssistantCandidates(started.run.id, [{
      kind: 'follow_up', title: '跟进', content: '确认发布窗口。', scope: 'global', confidence: 0.8,
      evidenceRefs: [{ kind: 'task', id: 'task-1' }], dedupeKey: 'follow-up:release-window',
    }], 2_100);

    store.finishLoopRunFailure(started.run.id, 'executor_failed', 'provider unavailable', [], 2_200);

    expect(store.getAssistantCandidate(candidate.id)?.status).toBe('superseded');
    expect(() => store.clearLoopRunHistory(ASSISTANT_EVENING_LOOP_ID)).toThrow('protected_history');
  });
});
