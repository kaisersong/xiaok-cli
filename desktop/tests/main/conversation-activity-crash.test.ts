// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

const moduleUrl = new URL('../../../dist/runtime/conversation-activity/store.js', import.meta.url).href;
const event = { schemaVersion: 1, eventId: 'done', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch',
  workId: 'task', runId: '', transportGeneration: 0, sourceSequence: 1, kind: 'completed', receivedAt: 100, evidenceRefs: [] };

async function killAtBoundary(file: string, beforeCommit: boolean): Promise<void> {
  const code = `import { ConversationActivityStore } from ${JSON.stringify(moduleUrl)};
    const store = new ConversationActivityStore(process.env.ACTIVITY_CRASH_DB);
    store.prepareAssociation({operationId:'op',creationIdempotencyKey:'key',origin:{profileId:'profile',threadId:'thread',workspaceId:'workspace',actorId:'user'}});
    store.bindWork({operationId:'op',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'epoch',workId:'task',runId:''});
    if (${beforeCommit}) {
      store.db.function('hold_commit', () => { process.stdout.write('boundary\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); return 0; });
      store.db.exec("CREATE TRIGGER hold_cursor BEFORE INSERT ON source_cursors BEGIN SELECT hold_commit(); END");
    }
    store.ingest('watch',${JSON.stringify(event)});
    process.stdout.write('boundary\\n');
    setInterval(() => {},1000);`;
  const child: ChildProcess = spawn(process.execPath, ['--input-type=module', '--eval', code], {
    env: { ...process.env, ACTIVITY_CRASH_DB: file }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  child.stderr!.on('data', data => { stderr += String(data); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`crash boundary not reached: ${stderr}`)), 5000);
      let output = '';
      child.stdout!.on('data', data => { output += String(data); if (output.includes('boundary\n')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`crash fixture exited ${code}: ${stderr}`)); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }
}

describe('real process crash recovery', () => {
  it.each([true, false])('releases the OS owner and atomically recovers at beforeCommit=%s', async beforeCommit => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-activity-crash-'));
    const file = join(root, 'activity.sqlite');
    let store: ConversationActivityStore | undefined;
    try {
      await killAtBoundary(file, beforeCommit);
      const connection = new DatabaseSync(file);
      connection.exec('DROP TRIGGER IF EXISTS hold_cursor'); connection.close();
      store = new ConversationActivityStore(file);
      expect(store.getProjection('watch')!.sourceSequence).toBe(beforeCommit ? 0 : 1);
      expect(store.getDiagnostics().sourceEvents).toBe(beforeCommit ? 0 : 1);
      const result = store.ingest('watch', event);
      expect(result.acknowledge).toBe(true);
      expect(Boolean(result.duplicate)).toBe(!beforeCommit);
      expect(store.getProjection('watch')!.executionState).toBe('completed');
      expect(store.listActivities('profile', 'thread')).toHaveLength(2);
    } finally { store?.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
});
