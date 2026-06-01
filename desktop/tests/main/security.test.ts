import { describe, expect, it } from 'vitest';
import {
  buildBrowserWindowOptions,
  isAllowedNavigationUrl,
  isAllowedShellExternalUrl,
  resolveLocalFileOpenPath,
} from '../../electron/security.js';

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

  it('uses the generated build icon for all platforms', () => {
    const windowsOptions = buildBrowserWindowOptions('/app/preload.js', {
      platform: 'win32',
      iconPath: 'C:/repo/desktop/build/icon.png',
    });
    const macOptions = buildBrowserWindowOptions('/app/preload.js', {
      platform: 'darwin',
      iconPath: '/repo/desktop/build/icon.png',
    });

    expect(windowsOptions.icon).toBe('C:/repo/desktop/build/icon.png');
    expect(macOptions.icon).toBe('/repo/desktop/build/icon.png');
  });

  it('allows only local app navigation', () => {
    expect(isAllowedNavigationUrl('file:///app/index.html')).toBe(true);
    expect(isAllowedNavigationUrl('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedNavigationUrl('https://example.com')).toBe(false);
    expect(isAllowedNavigationUrl('http://evil.test')).toBe(false);
  });

  it('allows shell external opens only for browser URLs', () => {
    expect(isAllowedShellExternalUrl('https://example.com/docs')).toBe(true);
    expect(isAllowedShellExternalUrl('http://example.com/docs')).toBe(true);

    expect(isAllowedShellExternalUrl('intent-broker')).toBe(false);
    expect(isAllowedShellExternalUrl('intent-broker:')).toBe(false);
    expect(isAllowedShellExternalUrl('intent-broker://tasks/123')).toBe(false);
    expect(isAllowedShellExternalUrl('file:///C:/Users/song/report.md')).toBe(false);
  });

  it('resolves file URLs separately from shell external opens', () => {
    expect(resolveLocalFileOpenPath('file:///C:/Users/song/My%20Report.md')).toBe('C:\\Users\\song\\My Report.md');
    expect(resolveLocalFileOpenPath('https://example.com/report.md')).toBe(null);
    expect(resolveLocalFileOpenPath('intent-broker')).toBe(null);
  });
});
