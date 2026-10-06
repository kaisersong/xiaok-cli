// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { findLegacyTaskHistory } from '../../electron/legacy-task-history.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';

describe('legacy missing task history', () => {
  it.each(['unique', 'ambiguous', 'foreign', 'running', 'truncated'] as const)('only exposes a unique completed legacy record: %s', async kind => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-legacy-history-'));
    try {
      mkdirSync(join(root, 'snapshots'));
      const prompt = '创建项目, 让10个智能体搞定本月国外主要AI产品动态分析';
      const snapshot = { taskId: 'task_old', sessionId: 'sess_old', prompt,
        status: kind === 'running' ? 'running' : 'completed', events: [], materials: [],
        createdAt: 1, updatedAt: 2, ...(kind === 'foreign' ? { context: { threadId: 'another' } } : {}) };
      writeFileSync(join(root, 'snapshots/task_old.json'), JSON.stringify(snapshot));
      if (kind === 'ambiguous') writeFileSync(join(root, 'snapshots/task_other.json'), JSON.stringify({ ...snapshot, taskId: 'task_other' }));
      const store = new FileTaskSnapshotStore(root);
      const found = await findLegacyTaskHistory({ root, prompt: kind === 'truncated' ? prompt + '…' : prompt,
        read: id => store.recoverTask(id) });
      expect(found?.taskId).toBe(kind === 'unique' ? 'task_old' : undefined);
      expect(await store.recoverTask('task_missing')).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
