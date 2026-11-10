import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { projectRuntimeEventToDesktopEvent } from '../../../src/runtime/task-host/event-projection.js';
vi.mock('../../../src/runtime/verification/migration-markers.js', async load => ({ ...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(), readInstalledCurrentProfile: () => ({ kind: 'ordinary' }) }));
const code = 'MODEL_TEXT_REPETITION_DETECTED';
it.each([
  ['mention', new Error(`upstream said ${code}`), false],
  ['retryable ordinary', Object.assign(new Error('ordinary'), { retryable: true }), false],
  ['structured cause', new Error(`model_failed: ${code}`, { cause: Object.assign(new Error('opaque'), { code }) }), true],
] as const)('host and projection classify %s', async (_name, error, repeated) => {
  const root = mkdtempSync(join(tmpdir(), 'repetition-host-'));
  const host = new InProcessTaskRuntimeHost({ materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 }), snapshotStore: new FileTaskSnapshotStore(join(root, 'snapshots')), createTaskId: () => 'task', runner: async () => { throw error; } });
  try {
    await host.createTask({ prompt: 'hello', materials: [] }); await host.drain();
    const expected = { type: 'error', message: error.message, ...(repeated ? { retryable: false, code } : {}) };
    expect((await host.recoverTask('task')).snapshot.events.find(event => event.type === 'error')).toEqual(expected);
    expect(projectRuntimeEventToDesktopEvent({ taskId: 'task', event: { type: 'turn_failed', sessionId: 's', turnId: 't', error } })).toEqual(expected);
  } finally { await host.drain(); rmSync(root, { recursive: true, force: true }); }
});
