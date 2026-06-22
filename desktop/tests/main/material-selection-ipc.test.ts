import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  clipboardRead: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-electron-test' },
  clipboard: { read: electronMocks.clipboardRead },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
    showItemInFolder: electronMocks.showItemInFolder,
  },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';

describe('desktop material selection IPC', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-material-selection-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    electronMocks.showOpenDialog.mockReset();
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Registering IPC initializes dataRoot-backed desktop stores that can keep
      // short-lived file handles open on Windows. The assertion is independent
      // from temp-dir cleanup.
    }
  });

  it('opens a file-only multi-select dialog for new task attachments', async () => {
    const filePath = join(rootDir, 'brief.md');
    writeFileSync(filePath, '# Brief\n', 'utf-8');
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] });

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const services = {
      getDataRoot: () => join(rootDir, 'data'),
    };

    await registerDesktopIpc(ipcMain as never, window as never, services as never);

    await expect(handlers.get('desktop:selectMaterials')?.({})).resolves.toEqual({ filePaths: [filePath] });
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith(window, {
      properties: ['openFile', 'multiSelections'],
    });
    expect(electronMocks.showOpenDialog.mock.calls[0]?.[1]?.properties).not.toContain('openDirectory');
  });
});
