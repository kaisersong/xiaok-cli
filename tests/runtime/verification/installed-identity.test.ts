import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRootProtectedExecutable, assertInstalledControllerIdentity } from '../../../src/runtime/verification/installed-identity.js';
describe('installed identity reads real OS facts rather than a passed flag', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('rejects even read-only files owned by the ordinary user', () => {
    const root = mkdtempSync(join(tmpdir(), 'unqualified-controller-'));
    try {
      const file = join(root, 'executable'); writeFileSync(file, 'not a system runtime'); chmodSync(file, 0o555);
      expect(() => assertRootProtectedExecutable(file)).toThrow('controller_unprotected_path');
      expect(() => assertInstalledControllerIdentity({ serviceUid: process.getuid!(), interactiveUids: [process.getuid!()], executable: file, stateRoot: root })).toThrow('controller_identity_not_separated');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform === 'win32')('can verify an actual OS-owned immutable executable path', () => {
    expect(() => assertRootProtectedExecutable('/usr/bin/true')).not.toThrow();
  });
});
