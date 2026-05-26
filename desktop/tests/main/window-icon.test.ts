import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { resolveDesktopDockIconPath } from '../../electron/window-icon.js';

describe('desktop dock icon path', () => {
  it('uses the packaged app bundle icon on macOS before build fallbacks', () => {
    const resourcesPath = '/Applications/xiaok.app/Contents/Resources';
    const packagedIcon = join(resourcesPath, 'icon.icns');
    const fallbackIcon = '/repo/desktop/dist/main/desktop/build/icon.icns';
    const existing = new Set([packagedIcon, fallbackIcon]);

    const result = resolveDesktopDockIconPath(
      '/repo/desktop/dist/main/desktop/electron',
      resourcesPath,
      'darwin',
      (path) => existing.has(path),
    );

    expect(result).toBe(packagedIcon);
  });

  it('does not set a dock icon on non-macOS platforms', () => {
    expect(resolveDesktopDockIconPath('/repo/desktop/dist/main/desktop/electron', '/resources', 'win32', () => true)).toBeUndefined();
  });
});
