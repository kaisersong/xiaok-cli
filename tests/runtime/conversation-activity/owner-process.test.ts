import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureConversationActivityOwner } from '../../../src/runtime/conversation-activity/owner-launcher.js';
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
