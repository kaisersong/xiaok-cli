import { createHarnessOptimizationRuntime } from '../../dist/main/desktop/electron/harness-optimization-service.js';
import { acquireHarnessOwnerLock } from '../../dist/main/desktop/electron/harness-optimization-owner-lock.js';
import { HarnessOptimizationLifecycle } from '../../dist/main/desktop/electron/harness-optimization-lifecycle.js';
import { createHash } from 'node:crypto';
const [dataRoot, phase] = process.argv.slice(2);
const digest = text => createHash('sha256').update(text).digest('hex');
const now = Date.UTC(2026, 9, 20, 12);
// Report ready only after this module body has finished (so its locals are no longer GC roots) and a full GC
// has run with deferred Node-API finalizers flushed: the parent's "second process cannot take the live lock"
// check then proves the OS lock survives collection of every dropped reference, not just lucky GC timing.
if (typeof globalThis.gc !== 'function') throw Error('child_requires_expose_gc');
function reportReady(payload) {
  setImmediate(async () => {
    for (let i = 0; i < 2; i++) { globalThis.gc(); await new Promise(resolve => setImmediate(resolve)); }
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  });
}
if (phase === 'initializing') {
  const lock = acquireHarnessOwnerLock(dataRoot);
  const prepared = await new HarnessOptimizationLifecycle(lock).prepare();
  // Deliberately no lasting reference to `lock`: the owner-lock module itself must keep the OS lock held.
  reportReady({ ready: true, ownerId: prepared.witness.ownerId });
  process.stdin.resume();
} else {
  const actor = { requestSource: 'user', principalId: 'local-user' };
  let manifest;
  const host = await createHarnessOptimizationRuntime({ dataRoot, profileId: 'profile', workspaceId: 'workspace',
    authorizeUser: ctx => ctx === actor, manifestLookup: () => manifest, now: () => now });
  globalThis.harnessOptimizationHost = host; // a live owner process retains its runtime, as desktop-services does
  const state = await host.api.read();
  if (state.status !== 'ready') throw Error(state.reason);
  manifest = { id: 'manifest', ownerId: state.ownerId, profileId: 'profile', workspaceId: 'workspace',
    behaviorFingerprint: digest('behavior'), bindingHash: digest('adapter'), executionKind: 'formal-evaluation',
    expiresAt: now + 600000, machineBoundMs: 10000, perRun: { tokens: 5000, requests: 2, timeoutMs: 10000 },
    steps: [{ id: 'a', bodyHash: digest('A'), tokens: 2000, timeoutMs: 3000 }, { id: 'b', bodyHash: digest('B'), tokens: 2000, timeoutMs: 3000 }] };
  const intent = await host.api.issueResearchIntent({ manifestId: 'manifest' }, actor);
  const run = await host.api.startResearch({ manifestId: 'manifest', requestId: intent.requestId }, actor);
  const ticket = await host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
  if (phase === 'marked') await host.driver.send(ticket, () => undefined);
  reportReady({ ready: true, ownerId: state.ownerId, ownerEpoch: state.ownerEpoch, ticket });
  process.stdin.resume();
}
