import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] },
  clipboard: {}, dialog: {}, shell: { openExternal: vi.fn() } }));
import { shell } from 'electron';
import { registerDesktopIpc } from '../../electron/ipc.js';

describe('Computer Use permission IPC', () => {
  it('rejects non-macOS and invalid permission before opening external URLs', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    await registerDesktopIpc({ handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } as never,
      { isDestroyed: () => false, once: vi.fn(), webContents: { id: 1, send: vi.fn() } } as never,
      { getDataRoot: () => '/tmp' } as never);
    const handler = handlers.get('desktop:openPluginDependencyPermissionSettings')!;
    const platform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      await expect(handler({}, { permission: 'screen' })).rejects.toThrow('unsupported_action');
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      await expect(handler({}, { permission: 'anything' })).rejects.toThrow('invalid_permission');
      expect(shell.openExternal).not.toHaveBeenCalled();
      await handler({}, { permission: 'screen' });
      expect(shell.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    } finally { Object.defineProperty(process, 'platform', { value: platform, configurable: true }); }
  });
});
