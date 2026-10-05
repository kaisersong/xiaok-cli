import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createIntentPlan } from '../../../src/ai/intent-delegation/planner.js';
import { createRuntimeHooks } from '../../../src/runtime/hooks.js';
import { SessionIntentDelegationStore } from '../../../src/runtime/intent-delegation/store.js';
import { SessionSkillEvalStore } from '../../../src/runtime/intent-delegation/skill-eval-store.js';
import { FileSkillScoreStore } from '../../../src/runtime/intent-delegation/skill-score-store.js';
import { wireSkillEvalToRuntimeSync } from '../../../src/runtime/intent-delegation/skill-eval-sync.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skill-sync-drain-')); roots.push(root);
  const store = new FileSessionStore(root);
  await store.save({ sessionId: 'session', cwd: root, createdAt: 1, updatedAt: 1, lineage: ['session'], messages: [],
    usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [] });
  const ledgerStore = new SessionIntentDelegationStore(store);
  const plan = createIntentPlan({ sessionId: 'session', instanceId: 'host', input: '请写报告，然后生成幻灯片', skills: [] });
  if (plan.kind !== 'plan') throw new Error('actual plan missing');
  await ledgerStore.appendIntent('session', plan.plan);
  const hooks = createRuntimeHooks();
  const errors: unknown[] = [];
  const options = { hooks, ledgerStore, skillEvalStore: new SessionSkillEvalStore(store),
    scoreStore: new FileSkillScoreStore(join(root, 'scores.json')), sessionId: 'session', onError: (error: unknown) => { errors.push(error); } };
  const emit = () => hooks.emit({ type: 'intent_created', sessionId: 'session', turnId: 'turn', intentId: plan.plan.intentId,
    templateId: plan.plan.templateId, deliverable: plan.plan.deliverable, riskTier: plan.plan.riskTier });
  return { store, ledgerStore, options, emit, errors };
}

it('waits for the real queued save after an earlier rejection before rejecting the original stop', async () => {
  const f = await fixture();
  const failure = new Error('original ledger read failed');
  vi.spyOn(f.ledgerStore, 'load').mockRejectedValueOnce(failure);
  const entered = deferred(), release = deferred();
  const save = f.store.save.bind(f.store);
  const writing = vi.spyOn(f.store, 'save').mockImplementation(async (...args) => { entered.resolve(); await release.promise; return save(...args); });
  const stop = wireSkillEvalToRuntimeSync(f.options);
  f.emit();
  const stopping = stop();
  let settled = false;
  void stopping.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    expect(stop()).toBe(stopping);
    expect(settled).toBe(false);
    expect(f.errors).toEqual([failure]);
  } finally { release.resolve(); }
  await expect(stopping).rejects.toMatchObject({ errors: [failure] });
  const before = (await f.store.load('session'))!.storeRevision;
  const calls = writing.mock.calls.length;
  f.emit();
  await new Promise(setImmediate);
  expect(writing).toHaveBeenCalledTimes(calls);
  expect((await f.store.load('session'))!.storeRevision).toBe(before);
});

it('retains an already-settled actual save rejection in every stop call', async () => {
  const f = await fixture(), failure = new Error('original skill save failed');
  vi.spyOn(f.store, 'save').mockRejectedValueOnce(failure);
  const stop = wireSkillEvalToRuntimeSync(f.options);
  f.emit();
  await vi.waitFor(() => expect(f.errors).toEqual([failure]));
  const stopping = stop();
  expect(stop()).toBe(stopping);
  await expect(stopping).rejects.toMatchObject({ errors: [failure] });
  await expect(stop()).rejects.toMatchObject({ errors: [failure] });
});

it('onError reentry joins the same stop without swallowing the original initialization read failure', async () => {
  const f = await fixture(), failure = new Error('initialization read failed');
  vi.spyOn(f.ledgerStore, 'load').mockRejectedValueOnce(failure);
  let stop!: () => Promise<void>, nested!: Promise<void>;
  stop = wireSkillEvalToRuntimeSync({ ...f.options, onError(error) { f.errors.push(error); nested = stop(); void nested.catch(() => {}); } });
  await vi.waitFor(() => expect(nested).toBeDefined());
  expect(stop()).toBe(nested);
  await expect(nested).rejects.toMatchObject({ errors: [failure] });
});
