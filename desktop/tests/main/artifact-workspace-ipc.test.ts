import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({ windows: [] as Array<{
  id: number;
  isDestroyed(): boolean;
  webContents: { id: number; send: ReturnType<typeof vi.fn> };
  once(event: string, listener: () => void): void;
}> }));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/xiaok-electron-test' },
  BrowserWindow: {
    getAllWindows: () => electronState.windows,
    fromWebContents: (sender: unknown) => electronState.windows.find((window) => window.webContents === sender),
  },
  clipboard: { read: vi.fn(), readImage: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  systemPreferences: { askForMediaAccess: vi.fn(), getMediaAccessStatus: vi.fn() },
}));

import { registerDesktopIpc } from '../../electron/ipc.js';

function createWindow(id: number) {
  const listeners = new Map<string, () => void>();
  return {
    id,
    isDestroyed: () => false,
    webContents: { id: id * 100, send: vi.fn() },
    once(event: string, listener: () => void) { listeners.set(event, listener); },
    close() { listeners.get('closed')?.(); },
  };
}

function minimalSnapshot(conversationId: string) {
  return {
    workspace: {
      id: `workspace-${conversationId}`,
      conversationId,
      workspaceRootId: 'desktop-artifact-workspace-v1',
      schemaVersion: 1,
      structureRevision: 0,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    access: { revision: 'write', spatial: 'enabled' },
    nodes: [],
    relations: [],
    lineages: [],
    versions: [],
    generationRequests: [],
    staging: [],
  };
}

describe('artifact workspace IPC multi-window ownership', () => {
  beforeEach(() => {
    electronState.windows = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives a stable view key from each sender, broadcasts changes, and closes owned sessions', async () => {
    const primary = createWindow(1);
    const secondary = createWindow(2);
    electronState.windows = [primary, secondary];
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle(channel: string, handler: (...args: unknown[]) => unknown) { handlers.set(channel, handler); },
    };
    const getSnapshot = vi.fn((input: Record<string, unknown>, _viewKey?: string) => minimalSnapshot(String(input.conversationId)));
    const saveViewport = vi.fn((input: Record<string, unknown>, _viewKey?: string) => minimalSnapshot(String(input.conversationId)));
    const closeWorkspace = vi.fn((_input: Record<string, unknown>, _viewKey?: string) => ({ closed: true }));
    const closeViewKey = vi.fn();
    const unsubscribe = vi.fn();
    let changeListener: ((change: { conversationId: string; workspaceId: string }) => void) | undefined;
    const services = {
      getDataRoot: () => '/tmp/xiaok-electron-test',
      getArtifactWorkspaceSnapshot: getSnapshot,
      saveArtifactWorkspaceViewport: saveViewport,
      closeArtifactWorkspace: closeWorkspace,
      closeArtifactWorkspaceViewKey: closeViewKey,
      subscribeArtifactWorkspaceChanges(listener: typeof changeListener) {
        changeListener = listener;
        return unsubscribe;
      },
    };

    await registerDesktopIpc(ipcMain as never, primary as never, services as never);
    const getHandler = handlers.get('desktop:artifactWorkspace:getArtifactWorkspaceSnapshot');
    const viewportHandler = handlers.get('desktop:artifactWorkspace:saveArtifactWorkspaceViewport');
    const closeHandler = handlers.get('desktop:artifactWorkspace:closeArtifactWorkspace');
    expect(getHandler).toBeTypeOf('function');
    expect(viewportHandler).toBeTypeOf('function');
    expect(closeHandler).toBeTypeOf('function');

    await getHandler?.({ sender: primary.webContents }, { conversationId: 'primary' });
    await getHandler?.({ sender: secondary.webContents }, { conversationId: 'secondary' });
    const secondaryViewKey = getSnapshot.mock.calls[1][1];
    expect(getSnapshot.mock.calls[0][1]).toBe('primary');
    expect(secondaryViewKey).toMatch(/^window-/);

    await viewportHandler?.({ sender: secondary.webContents }, {
      conversationId: 'secondary',
      viewport: { x: 10, y: 20, zoom: 1.25 },
    });
    await closeHandler?.({ sender: secondary.webContents }, { conversationId: 'secondary' });
    expect(saveViewport.mock.calls[0][1]).toBe(secondaryViewKey);
    expect(closeWorkspace.mock.calls[0][1]).toBe(secondaryViewKey);

    const change = { conversationId: 'secondary', workspaceId: 'workspace-secondary' };
    changeListener?.(change);
    expect(primary.webContents.send).toHaveBeenCalledWith('desktop:artifactWorkspace:changed', change);
    expect(secondary.webContents.send).toHaveBeenCalledWith('desktop:artifactWorkspace:changed', change);

    secondary.close();
    expect(closeViewKey).toHaveBeenCalledWith(secondaryViewKey);
    primary.close();
    expect(closeViewKey).toHaveBeenCalledWith('primary');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
