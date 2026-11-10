import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, vi } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';

/** Real TaskHost A -> exact ref -> B; only provider output is synthetic. */
export async function contextDerivative() {
  const root = mkdtempSync(join(tmpdir(), 'continuity-derivative-'));
  let refId = '';
  const services = createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'), dataRoot: root,
    kswarmService: { getStatus: () => ({ running: false, port: 0 }), request: async () => new Response('{}'), getDesktopMutationToken: () => 'test' } as never,
    runner: async input => {
      const p = services.continuity.port();
      const summary = input.prompt === 'source' ? 'SOURCE_CANARY' : 'DERIVED_PRIVATE_' + p.service.resolveReference(
        { ...p.actor, requestSource: 'agent', taskId: input.taskId }, { refId }).messages.find(message => message.role === 'assistant')!.text;
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: input.taskId,
        intentId: 'test', stepId: 'test', note: JSON.stringify({ summary, artifacts: [] }) });
    },
  });
  try {
    const p = services.continuity.port(), source = p.service.createConversation(p.actor, { operationId: 'source' }),
      target = p.service.createConversation(p.actor, { operationId: 'target' });
    const a = await services.createTask({ prompt: 'source', materials: [], context: { threadId: source.id } });
    await vi.waitFor(() => expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(a.taskId)).toBeTruthy());
    refId = p.service.createReference(p.actor, { conversationId: source.id, expectedRevision: p.service.getConversation(p.actor, source.id)!.revision, operationId: 'ref' }).refId;
    const grant = p.service.attachReference(p.actor, { refId, targetConversationId: target.id, operationId: 'grant' });
    const b = await services.createTask({ prompt: 'derive', materials: [], context: { threadId: target.id } });
    await vi.waitFor(() => expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(b.taskId)).toBeTruthy());
    return { root, services, taskId: b.taskId, sourceTaskId: a.taskId,
      read: () => services.recoverTask(b.taskId), revoke: () => p.service.revokeGrant(p.actor, grant),
      assertCurrent: () => p.service.assertTaskReadable(b.taskId),
      async close() { await services.disposeMultiAgent(); services.getKnowledgeBaseStore().close(); rmSync(root, { recursive: true, force: true }); },
    };
  } catch (error) { await services.disposeMultiAgent(); services.getKnowledgeBaseStore().close(); rmSync(root, { recursive: true, force: true }); throw error; }
}
