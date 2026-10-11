import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';

/** Read-only fallback: expose the true identity of a unique legacy record.
 * Never rewrite the missing task, attach a live task, or guess between matches. */
export async function findLegacyTaskHistory(input: {
  root: string; prompt: string; read: (taskId: string) => Promise<TaskSnapshot | null>;
}): Promise<TaskSnapshot | undefined> {
  const normalize = (value: string) => value.trim().replace(/，/g, ',').replace(/\s+/g, ' ');
  const prompt = typeof input.prompt === 'string' ? normalize(input.prompt) : '';
  if (prompt.length < 20 || prompt.length > 500 || /[…]|\.{3}$/.test(prompt)) return undefined;
  const names = await readdir(join(input.root, 'snapshots')).catch(() => []);
  let match: TaskSnapshot | undefined;
  for (const name of names) {
    if (!/^task_[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
    const id = name.slice(0, -5);
    const snapshot = await input.read(id).catch(() => null);
    if (!snapshot || snapshot.taskId !== id || snapshot.context?.threadId
      || snapshot.status !== 'completed' || normalize(snapshot.prompt ?? '') !== prompt) continue;
    if (match) return undefined;
    match = snapshot;
  }
  return match;
}
