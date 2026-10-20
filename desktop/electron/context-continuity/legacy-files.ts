import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './store.js';
/** Source paths are constructed from an owner allowlist, never received from renderer. */
export function assertLegacyTaskFilesOwned(dataRoot: string, taskId: string, establishedOwner: boolean): string {
  if (!/^task_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('invalid_argument');
  if (process.platform === 'win32' && !establishedOwner) throw new Error('source_owner_unverified');
  const directory = join(realpathSync(dataRoot), 'tasks');
  const stats: unknown[] = [];
  for (const [path, optional, file] of [[directory, false, false], [join(directory, 'snapshots'), false, false],
    [join(directory, 'snapshots', `${taskId}.json`), false, true], [join(directory, 'snapshots', `${taskId}.journal.jsonl`), true, true]] as const) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (file ? !stat.isFile() : !stat.isDirectory()) || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('not_readable');
      stats.push([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
    } catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') { stats.push(null); continue; } throw error; }
  }
  return digest(stats);
}
