import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-electron-test' },
  clipboard: { read: vi.fn(), readImage: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';

describe('desktop file content IPC binary handling', () => {
  let rootDir: string;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `xiaok-read-file-content-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    handlers = new Map();

    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const services = {
      getDataRoot: () => join(rootDir, 'data'),
    };

    await registerDesktopIpc(ipcMain as never, window as never, services as never);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns PDF files as application/pdf data URLs instead of UTF-8 text', async () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0xab]);
    const pdfPath = join(rootDir, 'report.pdf');
    writeFileSync(pdfPath, pdfBytes);

    const handler = handlers.get('desktop:readFileContent');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, { filePath: pdfPath })).resolves.toEqual({
      content: `data:application/pdf;base64,${pdfBytes.toString('base64')}`,
    });
  });

  it('decodes base64 data URLs when saving downloaded binary previews', async () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0xab]);
    const savePath = join(rootDir, 'downloaded.pdf');
    const handler = handlers.get('desktop:saveFile');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, {
      filePath: savePath,
      content: `data:application/pdf;base64,${pdfBytes.toString('base64')}`,
    })).resolves.toEqual({ success: true });
    expect(readFileSync(savePath)).toEqual(pdfBytes);
  });
});
