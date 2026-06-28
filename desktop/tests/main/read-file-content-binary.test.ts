import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { electronMocks } = vi.hoisted(() => ({
  electronMocks: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-electron-test' },
  clipboard: { read: vi.fn(), readImage: vi.fn() },
  dialog: { showOpenDialog: electronMocks.showOpenDialog, showSaveDialog: electronMocks.showSaveDialog },
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
    electronMocks.showOpenDialog.mockReset();
    electronMocks.showSaveDialog.mockReset();
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

  it('selects a local image for HTML edit as a data URL', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const imagePath = join(rootDir, 'chart.png');
    writeFileSync(imagePath, pngBytes);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [imagePath] });

    const handler = handlers.get('desktop:selectHtmlEditMedia');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, { kind: 'image' })).resolves.toEqual({
      canceled: false,
      filePath: imagePath,
      content: `data:image/png;base64,${pngBytes.toString('base64')}`,
    });
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      properties: ['openFile'],
      filters: expect.arrayContaining([
        expect.objectContaining({ name: 'Images' }),
      ]),
    }));
  });

  it('selects a local SVG for HTML edit as source text', async () => {
    const svgSource = '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>';
    const svgPath = join(rootDir, 'icon.svg');
    writeFileSync(svgPath, svgSource);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [svgPath] });

    const handler = handlers.get('desktop:selectHtmlEditMedia');

    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, { kind: 'svg' })).resolves.toEqual({
      canceled: false,
      filePath: svgPath,
      content: svgSource,
    });
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      properties: ['openFile'],
      filters: expect.arrayContaining([
        expect.objectContaining({ name: 'SVG' }),
      ]),
    }));
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

  it('allows html-edit saves under the desktop data root', async () => {
    const artifactsDir = join(rootDir, 'data', 'tasks');
    mkdirSync(artifactsDir, { recursive: true });
    const savePath = join(artifactsDir, 'report.html');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: '<html><body>edited</body></html>',
      purpose: 'html-edit',
    })).resolves.toEqual({ success: true });
    expect(readFileSync(savePath, 'utf8')).toContain('edited');
  });

  it('allows html-edit saves under the Electron downloads directory', async () => {
    const downloadsDir = '/tmp/xiaok-electron-test';
    mkdirSync(downloadsDir, { recursive: true });
    const savePath = join(downloadsDir, 'report.html');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: '<html><body>edited in downloads</body></html>',
      purpose: 'html-edit',
    })).resolves.toEqual({ success: true });
    expect(readFileSync(savePath, 'utf8')).toContain('edited in downloads');
  });

  it('rejects html-edit saves outside artifact roots', async () => {
    const savePath = join(rootDir, 'outside.html');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: '<html><body>edited</body></html>',
      purpose: 'html-edit',
    })).resolves.toEqual({ success: false, error: 'html_edit_path_not_allowed' });
  });

  it('rejects html-edit saves for non-html files', async () => {
    const artifactsDir = join(rootDir, 'data', 'tasks');
    mkdirSync(artifactsDir, { recursive: true });
    const savePath = join(artifactsDir, 'report.txt');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: 'edited',
      purpose: 'html-edit',
    })).resolves.toEqual({ success: false, error: 'html_edit_invalid_extension' });
  });

  it('allows text-edit saves for Markdown under the desktop data root', async () => {
    const artifactsDir = join(rootDir, 'data', 'tasks');
    mkdirSync(artifactsDir, { recursive: true });
    const savePath = join(artifactsDir, 'notes.md');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: '# Edited\n',
      purpose: 'text-edit',
    })).resolves.toEqual({ success: true });
    expect(readFileSync(savePath, 'utf8')).toBe('# Edited\n');
  });

  it('rejects text-edit saves outside artifact roots', async () => {
    const savePath = join(rootDir, 'outside.md');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: '# Edited\n',
      purpose: 'text-edit',
    })).resolves.toEqual({ success: false, error: 'text_edit_path_not_allowed' });
  });

  it('rejects text-edit saves for non-Markdown files', async () => {
    const artifactsDir = join(rootDir, 'data', 'tasks');
    mkdirSync(artifactsDir, { recursive: true });
    const savePath = join(artifactsDir, 'report.html');
    const handler = handlers.get('desktop:saveFile');

    await expect(handler?.({}, {
      filePath: savePath,
      content: '<html><body>wrong editor</body></html>',
      purpose: 'text-edit',
    })).resolves.toEqual({ success: false, error: 'text_edit_invalid_extension' });
  });
});
