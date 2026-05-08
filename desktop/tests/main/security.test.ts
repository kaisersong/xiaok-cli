import { describe, expect, it } from 'vitest';
import { buildBrowserWindowOptions, isAllowedNavigationUrl } from '../../electron/security.js';

describe('desktop security baseline', () => {
  it('uses an isolated sandboxed renderer without node integration', () => {
    const options = buildBrowserWindowOptions('/app/preload.js');

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: '/app/preload.js',
    });
  });

  it('uses the generated build icon for Windows runtime windows only', () => {
    const windowsOptions = buildBrowserWindowOptions('/app/preload.js', {
      platform: 'win32',
      iconPath: 'C:/repo/desktop/build/icon.png',
    });
    const macOptions = buildBrowserWindowOptions('/app/preload.js', {
      platform: 'darwin',
      iconPath: 'C:/repo/desktop/build/icon.png',
    });

    expect(windowsOptions.icon).toBe('C:/repo/desktop/build/icon.png');
    expect(macOptions.icon).toBeUndefined();
  });

  it('allows only local app navigation', () => {
    expect(isAllowedNavigationUrl('file:///app/index.html')).toBe(true);
    expect(isAllowedNavigationUrl('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedNavigationUrl('https://example.com')).toBe(false);
    expect(isAllowedNavigationUrl('http://evil.test')).toBe(false);
  });
});
