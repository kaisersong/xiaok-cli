// @vitest-environment node
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HarnessOptimizationLifecycle, type HarnessCloseIntent } from '../../electron/harness-optimization-lifecycle.js';
import type { HarnessOwnerLock } from '../../electron/harness-optimization-owner-lock.js';

// The owner lock is darwin-only and production never reaches this lifecycle on Windows;
// syncDirectory opens a directory handle, which is POSIX-only behaviour.
describe.skipIf(process.platform === 'win32')('HarnessOptimizationLifecycle journal recovery', () => {
  let root: string;
  let lifecycle: HarnessOptimizationLifecycle;
  let intent: HarnessCloseIntent;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'harness-lifecycle-')));
    lifecycle = new HarnessOptimizationLifecycle({
      root, identity: 'test:1', held: () => true, release() {},
    } as unknown as HarnessOwnerLock);
    intent = { ownerId: randomUUID(), operationId: randomUUID(), scope: 'all',
      disable: true, ownerEpoch: 1, knownSends: ['send:1'] };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  const journalPath = (lifecycle: HarnessOptimizationLifecycle, intent: HarnessCloseIntent) =>
    join(lifecycle.journalDir, `${intent.operationId}.json`);

  it('keeps a repeated identical intent in exactly one journal', async () => {
    await lifecycle.writeJournal(intent);
    const rename = vi.spyOn(fs, 'rename');
    await lifecycle.writeJournal(intent);
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readdir(lifecycle.journalDir)).toEqual([`${intent.operationId}.json`]);
    expect(await fs.readFile(journalPath(lifecycle, intent), 'utf8')).toBe(`${JSON.stringify(intent)}\n`);
    expect(await lifecycle.journals()).toEqual([intent]);
  });

  it('atomically replaces a changed intent without opening the existing journal for truncation', async () => {
    await lifecycle.writeJournal(intent);
    const open = vi.spyOn(fs, 'open');
    const rename = vi.spyOn(fs, 'rename');
    const changed = { ...intent, knownSends: ['send:1', 'send:2'] };
    await lifecycle.writeJournal(changed);
    expect(open.mock.calls.some(([, flags]) => flags === 'r+')).toBe(false);
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.json\.[a-f0-9-]{36}\.tmp$/), journalPath(lifecycle, intent));
    expect(await fs.readFile(journalPath(lifecycle, intent), 'utf8')).toBe(`${JSON.stringify(changed)}\n`);
    expect(await lifecycle.journals()).toEqual([changed]);
  });

  it('removes and ignores a crashed pre-rename temporary file', async () => {
    await lifecycle.writeJournal(intent);
    const temporary = join(lifecycle.journalDir, `${intent.operationId}.json.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, '{"operationId":');
    expect(await lifecycle.journals()).toEqual([intent]);
    await expect(fs.stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('maps a corrupt journal to journal_invalid', async () => {
    await lifecycle.writeJournal(intent);
    await fs.writeFile(journalPath(lifecycle, intent), '{"operationId":');
    await expect(lifecycle.journals()).rejects.toThrow('journal_invalid');
  });

  it('maps a corrupt witness to owner_witness_invalid', async () => {
    await fs.writeFile(lifecycle.witnessPath, '{"ownerId":');
    await expect(lifecycle.prepare()).rejects.toThrow('owner_witness_invalid');
  });

  it('rejects unexpected filenames', async () => {
    await lifecycle.writeJournal(intent);
    await fs.writeFile(join(lifecycle.journalDir, 'notes.txt'), 'notes');
    await expect(lifecycle.journals()).rejects.toThrow('journal_invalid');
  });
});
