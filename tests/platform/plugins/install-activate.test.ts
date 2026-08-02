import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  acquirePluginLock,
  pruneManagedVersions,
  prunePluginRuntimeVersions,
  readActivePluginPointer,
  removeActivePluginPointer,
  resolveManagedPlugins,
  switchActivePluginPointer,
  type ActivePluginPointerInput,
} from '../../../src/platform/plugins/install/active-pointer.js';
import { resolveInstallPaths } from '../../../src/platform/plugins/install/source.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

describe('active plugin pointer', () => {
  let root: string;
  let pluginsDir: string;
  let paths: ReturnType<typeof resolveInstallPaths>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-active-pointer-'));
    pluginsDir = join(root, 'plugins');
    paths = resolveInstallPaths(pluginsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedVersion(name: string, digest: string, version = '1.0.0'): ActivePluginPointerInput {
    const versionDir = join(paths.managedDir, name, digest);
    const pluginDir = join(versionDir, 'repo', 'plugins', name);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name, version }), 'utf8');
    return {
      name,
      version,
      digest,
      commit: 'c'.repeat(40),
      versionDir,
      pluginDir,
      registryUrl: 'https://raw.githubusercontent.com/kaisersong/kai-xiaok-plugins/main/registry-v2.json',
      probe: { status: 'verified', outcomes: [{ serverName: 'renderer', status: 'connected', toolCount: 2 }] },
    };
  }

  it('writes the pointer atomically and records install metadata', async () => {
    const input = seedVersion('demo-plugin', DIGEST_A);
    input.pythonRuntimeDir = join(paths.runtimesDir, 'demo-plugin', DIGEST_A);
    mkdirSync(input.pythonRuntimeDir, { recursive: true });

    const { previous } = await switchActivePluginPointer(paths, input);

    expect(previous).toBeNull();
    const pointerFile = join(paths.activeDir, 'demo-plugin.json');
    const raw = JSON.parse(readFileSync(pointerFile, 'utf8')) as Record<string, unknown>;
    expect(raw.pointerVersion).toBe(1);
    expect(raw.digest).toBe(DIGEST_A);
    expect(raw.commit).toBe('c'.repeat(40));
    expect(raw.registryUrl).toContain('registry-v2.json');
    expect(String(raw.installedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Stored relative so the pointer survives a relocated plugins home.
    expect(raw.versionDir).toBe(`.managed/demo-plugin/${DIGEST_A}`);
    expect(raw.pythonRuntimeDir).toBe(`.runtimes/demo-plugin/${DIGEST_A}`);
    expect(readdirSync(paths.activeDir)).toEqual(['demo-plugin.json']);

    const pointer = readActivePluginPointer(paths, 'demo-plugin');
    expect(pointer?.pluginDir).toBe(input.pluginDir);
    expect(pointer?.probe.status).toBe('verified');
    expect(pointer?.pythonRuntimeDir).toBe(input.pythonRuntimeDir);
  });

  it('returns the previous pointer and keeps the previous version directory', async () => {
    const first = seedVersion('demo-plugin', DIGEST_A, '1.0.0');
    await switchActivePluginPointer(paths, first);
    const second = seedVersion('demo-plugin', DIGEST_B, '2.0.0');

    const { previous } = await switchActivePluginPointer(paths, { ...second, previousDigest: DIGEST_A });

    expect(previous?.digest).toBe(DIGEST_A);
    expect(existsSync(first.versionDir)).toBe(true);
    expect(readActivePluginPointer(paths, 'demo-plugin')?.version).toBe('2.0.0');
  });

  it('fails closed on corrupt, mismatched or escaping pointers', async () => {
    const input = seedVersion('demo-plugin', DIGEST_A);
    await switchActivePluginPointer(paths, input);
    const pointerFile = join(paths.activeDir, 'demo-plugin.json');

    writeFileSync(pointerFile, '{not json', 'utf8');
    expect(() => readActivePluginPointer(paths, 'demo-plugin')).toThrow(/pointer/i);

    writeFileSync(pointerFile, JSON.stringify({
      pointerVersion: 1,
      name: 'other-plugin',
      version: '1.0.0',
      digest: DIGEST_A,
      commit: 'c'.repeat(40),
      versionDir: `.managed/demo-plugin/${DIGEST_A}`,
      pluginDir: `.managed/demo-plugin/${DIGEST_A}/repo/plugins/demo-plugin`,
      registryUrl: 'https://example.com/registry-v2.json',
      installedAt: new Date().toISOString(),
      probe: { status: 'verified', outcomes: [] },
    }), 'utf8');
    expect(() => readActivePluginPointer(paths, 'demo-plugin')).toThrow(/name/i);

    writeFileSync(pointerFile, JSON.stringify({
      pointerVersion: 1,
      name: 'demo-plugin',
      version: '1.0.0',
      digest: DIGEST_A,
      commit: 'c'.repeat(40),
      versionDir: '../../../etc',
      pluginDir: '../../../etc/passwd',
      registryUrl: 'https://example.com/registry-v2.json',
      installedAt: new Date().toISOString(),
      probe: { status: 'verified', outcomes: [] },
    }), 'utf8');
    expect(() => readActivePluginPointer(paths, 'demo-plugin')).toThrow(/escape|managed/i);

    writeFileSync(pointerFile, JSON.stringify({
      pointerVersion: 2,
      name: 'demo-plugin',
      version: '1.0.0',
      digest: DIGEST_A,
      commit: 'c'.repeat(40),
      versionDir: `.managed/demo-plugin/${DIGEST_A}`,
      pluginDir: `.managed/demo-plugin/${DIGEST_A}/repo/plugins/demo-plugin`,
      registryUrl: 'https://example.com/registry-v2.json',
      installedAt: new Date().toISOString(),
      probe: { status: 'verified', outcomes: [] },
    }), 'utf8');
    expect(() => readActivePluginPointer(paths, 'demo-plugin')).toThrow(/pointerVersion/i);
  });

  it('treats a pointer to a missing version directory as invalid', async () => {
    const input = seedVersion('demo-plugin', DIGEST_A);
    await switchActivePluginPointer(paths, input);
    rmSync(input.versionDir, { recursive: true, force: true });

    expect(() => readActivePluginPointer(paths, 'demo-plugin')).toThrow(/missing|plugin\.json/i);
    const resolved = resolveManagedPlugins(pluginsDir);
    expect(resolved.entries).toEqual([]);
    expect(resolved.invalid[0]?.name).toBe('demo-plugin');
  });

  it('resolves managed plugins and reports invalid pointers without throwing', async () => {
    await switchActivePluginPointer(paths, seedVersion('demo-plugin', DIGEST_A));
    writeFileSync(join(paths.activeDir, 'broken.json'), '{oops', 'utf8');
    writeFileSync(join(paths.activeDir, 'notes.txt'), 'ignored', 'utf8');

    const resolved = resolveManagedPlugins(pluginsDir);

    expect(resolved.entries.map((entry) => entry.name)).toEqual(['demo-plugin']);
    expect(resolved.invalid.map((entry) => entry.name)).toEqual(['broken']);
  });

  it('removes a pointer on uninstall', async () => {
    await switchActivePluginPointer(paths, seedVersion('demo-plugin', DIGEST_A));

    expect(removeActivePluginPointer(paths, 'demo-plugin')).toBe(true);
    expect(existsSync(join(paths.activeDir, 'demo-plugin.json'))).toBe(false);
    expect(removeActivePluginPointer(paths, 'demo-plugin')).toBe(false);
  });

  it('prunes unreferenced versions while keeping current and previous', () => {
    seedVersion('demo-plugin', DIGEST_A);
    seedVersion('demo-plugin', DIGEST_B);
    const orphan = join(paths.managedDir, 'demo-plugin', 'f'.repeat(64));
    mkdirSync(orphan, { recursive: true });

    const pruned = pruneManagedVersions(paths, 'demo-plugin', [DIGEST_B, DIGEST_A]);

    expect(pruned).toEqual([orphan]);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(paths.managedDir, 'demo-plugin', DIGEST_A))).toBe(true);
    expect(existsSync(join(paths.managedDir, 'demo-plugin', DIGEST_B))).toBe(true);
  });

  it('prunes unreferenced isolated runtimes with the same digest keep-set', () => {
    const current = join(paths.runtimesDir, 'demo-plugin', DIGEST_B);
    const previous = join(paths.runtimesDir, 'demo-plugin', DIGEST_A);
    const orphan = join(paths.runtimesDir, 'demo-plugin', 'f'.repeat(64));
    mkdirSync(current, { recursive: true });
    mkdirSync(previous, { recursive: true });
    mkdirSync(orphan, { recursive: true });

    const pruned = prunePluginRuntimeVersions(paths, 'demo-plugin', [DIGEST_B, DIGEST_A]);

    expect(pruned).toEqual([orphan]);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(current)).toBe(true);
    expect(existsSync(previous)).toBe(true);
  });
});

describe('plugin install lock', () => {
  let root: string;
  let paths: ReturnType<typeof resolveInstallPaths>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-plugin-lock-'));
    paths = resolveInstallPaths(join(root, 'plugins'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('serializes installs of the same plugin name', async () => {
    const lock = await acquirePluginLock(paths, 'demo-plugin');

    await expect(acquirePluginLock(paths, 'demo-plugin')).rejects.toThrow(/in progress|locked/i);

    await lock.release();
    const second = await acquirePluginLock(paths, 'demo-plugin');
    await second.release();
  });

  it('refuses a lock held by a live process and never deletes it', async () => {
    mkdirSync(paths.locksDir, { recursive: true });
    const lockFile = join(paths.locksDir, 'demo-plugin.lock');
    writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      token: 'other',
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }), 'utf8');

    await expect(acquirePluginLock(paths, 'demo-plugin')).rejects.toThrow(/in progress|locked/i);
    expect(existsSync(lockFile)).toBe(true);
  });

  it('refuses an unreadable lock instead of assuming it is stale', async () => {
    mkdirSync(paths.locksDir, { recursive: true });
    const lockFile = join(paths.locksDir, 'demo-plugin.lock');
    writeFileSync(lockFile, 'not json', 'utf8');

    await expect(acquirePluginLock(paths, 'demo-plugin')).rejects.toThrow(/lock/i);
    expect(existsSync(lockFile)).toBe(true);
  });

  it('reclaims a stale lock whose owner process is gone', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']);
    expect(dead.pid).toBeGreaterThan(0);
    mkdirSync(paths.locksDir, { recursive: true });
    const lockFile = join(paths.locksDir, 'demo-plugin.lock');
    writeFileSync(lockFile, JSON.stringify({
      pid: dead.pid,
      token: 'stale',
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }), 'utf8');

    const lock = await acquirePluginLock(paths, 'demo-plugin');
    expect(JSON.parse(readFileSync(lockFile, 'utf8')).pid).toBe(process.pid);
    await lock.release();
  });

  it('does not reclaim a dead-owner lock that is still within the stale window', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']);
    mkdirSync(paths.locksDir, { recursive: true });
    writeFileSync(join(paths.locksDir, 'demo-plugin.lock'), JSON.stringify({
      pid: dead.pid,
      token: 'fresh',
      createdAt: new Date().toISOString(),
    }), 'utf8');

    await expect(acquirePluginLock(paths, 'demo-plugin')).rejects.toThrow(/in progress|locked/i);
  });
});
