import { describe, expect, it, vi } from 'vitest';
import { attachMacCloseToMinimize, attachWindowRepaintHandlers, restoreExistingWindow } from '../../electron/window-lifecycle.js';

function createWindowDouble(options: { minimized?: boolean; visible?: boolean; destroyed?: boolean } = {}) {
  const calls: string[] = [];
  const window = {
    isDestroyed: () => options.destroyed ?? false,
    isMinimized: () => options.minimized ?? false,
    isVisible: () => options.visible ?? true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    webContents: {
      isDestroyed: () => false,
      invalidate: () => calls.push('invalidate'),
      reloadIgnoringCache: () => calls.push('reloadIgnoringCache'),
    },
  };
  return { window, calls };
}

describe('desktop window lifecycle', () => {
  it('restores a minimized window and repaints without reloading renderer state', () => {
    vi.useFakeTimers();
    try {
      const { window, calls } = createWindowDouble({ minimized: true, visible: true });

      restoreExistingWindow(window);
      vi.runOnlyPendingTimers();

      expect(calls).toEqual(['restore', 'focus', 'invalidate', 'invalidate']);
      expect(calls).not.toContain('reloadIgnoringCache');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a hidden existing window before focusing and repainting it', () => {
    vi.useFakeTimers();
    try {
      const { window, calls } = createWindowDouble({ minimized: false, visible: false });

      restoreExistingWindow(window);
      vi.runOnlyPendingTimers();

      expect(calls).toEqual(['show', 'focus', 'invalidate', 'invalidate']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('repaints a newly loaded window so close-and-reopen does not leave a blank surface', () => {
    vi.useFakeTimers();
    try {
      const { window, calls } = createWindowDouble();
      const windowHandlers = new Map<string, () => void>();
      const webContentsHandlers = new Map<string, () => void>();
      const observedWindow = {
        ...window,
        on: (event: string, listener: () => void) => {
          windowHandlers.set(event, listener);
        },
        webContents: {
          ...window.webContents,
          on: (event: string, listener: () => void) => {
            webContentsHandlers.set(event, listener);
          },
        },
      };

      attachWindowRepaintHandlers(observedWindow);
      webContentsHandlers.get('did-finish-load')?.();
      vi.runOnlyPendingTimers();

      expect(windowHandlers.has('restore')).toBe(true);
      expect(windowHandlers.has('show')).toBe(true);
      expect(webContentsHandlers.has('did-finish-load')).toBe(true);
      expect(calls).toEqual(['invalidate', 'invalidate']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('minimizes instead of destroying the renderer when the macOS close button is clicked', () => {
    const calls: string[] = [];
    const closeEvent = { preventDefault: () => calls.push('preventDefault') };
    const handlers = new Map<string, (event: typeof closeEvent) => void>();
    const window = {
      on: (event: string, listener: (event: typeof closeEvent) => void) => {
        handlers.set(event, listener);
      },
      minimize: () => calls.push('minimize'),
    };

    attachMacCloseToMinimize(window, 'darwin');
    handlers.get('close')?.(closeEvent);

    expect(calls).toEqual(['preventDefault', 'minimize']);
  });

  it('allows app quit to close the macOS window instead of minimizing it', () => {
    const calls: string[] = [];
    const closeEvent = { preventDefault: () => calls.push('preventDefault') };
    const handlers = new Map<string, (event: typeof closeEvent) => void>();
    const window = {
      on: (event: string, listener: (event: typeof closeEvent) => void) => {
        handlers.set(event, listener);
      },
      minimize: () => calls.push('minimize'),
    };

    attachMacCloseToMinimize(window, 'darwin', () => false);
    handlers.get('close')?.(closeEvent);

    expect(calls).toEqual([]);
  });

  it('does not intercept window close on non-macOS platforms', () => {
    const handlers = new Map<string, () => void>();
    const window = {
      on: (event: string, listener: () => void) => {
        handlers.set(event, listener);
      },
      minimize: () => undefined,
    };

    attachMacCloseToMinimize(window, 'linux');

    expect(handlers.has('close')).toBe(false);
  });
});
