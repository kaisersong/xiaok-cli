import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  clipboardRead: vi.fn(),
  clipboardReadImage: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-electron-test' },
  clipboard: {
    read: electronMocks.clipboardRead,
    readImage: electronMocks.clipboardReadImage,
  },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
  },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';
import { LoopStore } from '../../electron/loop-store.js';

describe('desktop loop output action IPC', () => {
  let rootDir: string;
  let loopStore: LoopStore;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `xiaok-loop-output-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    loopStore = new LoopStore(join(rootDir, 'loops.sqlite'));
    handlers = new Map();
    electronMocks.openPath.mockReset();
    electronMocks.openPath.mockResolvedValue('');

    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const services = {
      getDataRoot: () => join(rootDir, 'data'),
    };
    const loopRuntime = {
      loopStore,
      scanner: {},
      runner: { runLoopNow: vi.fn() },
      listAnomalies: vi.fn(() => []),
    };

    await registerDesktopIpc(ipcMain as never, window as never, services as never, { loopRuntime } as never);
  });

  afterEach(() => {
    try {
      loopStore.close();
    } catch {
      // already closed
    }
    rmSync(rootDir, { recursive: true, force: true });
  });

  function createLoop(outputDirectory = join(rootDir, 'outputs')) {
    return loopStore.createUserLoopTemplate({
      loopId: 'user-loop-1',
      title: 'Weekly Briefing',
      kind: 'markdown_file',
      prompt: 'Write a briefing.',
      outputDirectory,
      outputFileName: 'briefing.md',
      now: 1_000,
    });
  }

  it('opens a loop output directory by loopId and creates the directory when missing', async () => {
    const { template } = createLoop();

    const handler = handlers.get('desktop:loops:openOutputDirectory');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, 'user-loop-1')).resolves.toEqual({
      ok: true,
      loopId: 'user-loop-1',
      pathLabel: template.outputDirectory,
    });
    expect(electronMocks.openPath).toHaveBeenCalledWith(template.outputDirectory);
  });

  it('returns a bounded text preview for the exact loop output file', async () => {
    const { template } = createLoop();
    mkdirSync(template.outputDirectory, { recursive: true });
    writeFileSync(join(template.outputDirectory, template.outputFileName), '# Weekly Briefing\n\nReady.\n', 'utf8');

    const handler = handlers.get('desktop:loops:readOutputPreview');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, 'user-loop-1')).resolves.toEqual({
      ok: true,
      loopId: 'user-loop-1',
      pathLabel: join(template.outputDirectory, template.outputFileName),
      content: '# Weekly Briefing\n\nReady.\n',
      sizeBytes: 26,
      truncated: false,
    });
  });

  it('returns structured preview errors for missing, oversized, and binary output files', async () => {
    const { template } = createLoop();
    const handler = handlers.get('desktop:loops:readOutputPreview');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, 'user-loop-1')).resolves.toMatchObject({
      ok: false,
      error: 'missing_output_file',
      loopId: 'user-loop-1',
    });

    mkdirSync(template.outputDirectory, { recursive: true });
    writeFileSync(join(template.outputDirectory, template.outputFileName), Buffer.alloc((256 * 1024) + 1, 'a'));
    await expect(handler?.({}, 'user-loop-1')).resolves.toMatchObject({
      ok: false,
      error: 'output_file_too_large',
      loopId: 'user-loop-1',
    });

    writeFileSync(join(template.outputDirectory, template.outputFileName), Buffer.from([0x23, 0x20, 0x41, 0x00, 0x42]));
    await expect(handler?.({}, 'user-loop-1')).resolves.toMatchObject({
      ok: false,
      error: 'output_file_binary',
      loopId: 'user-loop-1',
    });
  });

  it('rejects legacy output file names that are unsafe on Windows before previewing paths', async () => {
    createLoop();
    const db = (loopStore as unknown as {
      db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } };
    }).db;
    db.prepare('update user_loop_templates set output_file_name = ? where loop_id = ?').run('CON.md', 'user-loop-1');

    const handler = handlers.get('desktop:loops:readOutputPreview');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, 'user-loop-1')).resolves.toMatchObject({
      ok: false,
      error: 'output_file_name_invalid',
      loopId: 'user-loop-1',
      pathLabel: 'CON.md',
    });
  });
});
