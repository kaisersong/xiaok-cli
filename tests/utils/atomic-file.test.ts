import { mkdtempSync, readFileSync, rmSync, writeFileSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  writeFileAtomicallySync,
  type AtomicFileOperations,
} from '../../src/utils/atomic-file.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('writeFileAtomicallySync', () => {
  it('replaces an existing file with complete content', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-atomic-file-'));
    roots.push(root);
    const target = join(root, 'state.json');
    writeFileSync(target, '{"value":"old"}', 'utf8');

    writeFileAtomicallySync(target, '{"value":"new"}');

    expect(readFileSync(target, 'utf8')).toBe('{"value":"new"}');
  });

  it('keeps the old target intact when rename fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-atomic-file-'));
    roots.push(root);
    const target = join(root, 'state.json');
    writeFileSync(target, '{"value":"old"}', 'utf8');
    const operations: Partial<AtomicFileOperations> = {
      renameSync: vi.fn(() => {
        throw new Error('rename failed');
      }),
    };

    expect(() =>
      writeFileAtomicallySync(target, '{"value":"new"}', { operations })
    ).toThrow('rename failed');
    expect(readFileSync(target, 'utf8')).toBe('{"value":"old"}');
  });

  it('fsyncs file before rename and directory after rename', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-atomic-file-'));
    roots.push(root);
    const target = join(root, 'state.json');
    const events: string[] = [];
    let nextFd = 10;
    const operations: Partial<AtomicFileOperations> = {
      openSync: vi.fn((path) => {
        events.push(path === root ? 'open-dir' : 'open-file');
        return nextFd++;
      }),
      writeFileSync: vi.fn(() => {
        events.push('write');
      }),
      fsyncSync: vi.fn((fd) => {
        events.push(fd === 10 ? 'fsync-file' : 'fsync-dir');
      }),
      closeSync: vi.fn((fd) => {
        events.push(fd === 10 ? 'close-file' : 'close-dir');
      }),
      renameSync: vi.fn(() => {
        events.push('rename');
      }),
      unlinkSync: vi.fn(),
      mkdirSync: vi.fn(),
    };

    writeFileAtomicallySync(target, '{}', {
      operations,
      platform: 'darwin',
      tempName: 'state.tmp',
    });

    expect(events).toEqual([
      'open-file',
      'write',
      'fsync-file',
      'close-file',
      'rename',
      'open-dir',
      'fsync-dir',
      'close-dir',
    ]);
  });
  it('strict publication propagates an ancestor flush failure after a newly-created directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-atomic-strict-')); roots.push(root);
    const target = join(root, 'new', 'nested', 'state.json'); const opens: string[] = [];
    expect(() => writeFileAtomicallySync(target, '{}', { requireDirectorySync: true, operations: {
      openSync: ((path, flags, mode) => {
        opens.push(String(path));
        if (String(path) === dirname(root)) throw Object.assign(new Error('ancestor directory unsupported'), { code: 'ENOTSUP' });
        return openSync(path, flags, mode);
      }) as typeof openSync,
    } })).toThrow('ancestor directory unsupported');
    expect(opens).toContain(root); expect(opens).toContain(dirname(root));
    expect(readFileSync(target, 'utf8')).toBe('{}');
  });

});
