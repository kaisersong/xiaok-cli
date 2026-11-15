import { inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createExclusiveWindowsPrivateDirectory } from '../../src/runtime/windows-owner-security.js';

/** Real fixture creation; never relax a production SID/ACL observation. */
export function makePrivateTestTempDir(prefix: string): string {
  if (process.platform !== 'win32') return mkdtempSync(prefix);
  const parent = realpathSync(dirname(prefix));
  if (parent !== realpathSync(tmpdir())) throw new Error('test_private_temp_parent_required');
  const root = join(parent, basename(prefix) + randomUUID());
  createExclusiveWindowsPrivateDirectory(root);
  return realpathSync(root);
}

/** The global TEMP owner physically removes Windows roots after worker exit. */
export function cleanupPrivateTestTempDir(root: string): void {
  if (process.platform === 'win32') {
    const ownerRoot = inject('profileTestTempRoot');
    if (typeof ownerRoot !== 'string' || realpathSync(dirname(root)) !== ownerRoot) {
      throw new Error('test_private_temp_cleanup_owner_required');
    }
    // Its existing global teardown fails unless the actual removal succeeds.
    // This ordinary fixture lifecycle does not assert Native completion.
    return;
  }
  rmSync(root, { recursive: true, force: true });
}
