// Same unit control runs against the genuine before and post production modules.
// It neither qualifies Main IPC identity nor any native/SDK authority.
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationProjectService } from '../../electron/conversation-project-service.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { createTaskSourceWriterPopulation } from '../../../src/runtime/task-host/task-runtime-host.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

it('does not turn a shared Host non-user proposal into a durable user creation grant', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-source-before-post-'));
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const materials = new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 });
  const population = createTaskSourceWriterPopulation(snapshots);
  const ids: string[] = [];
  const host = population.createHost({ materialRegistry: materials,
    aheGuards: { artifactEvidence: false, recoveryContinuity: false },
    runner: async input => {
      await input.emitRuntimeEvent({ type: 'post_tool_use', sessionId: input.sessionId, turnId: input.taskId,
        toolName: 'create_project', toolUseId: 'proposal', toolInput: {},
        toolResponse: { ok: true, proposal: { kind: 'project_proposal' } } });
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: input.taskId,
        intentId: 'design', stepId: 'proposal', note: '是否确认按此设计创建并启动项目？' });
    },
  });
  cleanup.push(async () => {
    // Cancel only tasks owned by this fixture before the real writer drain.
    for (const id of ids) {
      const snapshot = await host.inspectTask(id);
      if (snapshot && !['completed', 'cancelled', 'failed'].includes(snapshot.status)) {
        await host.cancelTask(id, 'fixture_cleanup');
      }
    }
    await population.close();
    await materials.sealAndDrainInstanceMutations();
    rmSync(root, { recursive: true, force: true });
  });
  const request = vi.fn(async () => Response.json({ ok: true }));
  const service = new ConversationProjectService({ dataRoot: root,
    kswarmService: { request, getDesktopMutationToken: () => 'unit-only-unused-token' },
    readPreviousUserTask: (threadId, taskId) => snapshots.readPreviousUserTask(threadId, taskId),
  });
  const threadId = 'source-unit-thread';
  // Genuine generic Host producer, deliberately outside any Main user ALS.
  const prior = await host.prepareTask({ prompt: '设计一个工作流：资料收集与撰写', materials: [], context: { threadId } });
  ids.push(prior.taskId);
  await host.startTask(prior.taskId);
  await host.drain();
  expect((await host.inspectTask(prior.taskId))?.status).toBe('completed');
  const prompt = '确认';
  const current = await host.prepareTask({ prompt, materials: [], permissionMode: 'auto', context: { threadId } });
  ids.push(current.taskId);
  const actualCurrent = await host.inspectTask(current.taskId);
  if (!actualCurrent) throw Error('actual_current_preparation_missing');
  const authorized = await service.withUserRequest({ prompt, threadId, permissionMode: 'auto' },
    { requestSource: 'user' }, async () => {
      // Compatibility setup only: the old source lacks this real producer.
      // Absence does not fail the test. No source fact or SDK brand is forged.
      const producer = Object.getOwnPropertyDescriptor(ConversationProjectService.prototype, 'recordPreparedUserTask');
      if (producer !== undefined) {
        if (!Object.hasOwn(producer, 'value') || typeof producer.value !== 'function') {
          throw Error('source_fact_producer_not_a_data_method');
        }
        expect(producer.value.call(service, actualCurrent, { requestSource: 'user' })).toBe(true);
      }
      return service.bindPreparedTask({ taskId: current.taskId, prompt, permissionMode: 'auto' }, { requestSource: 'user' });
    });
  expect(authorized).toBe(false);
  expect(service.isAuthorized(current.taskId)).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
