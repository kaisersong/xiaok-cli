import {
  mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSupportedHostNode,
  checkHostIdentityBeforeSpawn,
  deriveAppBundleRoot,
  HOST_IDENTITY_REHASH_INTERVAL_MS,
  HostRuntimeBlockedError,
  interpreterInputPaths,
  resolveHostNodeIdentity,
  SUPPORTED_HOST_NODE_RANGE,
} from '../../../src/platform/provider-store/host-node-identity.js';

/**
 * Design v58 §4.4 / R54-01 / R54-03 / R55-01. Report ships no Node artifact, so
 * the app's own interpreter must be identity-bound. The two bugs the review caught:
 * the framework entry is a symlink (a no-follow hash would cover only link text),
 * and the V8 snapshot / ICU data are plain files dyld never validates.
 */
describe('host node identity', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** Builds a fake .app that mirrors the real Electron layout, symlink included. */
  function fakeApp(): { appRoot: string; execPath: string; versionsA: string } {
    const dir = mkdtempSync(join(tmpdir(), 'host-node-'));
    dirs.push(dir);
    const appRoot = join(dir, 'Xiaok.app');
    const macOs = join(appRoot, 'Contents', 'MacOS');
    const framework = join(appRoot, 'Contents', 'Frameworks', 'Electron Framework.framework');
    const versionsA = join(framework, 'Versions', 'A');
    mkdirSync(macOs, { recursive: true });
    mkdirSync(join(versionsA, 'Resources'), { recursive: true });
    mkdirSync(join(versionsA, 'Libraries'), { recursive: true });

    const execPath = join(macOs, 'Xiaok');
    writeFileSync(execPath, 'MACHO-EXEC');
    writeFileSync(join(versionsA, 'Electron Framework'), 'MACHO-FRAMEWORK');
    writeFileSync(join(versionsA, 'Resources', 'icudtl.dat'), 'ICU-DATA');
    writeFileSync(join(versionsA, 'Resources', 'v8_context_snapshot.arm64.bin'), 'V8-SNAPSHOT');
    writeFileSync(join(versionsA, 'Libraries', 'libffmpeg.dylib'), 'FFMPEG');
    writeFileSync(join(versionsA, 'Libraries', 'vk_swiftshader_icd.json'), '{"not":"an interpreter input"}');
    // The real framework exposes its binary through Versions/Current.
    symlinkSync('A', join(framework, 'Versions', 'Current'));
    symlinkSync(join('Versions', 'Current', 'Electron Framework'), join(framework, 'Electron Framework'));

    return { appRoot, execPath, versionsA };
  }

  const versions = {
    platform: 'darwin',
    nodeVersion: '22.22.1',
    moduleAbi: '140',
    v8Version: '14.2.231.22-electron.0',
    appVersion: '1.2.3',
  };

  it('derives the app bundle root on macOS and the exe directory elsewhere', () => {
    const { appRoot, execPath } = fakeApp();
    expect(deriveAppBundleRoot(execPath, 'darwin')).toBe(appRoot);
    expect(deriveAppBundleRoot('/opt/xiaok/xiaok.exe', 'win32')).toBe('/opt/xiaok');
    expect(() => deriveAppBundleRoot('/usr/local/bin/node', 'darwin'))
      .toThrow(HostRuntimeBlockedError);
  });

  it('covers the dereferenced framework binary, the V8 snapshot and ICU data', () => {
    const { appRoot, execPath, versionsA } = fakeApp();

    const paths = interpreterInputPaths(execPath, appRoot, 'darwin');

    expect(paths).toContain(join(versionsA, 'Electron Framework'));
    expect(paths).toContain(join(versionsA, 'Resources', 'icudtl.dat'));
    expect(paths).toContain(join(versionsA, 'Resources', 'v8_context_snapshot.arm64.bin'));
    expect(paths).toContain(join(versionsA, 'Libraries', 'libffmpeg.dylib'));
    // A non-dylib manifest is not an interpreter input.
    expect(paths.some((p) => p.endsWith('vk_swiftshader_icd.json'))).toBe(false);
  });

  it('changes the digest when the V8 snapshot is replaced, with no version change', () => {
    const { execPath, versionsA } = fakeApp();
    const before = resolveHostNodeIdentity({ ...versions, execPath });

    writeFileSync(join(versionsA, 'Resources', 'v8_context_snapshot.arm64.bin'), 'V8-SNAPSHOT-TAMPERED');
    const after = resolveHostNodeIdentity({ ...versions, execPath });

    expect(after.nodeVersion).toBe(before.nodeVersion);
    expect(after.moduleAbi).toBe(before.moduleAbi);
    expect(after.digest).not.toBe(before.digest);
  });

  it('changes the digest when icudtl.dat is replaced', () => {
    const { execPath, versionsA } = fakeApp();
    const before = resolveHostNodeIdentity({ ...versions, execPath });

    writeFileSync(join(versionsA, 'Resources', 'icudtl.dat'), 'ICU-TAMPERED');

    expect(resolveHostNodeIdentity({ ...versions, execPath }).digest).not.toBe(before.digest);
  });

  it('changes the digest when the framework binary behind the symlink is replaced', () => {
    const { execPath, versionsA } = fakeApp();
    const before = resolveHostNodeIdentity({ ...versions, execPath });

    writeFileSync(join(versionsA, 'Electron Framework'), 'MACHO-FRAMEWORK-V2');

    expect(resolveHostNodeIdentity({ ...versions, execPath }).digest).not.toBe(before.digest);
  });

  it('is stable when nothing changes', () => {
    const { execPath } = fakeApp();
    expect(resolveHostNodeIdentity({ ...versions, execPath }).digest)
      .toBe(resolveHostNodeIdentity({ ...versions, execPath }).digest);
  });

  it('enforces the supported host node range', () => {
    expect(() => assertSupportedHostNode({ nodeVersion: '22.22.1', moduleAbi: '140' })).not.toThrow();
    expect(() => assertSupportedHostNode({ nodeVersion: '25.0.0', moduleAbi: '140' }))
      .toThrow(/outside the supported range/);
    expect(() => assertSupportedHostNode({ nodeVersion: '20.11.0', moduleAbi: '140' }))
      .toThrow(/outside the supported range/);
    // Plain Node 24 has ABI 137 and must be rejected even inside the range.
    expect(() => assertSupportedHostNode({ nodeVersion: '24.15.0', moduleAbi: '137' }))
      .toThrow(/module ABI 137/);
    expect(SUPPORTED_HOST_NODE_RANGE.moduleAbis).toEqual(['140']);
  });
});

describe('pre-spawn identity gate', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'host-gate-'));
    dirs.push(dir);
    const appRoot = join(dir, 'Xiaok.app');
    const macOs = join(appRoot, 'Contents', 'MacOS');
    const versionsA = join(appRoot, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A');
    mkdirSync(macOs, { recursive: true });
    mkdirSync(join(versionsA, 'Resources'), { recursive: true });
    const execPath = join(macOs, 'Xiaok');
    writeFileSync(execPath, 'EXEC');
    writeFileSync(join(versionsA, 'Electron Framework'), 'FRAMEWORK');
    writeFileSync(join(versionsA, 'Resources', 'icudtl.dat'), 'ICU');
    const versions = {
      platform: 'darwin', nodeVersion: '22.22.1', moduleAbi: '140',
      v8Version: '14.2', appVersion: '1.0.0', execPath,
    };
    return { versions, versionsA, identity: resolveHostNodeIdentity(versions) };
  }

  it('reuses the generation when nothing changed', () => {
    const { versions, identity } = fixture();
    expect(checkHostIdentityBeforeSpawn(identity, 1_000, 1_000, versions)).toEqual({ kind: 'reuse' });
  });

  it('detects a node/ABI/app version change immediately', () => {
    const { versions, identity } = fixture();
    expect(checkHostIdentityBeforeSpawn(identity, 1_000, 1_000, { ...versions, nodeVersion: '24.15.0' }))
      .toEqual({ kind: 'drift', field: 'nodeVersion' });
    expect(checkHostIdentityBeforeSpawn(identity, 1_000, 1_000, { ...versions, moduleAbi: '137' }))
      .toEqual({ kind: 'drift', field: 'moduleAbi' });
    expect(checkHostIdentityBeforeSpawn(identity, 1_000, 1_000, { ...versions, appVersion: '1.0.1' }))
      .toEqual({ kind: 'drift', field: 'appVersion' });
  });

  it('detects a replaced input through metadata without waiting for the rehash window', () => {
    const { versions, versionsA, identity } = fixture();
    writeFileSync(join(versionsA, 'Resources', 'icudtl.dat'), 'ICU-DIFFERENT-LENGTH');

    expect(checkHostIdentityBeforeSpawn(identity, 1_000, 1_000, versions))
      .toEqual({ kind: 'drift', field: 'metadata:icudtl.dat' });
  });

  it('detects a same-size same-mtime content swap once the rehash interval elapses', () => {
    const { versions, versionsA, identity } = fixture();
    const icu = join(versionsA, 'Resources', 'icudtl.dat');

    // Swap the content in place, keeping the byte length identical.
    writeFileSync(icu, 'ICX');
    const swapped = statSync(icu);

    // Model the worst case exactly: metadata (size/mtime/inode) agrees with the
    // frozen entry while the bytes differ, so only a content hash can catch it.
    const frozen = {
      ...identity,
      inputs: identity.inputs.map((entry) => (
        entry.path.endsWith('icudtl.dat')
          ? { ...entry, size: swapped.size, mtimeMs: swapped.mtimeMs, ino: swapped.ino }
          : entry
      )),
    };

    const withinWindow = checkHostIdentityBeforeSpawn(frozen, 1_000, 1_000, versions);
    expect(withinWindow).toEqual({ kind: 'reuse' });

    const afterWindow = checkHostIdentityBeforeSpawn(
      frozen, 1_000 + HOST_IDENTITY_REHASH_INTERVAL_MS, 1_000, versions,
    );
    expect(afterWindow).toEqual({ kind: 'drift', field: 'content:icudtl.dat' });
  });

  it('treats a missing input as drift, never as reuse', () => {
    const { versions, versionsA, identity } = fixture();
    rmSync(join(versionsA, 'Resources', 'icudtl.dat'));

    expect(checkHostIdentityBeforeSpawn(identity, 1_000, 1_000, versions))
      .toEqual({ kind: 'drift', field: 'missing:icudtl.dat' });
  });
});
