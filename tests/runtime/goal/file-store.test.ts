import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileGoalStore,
  GoalTamperDetectedError,
  createGoalState,
} from '../../../src/runtime/goal/index.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('FileGoalStore', () => {
  it('atomically persists one Goal document and rejects stale CAS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-store-'));
    roots.push(root);
    const store = new FileGoalStore(root);
    const state = createGoalState({
      sessionId: 'sess_1', objective: 'answer', expectedEvidenceKinds: ['answer'], now: 1,
    });
    await store.commit({
      sessionId: 'sess_1', expectedRevision: null, next: state,
      events: [], turns: [], evidence: [],
    });
    expect((await store.load('sess_1'))?.state.goalId).toBe(state.goalId);
    await expect(store.commit({
      sessionId: 'sess_1', expectedRevision: null, next: state,
      events: [], turns: [], evidence: [],
    })).rejects.toThrow(/stale/i);
  });

  it('detects an out-of-band disk modification while the store is active', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-store-'));
    roots.push(root);
    const store = new FileGoalStore(root);
    const state = createGoalState({
      sessionId: 'sess_1', objective: 'answer', expectedEvidenceKinds: ['answer'], now: 1,
    });
    await store.commit({
      sessionId: 'sess_1', expectedRevision: null, next: state,
      events: [], turns: [], evidence: [],
    });
    const filePath = join(root, 'sess_1.goal.json');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    writeFileSync(filePath, JSON.stringify({ ...parsed, tampered: true }), 'utf8');

    // GoalService reads the current revision before every mutation. That read
    // must not bless an out-of-band rewrite as the new trusted digest.
    await store.load('sess_1');

    await expect(store.commit({
      sessionId: 'sess_1', expectedRevision: state.revision,
      next: { ...state, revision: state.revision + 1 },
      events: [], turns: [], evidence: [],
    })).rejects.toBeInstanceOf(GoalTamperDetectedError);
  });
});
