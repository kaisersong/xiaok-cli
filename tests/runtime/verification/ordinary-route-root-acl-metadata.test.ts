import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  spawns: 0, base: false, acl: false, epoch: 1n, inode: 2n, dev: 1n,
  probeError: false, rootReads: 0, raceAt: 0, fsType: 0x1an,
  mode: 0o40755n, uid: 0n, gid: 0n, afterProbe: undefined as undefined | (() => void),
}));
const base = '/Library/Application Support/xiaok-verification';
vi.mock('node:path', async load => {
  const actual = await load<typeof import('node:path')>();
  return { ...actual, ...actual.posix };
});
vi.mock('node:fs', async load => {
  const actual = await load<typeof import('node:fs')>();
  return { ...actual, statfsSync() { return { type: f.fsType }; }, lstatSync(path: string, options?: unknown) {
    if (path === base) {
      if (!f.base) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isDirectory: () => true, isSymbolicLink: () => false };
    }
    if (['/Library/Application Support', '/Library', '/'].includes(String(path))) {
      if (path === '/Library/Application Support' && ++f.rootReads === f.raceAt) f.epoch++;
      return { dev: f.dev, ino: f.inode, uid: f.uid, gid: f.gid, mode: f.mode,
        ctimeNs: f.epoch, isDirectory: () => true, isSymbolicLink: () => false };
    }
    return Reflect.apply(actual.lstatSync, actual, [path, options]);
  } };
});
vi.mock('node:child_process', async load => {
  const actual = await load<typeof import('node:child_process')>();
  return { ...actual, spawnSync(path: string, args: string[], options: unknown) {
    if (path === '/bin/ls' && args[0] === '-lde') {
      f.spawns++; f.afterProbe?.();
      return { status: f.probeError ? 1 : 0, signal: null, stdout: f.acl ? ' 0: user:other allow write\n' : 'safe\n' };
    }
    return Reflect.apply(actual.spawnSync, actual, [path, args, options]);
  } };
});

beforeEach(() => {
  vi.resetModules(); vi.stubGlobal('process', { ...process, platform: 'darwin' });
  Object.assign(f, { spawns: 0, base: false, acl: false, epoch: 1n, inode: 2n, dev: 1n,
    probeError: false, rootReads: 0, raceAt: 0, fsType: 0x1an,
    mode: 0o40755n, uid: 0n, gid: 0n, afterProbe: undefined });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('rechecks absence on every read while unchanged root metadata avoids repeat ACL child processes', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  expect(read().kind).toBe('ordinary');
  expect(read().kind).toBe('ordinary');
  expect(f.spawns).toBe(1);
  f.base = true;
  expect(read().kind).toBe('unavailable');
});

it.each(['epoch', 'inode', 'gid', 'dev'] as const)('invalidates root ACL metadata on %s changes and rejects a new ACL', async field => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  expect(read().kind).toBe('ordinary');
  f[field]++; f.acl = true;
  expect(read().kind).toBe('unavailable');
  expect(f.spawns).toBe(2);
  f.acl = false;
  expect(read().kind).toBe('ordinary');
  expect(f.spawns).toBe(3);
});

it.each(['mode', 'uid'] as const)('denies changed unsafe %s without reusing a prior ACL observation', async field => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  expect(read().kind).toBe('ordinary');
  f[field] = field === 'mode' ? 0o40777n : 501n;
  expect(read().kind).toBe('unavailable');
});

it('rejects ancestor metadata changing during a real ACL probe', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  f.afterProbe = () => { f.epoch++; };
  expect(read().kind).toBe('unavailable');
});

it('rejects installation appearing during the ACL probe', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  f.afterProbe = () => { f.base = true; };
  expect(read().kind).toBe('unavailable');
});

it('keeps each explicit write job\'s own ACL probe', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  const { openWindowsAbsenceJobScope } = await import('../../../src/runtime/verification/windows-installation-absence.js');
  for (let n = 0; n < 2; n++) {
    const job = openWindowsAbsenceJobScope();
    try { expect(read(job).kind).toBe('ordinary'); expect(read(job).kind).toBe('ordinary'); }
    finally { job.close(); }
  }
  expect(f.spawns).toBe(2);
});

it('denies failed ACL probes and does not retain a failed observation', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  expect(read().kind).toBe('ordinary');
  f.epoch++; f.probeError = true;
  expect(read().kind).toBe('unavailable');
  f.probeError = false;
  expect(read().kind).toBe('ordinary');
  expect(f.spawns).toBe(3);
});

it('denies ancestor metadata changing while validating a cache hit', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  expect(read().kind).toBe('ordinary');
  f.raceAt = f.rootReads + 2;
  expect(read().kind).toBe('unavailable');
});

it('uses a real ACL probe on every unsupported-filesystem read', async () => {
  const { readInstalledCurrentProfile: read } = await import('../../../src/runtime/verification/migration-markers.js');
  f.fsType = 0x6969n;
  expect(read().kind).toBe('ordinary');
  expect(read().kind).toBe('ordinary');
  expect(f.spawns).toBe(2);
});
