import type { Command } from 'commander';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../utils/config.js';

/** Explicit host command, never an agent tool or project-discovered action. */
export async function deleteObservationSession(input: { requestSource: 'user' | 'agent' | 'scheduler'; sessionId: string }) {
  if (input.requestSource !== 'user') throw new Error('SOL_PI_DELETE_REQUEST_SOURCE_DENIED');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('SOL_PI_DELETE_PLATFORM_NOT_READY');
  if (typeof input.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input.sessionId)) throw new Error('SOL_PI_DELETE_INVALID_SESSION_ID');
  // Native receipt dependencies must not load on ordinary CLI startup or before the platform gate.
  const [{ FileSessionStore }, { ReferenceDeletionReceiptStore }, { reconcileProductObservationReferences }, { default: Database }] = await Promise.all([
    import('../ai/runtime/session-store/file-store.js'), import('../runtime/sol-pi/reference-lifecycle.js'), import('../runtime/sol-pi/product-bootstrap.js'), import('better-sqlite3'),
  ]);
  const profileRoot = getConfigDir('observation-profile');
  mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(profileRoot).isSymbolicLink() || lstatSync(profileRoot).mode & 0o077) throw new Error('SOL_PI_DELETE_UNSAFE_PROFILE');
  const lockPath = join(profileRoot, '.observation-owner.sqlite');
  for (const candidate of [lockPath, `${lockPath}-journal`, `${lockPath}-wal`, `${lockPath}-shm`]) {
    try { const stat = lstatSync(candidate); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SOL_PI_DELETE_UNSAFE_PROFILE'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let lock: import('better-sqlite3').Database | undefined;
  try { lock = new Database(lockPath, { timeout: 0 }); lock.exec('BEGIN EXCLUSIVE'); }
  catch { lock?.close(); throw new Error('SOL_PI_DELETE_OWNER_ACTIVE_OR_UNAVAILABLE'); }
  // Same SQLite OS lock as ObservationService, held over the complete deletion
  // transaction. Snapshot ownership alone may be missing in historical records.
  try {
    // Root selection is a host identity lookup, not a fallback after a failed
    // canonical deletion. Retained journals select the same root on retry.
    const roots = [getConfigDir('sessions'), getConfigDir('compound-sessions')];
    const present = roots.filter(root => ['', '.deletions', '.migrations'].some(directory => {
      try { lstatSync(join(root, directory, `${input.sessionId}.json`)); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    }));
    if (present.length > 1) throw Error('SOL_PI_DELETE_AMBIGUOUS_SESSION_ROOT');
    const sessionRoot = present[0] ?? roots[0];
    const receipts = new ReferenceDeletionReceiptStore(profileRoot);
    try { await new FileSessionStore(sessionRoot).deleteSession({ ...input, receipts }); }
    finally { receipts.close(); }
  } finally { lock.close(); }
  // Committed deletion remains true if a live authority prevents immediate private
  // reference reconciliation. Pins stay retained until a later host reconciliation.
  let referenceReconciliation: 'complete' | 'pending' = 'complete';
  try { await reconcileProductObservationReferences(profileRoot); }
  catch { referenceReconciliation = 'pending'; }
  return { sessionId: input.sessionId, referenceReconciliation };
}

export function registerObservationCommands(program: Command): void {
  program.command('observation').description('管理显式授权的观察会话')
    .command('delete-session <id>').description('删除已结束的受保护会话，保留防复活记录并解除其归档引用')
    .action(async (id: string) => {
      const result = await deleteObservationSession({ requestSource: 'user', sessionId: id });
      console.log(`会话 ${result.sessionId} 已删除。${result.referenceReconciliation === 'pending' ? '归档引用待后续对账，当前保守保留。' : '归档引用已对账。'}`);
    });
}
