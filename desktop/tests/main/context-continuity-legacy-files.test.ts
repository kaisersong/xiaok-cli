// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertLegacyTaskFilesOwned } from '../../electron/context-continuity/legacy-files.js';
it('rejects traversal and symlinked private task checkpoints rather than claiming another source', () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-legacy-files-'));
  try {
    mkdirSync(join(root, 'tasks', 'snapshots'), { recursive: true });
    writeFileSync(join(root, 'outside.json'), '{}');
    expect(() => assertLegacyTaskFilesOwned(root, '../outside', true)).toThrow('invalid_argument');
    if (process.platform !== 'win32') {
      symlinkSync(join(root, 'outside.json'), join(root, 'tasks', 'snapshots', 'task_source.json'));
      expect(() => assertLegacyTaskFilesOwned(root, 'task_source', true)).toThrow('not_readable');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
