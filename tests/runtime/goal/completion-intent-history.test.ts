import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileGoalStore } from '../../../src/runtime/goal/file-store.js';
import { InMemoryGoalStore } from '../../../src/runtime/goal/memory-store.js';
import { SqliteGoalStore } from '../../../desktop/electron/goal-store-sqlite.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { createGoalCompletionIntent } from '../../../src/runtime/goal/completion-intent.js';
import type { GoalStore } from '../../../src/runtime/goal/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
for (const kind of ['file', 'memory', 'sqlite'] as const) {
  it(`${kind}: reads only the exact session's original intent after switching the current Goal`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'goal-intent-history-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'goals.db');
    const store: GoalStore = kind === 'file' ? new FileGoalStore(root)
      : kind === 'memory' ? new InMemoryGoalStore() : new SqliteGoalStore(path);
    if (store instanceof SqliteGoalStore) cleanups.push(() => store.close());
    const first = createGoalState({ sessionId: 'session', objective: 'first', expectedEvidenceKinds: ['answer'], now: 1 });
    const intent = createGoalCompletionIntent({ state: first, taskId: 'task', turnId: 'turn', summary: 'original claim', now: 1 });
    await store.commit({ sessionId: 'session', expectedRevision: null, next: { ...first, status: 'cancelled' },
      events: [], turns: [], evidence: [], completionIntent: { expectedRevision: null, next: intent } });
    const second = createGoalState({ sessionId: 'session', objective: 'second', expectedEvidenceKinds: ['answer'], now: 2 });
    await store.commit({ sessionId: 'session', expectedRevision: first.revision, next: second, events: [], turns: [], evidence: [] });
    const reader = kind === 'file' ? new FileGoalStore(root) : kind === 'sqlite' ? new SqliteGoalStore(path) : store;
    if (reader instanceof SqliteGoalStore) cleanups.push(() => reader.close());
    const read = await reader.loadCompletionIntent('session', intent.intentId);
    expect(read).toEqual(intent);
    read!.summary = 'mutated external snapshot';
    expect(await reader.loadCompletionIntent('session', intent.intentId)).toEqual(intent);
    expect(await reader.loadCompletionIntent('other', intent.intentId)).toBeNull();
    expect(await reader.loadCompletionIntent('session', 'missing')).toBeNull();
    const terminal = { ...intent, revision: 2, status: 'superseded' as const, updatedAt: 3 };
    await reader.updateCompletionIntent('session', { expectedRevision: 1, next: terminal });
    expect(await reader.loadCompletionIntent('session', intent.intentId)).toEqual(terminal);
    expect((await reader.load('session'))!.state).toEqual(second);
  });
}
