import type { BrowserWindowConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';

interface BrowserWindowBuildOptions {
  platform?: NodeJS.Platform;
  iconPath?: string;
}

export function buildBrowserWindowOptions(
  preloadPath: string,
  options: BrowserWindowBuildOptions = {},
): BrowserWindowConstructorOptions {
  const { platform = process.platform, iconPath } = options;

  return {
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#f7f7f2',
    title: 'xiaok',
    titleBarStyle: 'hiddenInset',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload.cjs uses require()
    },
  };
}

export function isAllowedNavigationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') {
      return true;
    }
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function isAllowedShellExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveLocalFileOpenPath(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'file:') return null;
    return fileURLToPath(url);
  } catch {
    return null;
  }
}
