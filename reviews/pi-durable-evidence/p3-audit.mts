import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
const root = await mkdtemp(join(tmpdir(), 'xiaok-pi-durable-audit-'));
try {
  await writeFile(join(root, 'active-task.json'), '{broken');
  const result = await new FileTaskSnapshotStore(root).getActiveTasks();
  console.log(JSON.stringify({ probe: 'malformed_active_index', result, conclusion: 'gap: corrupt active index becomes empty; no store protocol change authorized in this batch' }));
} finally { await rm(root, { recursive: true, force: true }); }
