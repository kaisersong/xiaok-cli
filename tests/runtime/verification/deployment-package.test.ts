import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotDeploymentPackage, verifyDeploymentPackage } from '../../../src/runtime/verification/deployment-package.js';

describe('deployment package byte census (not OS authority)', () => {
  function fixture() { const root = mkdtempSync(join(tmpdir(), 'verification-package-')); mkdirSync(join(root, 'bin')); writeFileSync(join(root, 'bin', 'controller.cjs'), 'module.exports = 1;'); return root; }
  it('freezes the complete inventory and rejects changed or extra installed bytes', () => {
    const root = fixture();
    try {
      const snapshot = snapshotDeploymentPackage(root);
      expect(Object.isFrozen(snapshot.files)).toBe(true);
      expect(verifyDeploymentPackage(root, snapshot)).toBeUndefined();
      writeFileSync(join(root, 'bin', 'controller.cjs'), 'module.exports = 2;');
      expect(() => verifyDeploymentPackage(root, snapshot)).toThrow('deployment_package_changed');
      writeFileSync(join(root, 'bin', 'controller.cjs'), 'module.exports = 1;');
      writeFileSync(join(root, 'unexpected.cjs'), 'bad');
      expect(() => verifyDeploymentPackage(root, snapshot)).toThrow('deployment_package_changed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects symlinks and multiply linked files instead of trusting an outside dependency', () => {
    const root = fixture();
    try {
      symlinkSync(join(root, 'bin', 'controller.cjs'), join(root, 'alias.cjs'));
      expect(() => snapshotDeploymentPackage(root)).toThrow('deployment_package_link');
      rmSync(join(root, 'alias.cjs'));
      linkSync(join(root, 'bin', 'controller.cjs'), join(root, 'hard.cjs'));
      expect(() => snapshotDeploymentPackage(root)).toThrow('deployment_package_link');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects case-aliases, nonportable names and empty packages', () => {
    const root = fixture();
    try {
      writeFileSync(join(root, 'bad:name'), 'x');
      expect(() => snapshotDeploymentPackage(root)).toThrow('deployment_package_path');
      rmSync(join(root, 'bad:name')); rmSync(join(root, 'bin'), { recursive: true });
      expect(() => snapshotDeploymentPackage(root)).toThrow('deployment_package_empty');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('does not accept a forged package hash or mutable inventory shape', () => {
    const root = fixture();
    try {
      const snapshot = snapshotDeploymentPackage(root);
      expect(() => verifyDeploymentPackage(root, { ...snapshot, packageHash: '0'.repeat(64) })).toThrow('deployment_package_changed');
      expect(() => verifyDeploymentPackage(root, { ...snapshot, unknown: true })).toThrow('deployment_package_manifest');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('includes real C++ library basenames without weakening shell delimiter rejection', () => {
    const root = fixture();
    try {
      writeFileSync(join(root, 'libncurses++w.6.dylib'), 'official bottle fixture');
      const snapshot = snapshotDeploymentPackage(root);
      expect(() => verifyDeploymentPackage(root, snapshot)).not.toThrow();
      writeFileSync(join(root, 'lib$(touch-bad).dylib'), 'bad');
      expect(() => snapshotDeploymentPackage(root)).toThrow('deployment_package_path');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
