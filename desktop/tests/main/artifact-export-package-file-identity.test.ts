import {afterAll, describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const sourceFile = path.resolve(__dirname, '../../electron/artifact-export-package.cjs');
const source = fs.readFileSync(sourceFile, 'utf8');
const actualRequire = createRequire(sourceFile);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-identity-')));
afterAll(() => fs.rmSync(root, {recursive: true, force: true}));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let sequence = 0;
function fixture() {
  const resources = path.join(root, String(++sequence));
  const directory = path.join(resources, 'artifact-export-helper', 'darwin-arm64');
  fs.mkdirSync(directory, {recursive: true});
  // Container metadata only, deliberately never executed or called a Go build.
  const binary = Buffer.alloc(512);
  binary.writeUInt32LE(0xfeedfacf, 0); binary.writeUInt32LE(0x0100000c, 4); binary.writeUInt32LE(2, 12);
  const license = Buffer.from('identity-test-license');
  const hash = 'a'.repeat(64);
  const manifest = {version: 3, target: 'darwin-arm64', filename: 'artifact-export-helper', size: binary.length,
    sha256: sha(binary), license: {size: license.length, sha256: sha(license)},
    sourceHashes: {'go.mod': hash, 'main.go': hash, 'identity_unix.go': hash, 'identity_windows.go': hash},
    toolchainArchive: {filename: 'go1.27.1.darwin-arm64.tar.gz', size: 1, sha256: hash, lockSha256: hash},
    compilerVersion: 'go version go1.27.1 darwin/arm64', compilerSha256: hash,
    arguments: ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', 'artifact-export-helper', '.'], executedOnTarget: false};
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'artifact-export-helper'), binary);
  fs.writeFileSync(path.join(directory, 'GO-LICENSE'), license);
  return {resources, file: path.join(directory, 'manifest.json'), executable: path.join(directory, 'artifact-export-helper')};
}
type Fault = {field?: 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'; at?: number; highInode?: boolean;
  replaceAtProbe?: boolean; primaryUndefined?: boolean; closeFailure?: boolean; zeroProbe?: boolean};
function load(file: string, platform = 'win32', fault: Fault = {}) {
  const openCounts = new Map<number, number>(); let opens = 0, closes = 0;
  const closeSentinel = new Error('identity-close-sentinel');
  const stats = (value: fs.BigIntStats, changes: Record<string, bigint>) => Object.assign(Object.create(Object.getPrototypeOf(value)), value, changes);
  const fdStats = (fd: number) => {
    let value = fs.fstatSync(fd, {bigint: true});
    const count = openCounts.get(fd);
    if (count !== undefined) {
      if (fault.highInode) value = stats(value, {ino: 1n << 60n});
      if (fault.zeroProbe && count === 1) value = stats(value, {dev: 0n});
      if (fault.field && count === fault.at) value = stats(value, {[fault.field]: value[fault.field] + 1n});
      if (fault.replaceAtProbe && count === 1) {
        const bytes = fs.readFileSync(file);
        fs.renameSync(file, file + '.original'); fs.writeFileSync(file, bytes);
      }
    }
    return value;
  };
  const facade = {...fs,
    lstatSync(name: fs.PathLike, options?: {bigint?: boolean}) {
      const value = fs.lstatSync(name, options as {bigint: true});
      if (String(name) === file && options?.bigint) return stats(value, {dev: 0n, ...(fault.highInode ? {ino: 1n << 60n} : {})});
      return value;
    },
    openSync(name: fs.PathLike, flags: string | number, mode?: fs.Mode) {
      const fd = fs.openSync(name, flags, mode);
      if (String(name) === file) openCounts.set(fd, ++opens);
      return fd;
    },
    fstatSync: fdStats,
    readSync(fd: number, ...args: unknown[]) {
      if (fault.primaryUndefined && openCounts.get(fd) === 2) throw undefined;
      return (fs.readSync as Function)(fd, ...args);
    },
    closeSync(fd: number) {
      const count = openCounts.get(fd);
      if (count !== undefined) closes++;
      fs.closeSync(fd); openCounts.delete(fd);
      if (fault.closeFailure && count === 2) throw closeSentinel;
    },
  };
  const module = {exports: {} as {resolveInstalledArtifactExportHelper(resources: string, platform: string, arch: string): string}};
  // Execute exact production module in its own realm. The facade delegates all
  // actual IO; only the measured Windows metadata discrepancy/fault is injected.
  vm.runInNewContext(source, {module, exports: module.exports, Buffer, process: {platform},
    require(name: string) {return name === 'node:fs' ? facade : actualRequire(name);}}, {filename: sourceFile});
  return {run: (resources: string) => module.exports.resolveInstalledArtifactExportHelper(resources, 'darwin', 'arm64'),
    counts: () => ({opens, closes}), closeSentinel};
}

describe('artifact package exact path and descriptor identity', () => {
  it('accepts measured Windows zero path-dev using independent initial and final path witnesses', () => {
    const f = fixture(), loaded = load(f.file);
    expect(loaded.run(f.resources)).toBe(f.executable);
    expect(loaded.counts()).toEqual({opens: 3, closes: 3});
  });
  it.each(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const)('rejects changed actual read descriptor %s', field => {
    const f = fixture(), loaded = load(f.file, 'win32', {field, at: 2, highInode: field === 'ino'});
    expect(() => loaded.run(f.resources)).toThrow(/file changed while opening/);
    expect(loaded.counts().opens).toBe(loaded.counts().closes);
  });
  it.each(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const)('rejects changed final independent path %s', field => {
    const f = fixture(), loaded = load(f.file, 'win32', {field, at: 3, highInode: field === 'ino'});
    expect(() => loaded.run(f.resources)).toThrow(/file changed/);
    expect(loaded.counts().opens).toBe(loaded.counts().closes);
  });
  it('retains exact high BigInt inode for a stable original file', () => {
    const f = fixture(), loaded = load(f.file, 'win32', {highInode: true});
    expect(loaded.run(f.resources)).toBe(f.executable);
  });
  it('rejects real path replacement during initial independent probe', () => {
    const f = fixture(), loaded = load(f.file, 'win32', {replaceAtProbe: true});
    expect(() => loaded.run(f.resources)).toThrow(/file changed/);
    expect(loaded.counts().opens).toBe(loaded.counts().closes);
  });
  it('rejects zero real probe device instead of dropping the volume check', () => {
    const f = fixture(), loaded = load(f.file, 'win32', {zeroProbe: true});
    expect(() => loaded.run(f.resources)).toThrow(/file changed|invalid.*identity/);
  });
  it('does not apply Windows zero-device compatibility to a different platform', () => {
    const f = fixture(), loaded = load(f.file, 'linux');
    expect(() => loaded.run(f.resources)).toThrow(/file changed while opening/);
    expect(loaded.counts()).toEqual({opens: 1, closes: 1});
  });
  it('preserves a thrown undefined first failure and the close failure, closing only once', () => {
    const f = fixture(), loaded = load(f.file, 'win32', {primaryUndefined: true, closeFailure: true});
    let present = false, raw: any;
    try {loaded.run(f.resources);} catch (error) {present = true; raw = error;}
    expect(present).toBe(true);
    expect(raw.errors).toEqual([undefined, loaded.closeSentinel]);
    expect(Object.hasOwn(raw, 'cause')).toBe(true); expect(raw.cause).toBeUndefined();
    expect(loaded.counts()).toEqual({opens: 2, closes: 2});
  });
});
