// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DesktopTaskObservationStore } from '../../../src/runtime/task-host/protected-observation-store.js';
import { desktopObservationSessionId } from '../../../src/runtime/task-host/protected-observation-reader.js';
import { compileProtectionWorkerEntry } from '../fixtures/desktop-protection-worker-entry.js';

const physical = vi.hoisted(() => ({ entry: '', starts: 0, exits: 0 }));
vi.mock('node:fs', async original => ({ ...await original<typeof fs>(), lstatSync: vi.fn((await original<typeof fs>()).lstatSync) }));
vi.mock('node:worker_threads', async original => {
  const actual = await original<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(file: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const owned = String(file) === source;
      if (owned && !physical.entry) throw Error('production worker compilation required');
      super(owned ? physical.entry : file, options);
      if (owned) { physical.starts++; this.once('exit', () => physical.exits++); }
    }
  } };
});

describe('ordinary protection reads preserve the original reader and Worker contract', () => {
  let compiledRoot = '';
  const roots: string[] = [];
  beforeAll(async () => { const compiled = await compileProtectionWorkerEntry(); compiledRoot = compiled.root; physical.entry = compiled.output; }, 20000);
  beforeEach(async () => {
    physical.starts = 0; physical.exits = 0;
    vi.mocked(fs.lstatSync).mockImplementation((await vi.importActual<typeof fs>('node:fs')).lstatSync);
  });
  afterEach(() => {
    expect(physical.exits).toBe(physical.starts);
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  afterAll(() => { if (compiledRoot) fs.rmSync(compiledRoot, { recursive: true, force: true, maxRetries: 3 }); });
  function fixture() {
    const root = fs.mkdtempSync(join(tmpdir(), 'ordinary-protection-'));
    roots.push(root);
    const canonical = join(root, 'canonical');
    return { root, canonical, store: new DesktopTaskObservationStore(root, canonical) };
  }

  it('returns the exact actual Worker result without starting a Worker when every protection directory is absent', async () => {
    const f = fixture();
    const result = await f.store.readProtectionInWorker('ordinary-task');
    expect(physical.starts).toBe(0);
    for (const directory of [f.canonical, join(f.root, '.canonical-session-aliases'), join(f.root, 'protected-observation-sessions')]) fs.mkdirSync(directory);
    const threaded = await f.store.readProtectionInWorker('ordinary-task');
    expect(result).toStrictEqual(threaded);
    expect(Object.hasOwn(result, 'closure')).toBe(true);
    expect(physical.starts).toBe(1);
  });

  it('does not retain a negative result when a holder marker appears between calls', async () => {
    const f = fixture();
    const a = f.store.readProtectionInWorker('ordinary-task');
    const b = f.store.readProtectionInWorker('ordinary-task');
    expect(a).not.toBe(b); await Promise.all([a, b]); expect(physical.starts).toBe(0);
    const directory = join(f.root, '.canonical-session-aliases'); fs.mkdirSync(directory);
    const name = createHash('sha256').update('ordinary-task').digest('hex') + '.json';
    fs.writeFileSync(join(directory, name), '{}');
    await expect(f.store.readProtectionInWorker('ordinary-task')).rejects.toMatchObject({ code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    expect(physical.starts).toBe(1);
  });

  it.each(['canonical', '.canonical-session-aliases', 'protected-observation-sessions'])('keeps the actual Worker and physical exit when %s exists, even if empty', async directory => {
    const f = fixture(); fs.mkdirSync(join(f.root, directory));
    expect(await f.store.readProtectionInWorker('ordinary-task')).toStrictEqual({ closure: undefined });
    expect(physical.starts).toBe(1); expect(physical.exits).toBe(1);
  });

  it.each(['canonical', '.canonical-session-aliases', 'protected-observation-sessions'].flatMap(directory => ['EACCES', 'EIO', 'ENOTDIR', 'ELOOP'].map(code => ({ directory, code }))))('does not interpret $code at $directory as an absent directory', async ({ directory, code }) => {
    const f = fixture(); const actual = (await vi.importActual<typeof fs>('node:fs')).lstatSync;
    vi.mocked(fs.lstatSync).mockImplementation(((file: fs.PathLike, ...args: unknown[]) => {
      if (String(file) === join(f.root, directory)) throw Object.assign(Error('metadata unavailable'), { code });
      return (actual as (...args: unknown[]) => fs.Stats)(file, ...args);
    }) as typeof fs.lstatSync);
    await f.store.readProtectionInWorker('ordinary-task');
    expect(physical.starts).toBe(1);
  });

  it('uses the same fresh checks with the default canonical root from the selected config directory', async () => {
    const f = fixture(); const previous = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = f.root;
    try {
      const store = new DesktopTaskObservationStore(f.root);
      expect(await store.readProtectionInWorker('ordinary-task')).toStrictEqual({ closure: undefined });
      expect(physical.starts).toBe(0);
      fs.mkdirSync(join(f.root, 'compound-sessions'));
      expect(await store.readProtectionInWorker('ordinary-task')).toStrictEqual({ closure: undefined });
      expect(physical.starts).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
      else process.env.XIAOK_CONFIG_DIR = previous;
    }
  });

  it('retains rejection of a canonical sentinel whose inventory is missing', async () => {
    const f = fixture(); fs.mkdirSync(f.canonical); fs.writeFileSync(join(f.canonical, '.session-aliases-enabled'), '1');
    await expect(f.store.readProtectionInWorker('ordinary-task')).rejects.toMatchObject({ code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    expect(physical.starts).toBe(1);
  });

  it('retains rejection of damaged local protected history', async () => {
    const f = fixture(); const directory = join(f.root, 'protected-observation-sessions'); fs.mkdirSync(directory);
    fs.writeFileSync(join(directory, desktopObservationSessionId('ordinary-task') + '.json'), '{');
    await expect(f.store.readProtectionInWorker('ordinary-task')).rejects.toMatchObject({ code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    expect(physical.starts).toBe(1);
  });

  it.skipIf(process.platform === 'win32')('does not shortcut an existing dangling symlink', async () => {
    const f = fixture(); fs.symlinkSync(join(f.root, 'absent-target'), f.canonical, 'dir');
    await f.store.readProtectionInWorker('ordinary-task'); expect(physical.starts).toBe(1);
  });

  it('preserves asynchronous invalid-task rejection and its error code', async () => {
    const f = fixture(); let pending!: ReturnType<typeof f.store.readProtectionInWorker>;
    expect(() => { pending = f.store.readProtectionInWorker(''); }).not.toThrow();
    await expect(pending).rejects.toMatchObject({ code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    expect(physical.starts).toBe(0);
  });
});
