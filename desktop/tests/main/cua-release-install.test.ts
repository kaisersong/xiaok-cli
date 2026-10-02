import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parsePinnedReleaseZip, WINDOWS_CUA_RELEASE, renameCuaInstallArtifact } from '../../electron/cua-release-install.js';

function storedZip(name: string, attributes = 0): Buffer {
  const text = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(text.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(text.length, 28); central.writeUInt32LE(attributes >>> 0, 38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + text.length, 12); end.writeUInt32LE(local.length + text.length, 16);
  return Buffer.concat([local, text, central, text, end]);
}

describe('pinned CUA archive boundary', () => {
  it('pins a complete SDK release, not the standalone binary archive', () => {
    expect(WINDOWS_CUA_RELEASE.version).toBe('0.31.0');
    expect(WINDOWS_CUA_RELEASE.sha256).toBe('0c091deff7aa153e69f94c8a19039aaa62f34c9d0c86a23474fe3ea5c3d3b7d1');
    expect(WINDOWS_CUA_RELEASE.files).toContain('cua_driver_sdk.dll');
  });
  it.each(['../evil', '/evil', 'C:/evil', 'root/../evil', 'root\\evil', 'root/file:stream'])('rejects unsafe zip member %s', name => {
    expect(() => parsePinnedReleaseZip(storedZip(name))).toThrow('cua_archive');
  });
  it('rejects symlink entries', () => {
    expect(() => parsePinnedReleaseZip(storedZip('root/link', 0xa1ff << 16))).toThrow('cua_archive');
  });
  it('rejects a truncated archive', () => {
    expect(() => parsePinnedReleaseZip(Buffer.alloc(5))).toThrow('cua_archive');
  });
});

describe('Windows CUA install atomic rename under sharing conflicts', () => {
  it('retries a transient sharing error without deleting or rewriting the staged bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cua-rename-'));
    try {
      const from = join(root, 'staging'), to = join(root, 'release'); await writeFile(from, 'verified bytes');
      const move = vi.fn<typeof rename>().mockRejectedValueOnce(Object.assign(new Error('sharing conflict'), { code: 'EPERM' })).mockImplementation(rename);
      await renameCuaInstallArtifact(from, to, new AbortController().signal, move);
      expect(await readFile(to, 'utf8')).toBe('verified bytes'); expect(move).toHaveBeenCalledTimes(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('does not retry unrelated errors and cancels before another rename', async () => {
    const move = vi.fn<typeof rename>().mockRejectedValue(Object.assign(new Error('invalid target'), { code: 'EINVAL' }));
    await expect(renameCuaInstallArtifact('a', 'b', new AbortController().signal, move)).rejects.toThrow('invalid target'); expect(move).toHaveBeenCalledOnce();
    const controller = new AbortController(); const conflict = vi.fn<typeof rename>().mockImplementation(async () => { controller.abort(); throw Object.assign(new Error('sharing conflict'), { code: 'EPERM' }); });
    await expect(renameCuaInstallArtifact('a', 'b', controller.signal, conflict)).rejects.toThrow(); expect(conflict).toHaveBeenCalledOnce();
  });
});
