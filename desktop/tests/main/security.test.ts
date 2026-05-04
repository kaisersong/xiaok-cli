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

  it('allows only local app navigation', () => {
    expect(isAllowedNavigationUrl('file:///app/index.html')).toBe(true);
    expect(isAllowedNavigationUrl('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedNavigationUrl('https://example.com')).toBe(false);
    expect(isAllowedNavigationUrl('http://evil.test')).toBe(false);
  });
});
