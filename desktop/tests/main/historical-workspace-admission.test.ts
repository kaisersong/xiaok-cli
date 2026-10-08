// @vitest-environment node
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { authorizationFixture, authorizationRequest } from '../fixtures/multi-agent-authorization.js';

import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Source-mode fixture only: map the production's fixed JS URL to an actual
// compiled CPU Worker. Native message/error/exit and host settlement stay real.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); }
});

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function fixture(enabled = true) {
  const f = await authorizationFixture(cleanup, undefined, { restoreHistoricalLaunchWorkspaces: enabled });
  const cwd = join(f.root, 'historical-workspace'); mkdirSync(cwd);
  const binding = { threadId: 'historical-thread', profileId: f.boundary.profileId,
    workspaceId: createHash('sha256').update(cwd).digest('hex'), cwd };
  f.store.registerThread(binding); f.store.initializeWorkspaceAuthorization({ profileId: binding.profileId, workspaceId: binding.workspaceId });
  return { ...f, binding };
}
describe('historical launch workspace admission', () => {
  it('continues an owned historical thread in its original cwd and replays its subscription without changing its binding', async () => {
    const f = await fixture(); await f.services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.5', apiKey: 'fixture-no-network' }); const before = f.store.getThread(f.binding.threadId)!;
    const output = join(f.binding.cwd, 'historical-proof.md'); let round = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      if (++round === 1) { yield { type: 'tool_use', id: 'write-proof', name: 'write', input: { file_path: output, content: 'historical workspace' } }; }
      else { yield { type: 'text', delta: `已完成。文件：[historical-proof.md](${output})`  }; }
      yield { type: 'done' };
    });
    await expect(f.invoke('getMultiAgentSnapshot', { threadId: f.binding.threadId })).resolves.toMatchObject({ threadId: f.binding.threadId });
    await f.invoke('subscribeMultiAgents', { threadId: f.binding.threadId, subscriptionId: 'historical-live', afterSeq: 0 });
    const created = await f.services.createTask({ prompt: 'Write the fixture file.', permissionMode: 'auto', materials: [], context: { threadId: f.binding.threadId } });
    await vi.waitFor(async () => { const task = (await f.services.recoverTask(created.taskId)).snapshot; if (task.status === 'failed') throw new Error(JSON.stringify(task.hostDelivery?.guardFailure ?? task.salvage)); expect(task.status).toBe('completed'); }, { timeout: 10000 });
    expect(existsSync(output)).toBe(true); expect(existsSync(join(f.root, 'historical-proof.md'))).toBe(false); expect(readFileSync(output, 'utf8')).toBe('historical workspace');
    expect(f.sent.some(item => item.channel === 'desktop:multiAgentEvent')).toBe(true);
    f.reload();
    const replay = await f.invoke<{ snapshot: { threadId: string; group: { groupId: string } } }>('subscribeMultiAgents', { threadId: f.binding.threadId, subscriptionId: 'historical-replay', afterSeq: 0 });
    expect(replay.snapshot.threadId).toBe(f.binding.threadId); expect(replay.snapshot.group.groupId).toBeTruthy();
    expect(f.contexts[0]?.cwd).toBe(f.binding.cwd);
    expect(f.store.getThread(f.binding.threadId)).toMatchObject({ profileId: before.profileId, workspaceId: before.workspaceId, cwd: before.cwd });
  }, 20000);
  it('retains strict single-domain behavior without the main opt-in', async () => {
    const f = await fixture(false);
    await expect(f.services.createTask({ prompt: 'must reject', materials: [], context: { threadId: f.binding.threadId } })).rejects.toThrow('workspace_execution_domain_mismatch');
  });
  it('rejects revoked historical authorization even when the current workspace is enabled', async () => {
    const f = await fixture();
    const access = f.boundary.service.createUserAccess({ requestSource: 'user', actorId: `desktop-user:${f.boundary.profileId}`, threadId: f.binding.threadId, profileId: f.boundary.profileId, workspaceId: f.boundary.workspaceId });
    const row = f.store.readWorkspaceAuthorization({ profileId: f.binding.profileId, workspaceId: f.binding.workspaceId })!;
    f.store.compareAndSetWorkspaceAuthorization({ profileId: f.binding.profileId, workspaceId: f.binding.workspaceId, expectedPermissionRevision: row.permissionRevision,
      next: { ...row, permissionRevision: row.permissionRevision + 1, executionAllowed: false, actorId: `desktop-user:${f.binding.profileId}`, lastReceiptJson: JSON.stringify({ requestHash: 'a'.repeat(64), receipt: { operationId: 'source-revoke', state: 'applied', permissionRevision: row.permissionRevision + 1, executionAllowed: false, persistenceState: 'confirmed' } }) } });
    await expect(f.services.createTask({ prompt: 'must reject', materials: [], context: { threadId: f.binding.threadId } })).rejects.toThrow();
    expect(f.contexts).toHaveLength(0);
    expect(() => f.boundary.service.getSnapshot({ access })).toThrow();
  });
  it('still rejects current workspace revocation for historical threads', async () => {
    const f = await fixture(); await f.setAuthorization(authorizationRequest(await f.getAuthorization(), false, 'revoke-current'));
    await expect(f.services.createTask({ prompt: 'must reject', materials: [], context: { threadId: f.binding.threadId } })).rejects.toThrow('permission_revoked');
  });
  it.each(['foreign-profile', 'forged-workspace', 'missing-authorization'] as const)('rejects %s persisted bindings', async kind => {
    const f = await fixture(); const binding = { ...f.binding, threadId: kind,
      ...(kind === 'foreign-profile' ? { profileId: 'foreign' } : kind === 'forged-workspace' ? { workspaceId: 'forged' } : { cwd: join(f.root, 'unknown'), workspaceId: createHash('sha256').update(join(f.root, 'unknown')).digest('hex') }) };
    f.store.registerThread(binding);
    await expect(f.services.createTask({ prompt: 'must reject', materials: [], context: { threadId: kind } })).rejects.toThrow();
    expect(f.contexts).toHaveLength(0);
  });
});
