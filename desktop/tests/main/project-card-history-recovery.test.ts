// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationProjectService } from '../../electron/conversation-project-service.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('historical creation ledger overlay', () => {
  it.each(['prompt-mismatch', 'task-mismatch', 'prefix-mismatch', 'failed-event', 'failed-ledger', 'missing-ledger', 'short-event'] as const)('does not restore a card for %s', kind => {
    const root = mkdtempSync(join(tmpdir(), 'card-recovery-'));
    try {
      const service = new ConversationProjectService({ dataRoot: root, kswarmService: { request: async () => { throw Error('must never recreate'); }, getDesktopMutationToken: () => 'test' } });
      const prompt = '创建项目分析模型';
      const result = { ok: kind !== 'failed-ledger', project: { id: 'project', name: 'Project', requirements: 'r'.repeat(20000) }, created: true, projectId: 'project' };
      if (kind !== 'missing-ledger') writeFileSync(join(root, 'conversation-projects', 'task.json'), JSON.stringify({ schemaVersion: 1, taskId: kind === 'task-mismatch' ? 'foreign' : 'task', prompt, result }));
      const raw = JSON.stringify(result).slice(0, 10000);
      const snapshot: TaskSnapshot = { taskId: 'task', sessionId: 'session', status: 'completed', prompt: kind === 'prompt-mismatch' ? '创建另一个项目' : prompt, materials: [], createdAt: 1, updatedAt: 2,
        events: [{ type: 'canvas_tool_result', toolName: 'create_project', toolUseId: 'create', ok: kind !== 'failed-event', response: kind === 'prefix-mismatch' ? 'x'.repeat(10000) : kind === 'short-event' ? raw.slice(0, 9000) : raw, eventId: 'result' }] };
      expect(service.restoreCreationCard(snapshot)).toBe(snapshot);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
