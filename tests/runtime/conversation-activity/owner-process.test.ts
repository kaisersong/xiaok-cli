import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureConversationActivityOwner } from '../../../src/runtime/conversation-activity/owner-launcher.js';
import { ACTIVITY_OWNER_GENERATION } from '../../../src/runtime/conversation-activity/owner-protocol.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('independent activity process lifecycle', () => {
  it('keeps collecting native durable facts after the producer client exits, with one owner across concurrent attachment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-process-')), sessions = join(root, 'sessions'); mkdirSync(sessions);
    writeFileSync(join(sessions, 'session.json'), JSON.stringify({ schemaVersion: 1, sessionId: 'session', cwd: root, intentDelegation: { ownership: { state: 'owned', ownerInstanceId: 'instance' } }, messages: [] }));
    const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots, materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 }), runner: () => wait });
    const config = { schemaVersion: 1 as const, dataRoot: root, profileId: 'profile', actorId: 'user', identity: { kind: 'cli' as const, path: sessions } };
    let pid: number | undefined, producer: ConversationActivityOwnerClient | undefined, observer: ConversationActivityOwnerClient | undefined;
    try {
      const prepared = await host.prepareTask({ prompt: 'independent observation', materials: [], context: { threadId: 'session' } });
      const snapshot = (await host.recoverTask(prepared.taskId)).snapshot;
      const entryPath = join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-entry.js');
      const clients = await Promise.all([ensureConversationActivityOwner(config, { instanceId: 'instance', entryPath }), ensureConversationActivityOwner(config, { instanceId: 'instance', entryPath })]);
      producer = clients[0]; const status = await producer.request<{ pid: number; ownerEpoch: string }>('status'); pid = status.pid;
      expect(await clients[1].request('status')).toMatchObject(status); clients[1].dispose();
      await producer.request('prepare', { threadId: 'session', operationId: 'operation', creationIdempotencyKey: 'operation' });
      await producer.request('bind', { operationId: 'operation', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: snapshot.sessionId, workId: prepared.taskId });
      await host.startTask(prepared.taskId); producer.dispose();
      release(); await host.drain();
      observer = new ConversationActivityOwnerClient(root, 'user');
      await vi.waitFor(async () => expect(await observer!.request<any>('work', { watchId: 'watch' })).toMatchObject({ projection: { executionState: 'completed' } }), { timeout: 5000 });
      expect((await observer.request<{ pid: number }>('status')).pid).toBe(pid);
      const before = await observer.request<any[]>('list', { threadId: 'session' });
      const firstEpoch = status.ownerEpoch;
      process.kill(pid!, 'SIGKILL');
      await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 5000 });
      const restarted = await ensureConversationActivityOwner(config, { instanceId: 'instance', entryPath });
      const next = await restarted.request<{ pid: number; ownerEpoch: string }>('status'); pid = next.pid;
      expect(next.ownerEpoch).not.toBe(firstEpoch);
      expect(await observer.request('list', { threadId: 'session' })).toEqual(before);
      expect((await observer.request<any[]>('list', { threadId: 'session' })).filter(row => row.kind === 'completed')).toHaveLength(1);
      restarted.dispose();

      await expect(ensureConversationActivityOwner({ ...config, profileId: 'foreign' }, { instanceId: 'instance' })).rejects.toThrow('activity_owner_profile_mismatch');
    } catch (error) {
      const file = join(root, 'activity-owner.log'); if (existsSync(file)) console.error(readFileSync(file, 'utf8').slice(-4096));
      throw error;
    } finally {
      release(); await host.drain(); producer?.dispose(); observer?.dispose();
      if (pid) { process.kill(pid, 'SIGTERM'); await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 5000 }); }
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});

it.skipIf(!['linux', 'darwin'].includes(process.platform)).each(['empty', 'pending', 'completed'] as const)('handles a real legacy owner with %s tasks', async kind => {
  const { spawn } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'activity-legacy-'));
  const config = { schemaVersion: 1 as const, dataRoot: root, profileId: 'profile', actorId: 'user', identity: { kind: 'cli' as const, path: root } };
  const { ConversationActivityStore } = await import('../../../src/runtime/conversation-activity/store.js');
  const store = new ConversationActivityStore(join(root, 'conversation-activity.sqlite'));
  try {
    if (kind !== 'empty') {
      store.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op', origin: { profileId: 'profile', threadId: 'thread', actorId: 'user', workspaceId: root } });
      store.bindWork({ operationId: 'op', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task' });
      if (kind === 'completed') store.ingest('watch', { schemaVersion: 1, eventId: 'done', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '', sourceSequence: 1, transportGeneration: 0, kind: 'completed', receivedAt: Date.now(), evidenceRefs: [] });
    }
  } finally { store.close(); }
  const configPath = join(root, 'activity-owner.config.json');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [join(process.cwd(), '.test-dist/tests/runtime/conversation-activity/fixtures/legacy-owner-entry.js'), configPath], { stdio: 'pipe' });
  let stderr = ''; child.stderr.on('data', data => { stderr += data.toString(); });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let legacy: ConversationActivityOwnerClient | undefined, replacement: ConversationActivityOwnerClient | undefined, nextPid: number | undefined;
  try {
    await vi.waitFor(async () => {
      legacy?.dispose(); legacy = new ConversationActivityOwnerClient(root, 'producer');
      const status = await legacy.request<any>('status');
      expect(status.pid).toBe(child.pid); expect(status.generation).toBeUndefined(); expect(status.ready).toBe(true);
    }, { timeout: 10_000 });
    const { pathToFileURL } = await import('node:url');
    const { retireOutdatedOwner } = await import(pathToFileURL(join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-retire.js')).href);
    replacement = await ensureConversationActivityOwner(config, { retire: retireOutdatedOwner, entryPath: join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-entry.js'), timeoutMs: 10_000 });
    const status = await replacement.request<any>('status'); nextPid = status.pid;
    if (kind === 'pending') {
      expect(nextPid).toBe(child.pid); process.kill(child.pid!, 0); expect(child.signalCode).toBeNull();
      const readonly = new ConversationActivityStore(join(root, 'conversation-activity.sqlite'), { readOnly: true });
      try { expect(readonly.getWatch('watch')).not.toBeNull(); expect(readonly.getProjection('watch')?.executionState).toBe('accepted'); } finally { readonly.close(); }
      nextPid = undefined; return;
    }
    expect(status.generation).toBe(ACTIVITY_OWNER_GENERATION); expect(nextPid).not.toBe(child.pid);
    await exited; expect(child.exitCode).toBe(0);
  } catch (error) { console.error(stderr); throw error; }
  finally {
    legacy?.dispose(); replacement?.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (nextPid && nextPid !== child.pid) { process.kill(nextPid, 'SIGTERM'); await vi.waitFor(() => expect(() => process.kill(nextPid!, 0)).toThrow(), { timeout: 5000 }); }
    await exited; rmSync(root, { recursive: true, force: true });
  }
}, 25_000);

// #26 changed activityOwnerConfigDigest; #23-built owners (generation 2) must take the retire path, not surface activity_owner_config_mismatch.
it.skipIf(!['linux', 'darwin'].includes(process.platform)).each(['empty', 'pending'] as const)('retires or reuses an owner built by the previous generation (%s tasks) without a config mismatch', async kind => {
  expect(ACTIVITY_OWNER_GENERATION).toBeGreaterThan(2);
  const { spawn } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'activity-prevgen-'));
  const config = { schemaVersion: 1 as const, dataRoot: root, profileId: 'profile', actorId: 'user', identity: { kind: 'cli' as const, path: root } };
  const { ConversationActivityStore } = await import('../../../src/runtime/conversation-activity/store.js');
  const store = new ConversationActivityStore(join(root, 'conversation-activity.sqlite'));
  try {
    if (kind === 'pending') {
      store.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op', origin: { profileId: 'profile', threadId: 'thread', actorId: 'user', workspaceId: root } });
      store.bindWork({ operationId: 'op', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task' });
    }
  } finally { store.close(); }
  const configPath = join(root, 'activity-owner.config.json');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [join(process.cwd(), '.test-dist/tests/runtime/conversation-activity/fixtures/previous-generation-owner-entry.js'), configPath], { stdio: 'pipe' });
  let stderr = ''; child.stderr.on('data', data => { stderr += data.toString(); });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let probe: ConversationActivityOwnerClient | undefined, client: ConversationActivityOwnerClient | undefined, nextPid: number | undefined;
  const hints: string[] = [];
  try {
    await vi.waitFor(async () => {
      probe?.dispose(); probe = new ConversationActivityOwnerClient(root, 'producer');
      const status = await probe.request<any>('status');
      expect(status.pid).toBe(child.pid); expect(status.generation).toBe(2); expect(status.ready).toBe(true);
    }, { timeout: 10_000 });
    const { pathToFileURL } = await import('node:url');
    const { retireOutdatedOwner } = await import(pathToFileURL(join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-retire.js')).href);
    client = await ensureConversationActivityOwner(config, { retire: retireOutdatedOwner, onLegacyOwner: outcome => hints.push(outcome),
      entryPath: join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-entry.js'), timeoutMs: 10_000 });
    const status = await client.request<any>('status'); nextPid = status.pid;
    if (kind === 'pending') {
      expect(hints).toEqual(['reused_pending']); expect(nextPid).toBe(child.pid); process.kill(child.pid!, 0); nextPid = undefined; return;
    }
    expect(hints).toEqual(['replaced']);
    expect(status.generation).toBe(ACTIVITY_OWNER_GENERATION); expect(nextPid).not.toBe(child.pid);
    await exited; expect(child.exitCode).toBe(0);
  } catch (error) { console.error(stderr); throw error; }
  finally {
    probe?.dispose(); client?.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (nextPid && nextPid !== child.pid) { process.kill(nextPid, 'SIGTERM'); await vi.waitFor(() => expect(() => process.kill(nextPid!, 0)).toThrow(), { timeout: 5000 }); }
    await exited; rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
