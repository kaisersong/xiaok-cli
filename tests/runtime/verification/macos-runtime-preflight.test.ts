import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotDeploymentPackage } from '../../../src/runtime/verification/deployment-package.js';
import { inspectMacRuntimeLoadTrace, buildMacRuntimeProbe } from '../../../src/runtime/verification/macos-runtime-preflight.js';

describe('frozen runtime launch plan and real dyld trace admission', () => {
  it('rejects unlisted, sibling-prefix and unresolved dylibs; system exceptions are narrow', () => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-preflight-'));
    try {
      mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'lib'));
      writeFileSync(join(root, 'bin', 'qemu-system-aarch64'), 'frozen executable');
      writeFileSync(join(root, 'lib', 'test.dylib'), 'frozen library');
      const inventory = snapshotDeploymentPackage(root);
      const line = (path: string) => 'dyld[123]: <01234567-0000-0000-0000-000000000000> ' + path + '\n';
      const trace = line(join(root, 'bin', 'qemu-system-aarch64')) + line(join(root, 'lib', 'test.dylib')) + line('/usr/lib/libSystem.B.dylib');
      expect(inspectMacRuntimeLoadTrace(root, inventory, trace).length).toBe(3);
      for (const path of [join(root, 'lib', 'injected.dylib'), root + '-other/lib/test.dylib', '/opt/homebrew/lib/test.dylib', '/usr/library/test.dylib']) {
        expect(() => inspectMacRuntimeLoadTrace(root, inventory, trace + line(path))).toThrow('runtime_unfrozen_dependency');
      }
      expect(() => inspectMacRuntimeLoadTrace(root, inventory, '')).toThrow('runtime_load_trace_missing');
      expect(() => inspectMacRuntimeLoadTrace(root, inventory, line('/usr/lib/libSystem.B.dylib'))).toThrow('runtime_executable_not_observed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('builds a fresh fixed child environment with no inherited user launch configuration', () => {
    const plan = buildMacRuntimeProbe('/protected/release', '/protected/state');
    expect(plan.qemu.argv).toEqual(['--version']);
    expect(plan.qemu.env.DYLD_LIBRARY_PATH).toBe('/protected/release/lib');
    expect(plan.qemu.env.DYLD_FALLBACK_LIBRARY_PATH).toBe('/var/empty');
    expect(plan.lima.env.DYLD_LIBRARY_PATH).toBeUndefined();
    expect(plan.lima.env.HOME).toBe('/protected/state');
    expect(Object.isFrozen(plan.qemu.env)).toBe(true);
  });
});
