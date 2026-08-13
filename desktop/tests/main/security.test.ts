import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildBrowserWindowOptions,
  isAllowedNavigationUrl,
  isAllowedShellExternalUrl,
  isTrustedDesktopRendererUrl,
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

  it('trusts only the configured desktop renderer entry while allowing hash routes', () => {
    const rendererFile = join(process.cwd(), 'dist', 'renderer', 'index.html');
    const rendererUrl = pathToFileURL(rendererFile).href;

    expect(isTrustedDesktopRendererUrl(rendererUrl, {
      rendererFile,
    })).toBe(true);
    expect(isTrustedDesktopRendererUrl(`${rendererUrl}#/t/thread-1`, {
      rendererFile,
    })).toBe(true);
    expect(isTrustedDesktopRendererUrl(pathToFileURL(join(process.cwd(), 'untrusted.html')).href, {
      rendererFile,
    })).toBe(false);
    expect(isTrustedDesktopRendererUrl(`${rendererUrl}?untrusted=1`, {
      rendererFile,
    })).toBe(false);

    expect(isTrustedDesktopRendererUrl('http://127.0.0.1:5173/#/t/thread-1', {
      devServer: 'http://127.0.0.1:5173',
      rendererFile,
    })).toBe(true);
    expect(isTrustedDesktopRendererUrl('http://127.0.0.1:5174/', {
      devServer: 'http://127.0.0.1:5173',
      rendererFile,
    })).toBe(false);
    expect(isTrustedDesktopRendererUrl('not a URL', {
      rendererFile,
    })).toBe(false);
  });

  it('gates both desktop permission handlers on the current trusted renderer URL', () => {
    const mainSource = readFileSync(join(__dirname, '..', '..', 'electron', 'main.ts'), 'utf8');

    expect(mainSource).toContain('const isTrustedMainRenderer =');
    expect(mainSource).toContain("isTrustedDesktopRendererUrl(webContents?.getURL() ?? '', options)");
    expect(mainSource.match(/isMainWindowWebContents: isTrustedMainRenderer\(webContents\)/g))
      .toHaveLength(2);
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
