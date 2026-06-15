import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  clipboardRead: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  clipboard: { read: electronMocks.clipboardRead },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
    showItemInFolder: vi.fn(),
  },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';

describe('desktop local artifact preview IPC', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-local-artifact-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    electronMocks.openPath.mockReset();
    electronMocks.openPath.mockResolvedValue('');
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // dataRoot-backed stores may keep short-lived handles; cleanup is best-effort.
    }
  });

  async function makeHarness() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const services = {
      getDataRoot: () => join(rootDir, 'data'),
    };

    await registerDesktopIpc(ipcMain as never, window as never, services as never);
    return handlers;
  }

  it('opens an absolute local path through Electron shell', async () => {
    const handlers = await makeHarness();

    await expect(handlers.get('desktop:openLocalPath')?.({}, { filePath: rootDir })).resolves.toEqual({ ok: true });

    expect(electronMocks.openPath).toHaveBeenCalledWith(rootDir);
  });

  it('reads bounded Markdown preview content for a local artifact file', async () => {
    const outputPath = join(rootDir, 'weekly-note.md');
    writeFileSync(outputPath, '# Weekly note\n\nLoop output body', 'utf-8');
    const handlers = await makeHarness();

    await expect(handlers.get('desktop:readLocalArtifactPreview')?.({}, { filePath: outputPath })).resolves.toMatchObject({
      path: outputPath,
      fileName: 'weekly-note.md',
      mimeType: 'text/markdown',
      content: '# Weekly note\n\nLoop output body',
      truncated: false,
    });
  });

  it('rejects relative local artifact preview paths', async () => {
    const handlers = await makeHarness();

    await expect(
      handlers.get('desktop:readLocalArtifactPreview')?.({}, { filePath: 'weekly-note.md' }),
    ).rejects.toThrow('path_must_be_absolute');
  });
});
