import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoopStore } from '../../electron/loop-store.js';
import { createLoopNativeWorkflow } from '../../electron/loop-native-workflow.js';

it('revokes ingress on close before reading a candidate or opening any native client', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loop-native-ingress-'));
  const store = new LoopStore(join(root, 'loop.sqlite'));
  const workflow = createLoopNativeWorkflow({ store, assertAdmission() {} });
  try {
    await workflow.close();
    expect(() => workflow.reserve({ candidateId: 'missing', expectedLatestAttemptId: null, requestSource: 'user' })).toThrow('loop_native_closed');
    await expect(workflow.advance({ attemptId: 'missing', requestSource: 'user' })).rejects.toThrow('loop_native_closed');
    await expect(workflow.recover({ attemptId: 'missing', requestSource: 'scheduler' })).rejects.toThrow('loop_native_closed');
  } finally { await workflow.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

it('rejects asynchronous admission before the first store reservation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loop-native-admission-'));
  const store = new LoopStore(join(root, 'loop.sqlite'));
  const workflow = createLoopNativeWorkflow({ store, assertAdmission: async () => {} });
  try {
    expect(() => workflow.reserve({ candidateId: 'missing', expectedLatestAttemptId: null, requestSource: 'user' })).toThrow('loop_native_admission_sync');
    expect(store.listLoopNativeAttempts('missing')).toEqual([]);
  } finally { await workflow.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

it('does not evaluate input accessors that could mutate Main admission or original request identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loop-native-accessor-'));
  const store = new LoopStore(join(root, 'loop.sqlite'));
  const workflow = createLoopNativeWorkflow({ store, assertAdmission() {} });
  let reads = 0;
  try {
    await expect(workflow.advance({ get attemptId() { reads++; return 'missing'; }, requestSource: 'user' })).rejects.toThrow();
    expect(reads).toBe(0);
  } finally { await workflow.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
