import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as actualFs from 'node:fs';
import { createWriteTool } from '../../../src/ai/tools/write.js';

// Ordinary own-temp public tool contract only: no host/SDK, native phase,
// authorization, mutation success, installed profile or physical-release claim.
const io = vi.hoisted(() => ({
  readFileSync: vi.fn<typeof import('node:fs').readFileSync>(),
  writeFileSync: vi.fn<typeof import('node:fs').writeFileSync>(),
  mkdirSync: vi.fn<typeof import('node:fs').mkdirSync>(),
  renameSync: vi.fn<typeof import('node:fs').renameSync>(),
}));
vi.mock('fs', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  io.readFileSync.mockImplementation(real.readFileSync);
  io.writeFileSync.mockImplementation(real.writeFileSync);
  io.mkdirSync.mockImplementation(real.mkdirSync);
  io.renameSync.mockImplementation(real.renameSync);
  return { ...real, ...io };
});

describe('write public precondition shares its existing sandbox guard', () => {
  let root: string;
  let cwd: string;
  beforeAll(() => {
    root = actualFs.mkdtempSync(join(tmpdir(), 'xiaok-write-precondition-'));
    cwd = join(root, 'workspace');
    try {
      actualFs.mkdirSync(cwd);
      actualFs.writeFileSync(join(cwd, 'inside.txt'), 'owned-inside');
      actualFs.writeFileSync(join(root, 'outside.txt'), 'owned-outside');
    } catch (error) {
      actualFs.rmSync(root, { recursive: true, force: true });
      throw error;
    }
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(() => {
    if (root) actualFs.rmSync(root, { recursive: true, force: true });
  });
  const paths = [
    { scenario: 'inside workspace', relative: ['workspace', 'inside.txt'] },
    { scenario: 'outside workspace but inside own temp', relative: ['outside.txt'] },
    { scenario: 'normalized parent segment inside own temp', relative: ['workspace', '..', 'outside.txt'] },
  ];
  function expectNoImportedIo(): void {
    expect(io.readFileSync).not.toHaveBeenCalled();
    expect(io.writeFileSync).not.toHaveBeenCalled();
    expect(io.mkdirSync).not.toHaveBeenCalled();
    expect(io.renameSync).not.toHaveBeenCalled();
  }
  it.each(paths)('denies before precondition file read: $scenario', ({ relative }) => {
    const guard = vi.fn(() => ({ allowed: false, reason: 'owned-fixture-denial' }));
    const tool = createWriteTool({ cwd, allowOutsideCwd: true, outsideCwdGuard: guard });
    const file = join(root, ...relative);
    expect(() => tool.compoundFilePrecondition!({ file_path: file }))
      .toThrow('Path denied by sandbox for write');
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(resolve(file));
    expectNoImportedIo();
  });
  it('retains the exact synchronous guard exception before a precondition read', () => {
    const failure = new Error('owned-guard-failure');
    const guard = vi.fn(() => { throw failure; });
    const tool = createWriteTool({ cwd, allowOutsideCwd: true, outsideCwdGuard: guard });
    let thrown: unknown;
    try { tool.compoundFilePrecondition!({ file_path: join(cwd, 'inside.txt') }); } catch (error) { thrown = error; }
    expect(thrown).toBe(failure);
    expect(guard).toHaveBeenCalledTimes(1);
    expectNoImportedIo();
  });
  it('proves the real read spy observes an allowed own file and actual hash', () => {
    const guard = vi.fn(() => ({ allowed: true }));
    const tool = createWriteTool({ cwd, allowOutsideCwd: true, outsideCwdGuard: guard });
    const file = join(cwd, 'inside.txt');
    expect(tool.compoundFilePrecondition!({ file_path: file })).toEqual({
      filePath: file, beforeHash: createHash('sha256').update('owned-inside').digest('hex'),
    });
    expect(io.readFileSync).toHaveBeenCalledTimes(1);
    expect(io.readFileSync).toHaveBeenCalledWith(file);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(file);
  });
  it('retains an allowed own missing file as a null hash', () => {
    const tool = createWriteTool({ cwd, allowOutsideCwd: true, outsideCwdGuard: () => ({ allowed: true }) });
    const file = join(cwd, 'missing.txt');
    expect(tool.compoundFilePrecondition!({ file_path: file })).toEqual({ filePath: file, beforeHash: null });
    expect(io.readFileSync).toHaveBeenCalledTimes(1);
    expect(io.readFileSync).toHaveBeenCalledWith(file);
  });
  it('preserves non-ENOENT read error identity without a write', () => {
    const failure = Object.assign(new Error('owned-read-failure'), { code: 'EACCES' });
    io.readFileSync.mockImplementationOnce(() => { throw failure; });
    const tool = createWriteTool({ cwd, allowOutsideCwd: true, outsideCwdGuard: () => ({ allowed: true }) });
    let thrown: unknown;
    try { tool.compoundFilePrecondition!({ file_path: join(cwd, 'inside.txt') }); } catch (error) { thrown = error; }
    expect(thrown).toBe(failure);
    expect(io.readFileSync).toHaveBeenCalledTimes(1);
    expect(io.writeFileSync).not.toHaveBeenCalled();
  });
  it.each(paths)('retains the sibling execute denial: $scenario', async ({ relative }) => {
    const guard = vi.fn(() => ({ allowed: false, reason: 'owned-fixture-denial' }));
    const tool = createWriteTool({ cwd, allowOutsideCwd: true, outsideCwdGuard: guard });
    const file = join(root, ...relative);
    await expect(tool.execute({ file_path: file, content: 'must-not-write' }))
      .rejects.toThrow('Path denied by sandbox for write');
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(resolve(file));
    expectNoImportedIo();
  });
});
