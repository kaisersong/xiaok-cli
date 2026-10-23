import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const remote = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/runtime/goal/completion-observation.js', () => ({ observeGoalCompletion: remote.read, unobservedGoalCompletion: () => ({ kind: 'unavailable' }) }));
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
beforeEach(() => { remote.read.mockReset(); });
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'goal-current-')); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new SqliteGoalStore(join(root, 'goals.db')); cleanups.push(() => store.close());
  const state = createGoalState({ sessionId: 'thread', goalId: 'goal', objective: 'original', expectedEvidenceKinds: ['answer'], now: 1 });
  await store.commit({ sessionId: 'thread', expectedRevision: null, next: state, events: [], turns: [], evidence: [] });
  const taskHost = { prepareTask: vi.fn(), startTask: vi.fn(), cancelTask: vi.fn() }, changed = vi.fn();
  const coordinator = new DesktopGoalCoordinator({ store, taskHost, instanceId: 'main', now: () => 2, publishGoalChanged: changed });
  return { store, taskHost, changed, coordinator };
}
it('projects fresh controller observations without persisting them or arming any task', async () => {
  const f = await setup(); remote.read.mockResolvedValue({ kind: 'protected', state: 'verified' });
  expect(await f.coordinator.getGoal('thread')).toMatchObject({ currentCompletion: { kind: 'protected', state: 'verified' }, activation: 'disarmed' });
  remote.read.mockResolvedValue({ kind: 'unavailable' });
  expect(await f.coordinator.getGoal('thread')).toMatchObject({ currentCompletion: { kind: 'unavailable' } });
  expect(await f.store.load('thread')).not.toHaveProperty('currentCompletion');
  expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.taskHost.prepareTask).not.toHaveBeenCalled();
});
it('keeps pause responsive during verification lookup and discards observations for the old state', async () => {
  const f = await setup(); let release!: (value: unknown) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  remote.read.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const query = f.coordinator.getGoal('thread'); await entered;
  expect(await f.coordinator.pauseGoal({ threadId: 'thread' })).toMatchObject({ state: { status: 'paused' }, currentCompletion: { kind: 'unavailable' } });
  release({ kind: 'protected', state: 'verified' });
  expect(await query).toMatchObject({ state: { status: 'paused', revision: 2 }, currentCompletion: { kind: 'unavailable' } });
  expect(f.taskHost.startTask).not.toHaveBeenCalled();
});
