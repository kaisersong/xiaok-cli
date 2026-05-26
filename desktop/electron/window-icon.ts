import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveDesktopWindowIconPath(
  moduleDir: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  // Try multiple icon paths based on platform
  const candidates = [
    // PNG works for all platforms in BrowserWindow
    join(moduleDir, '..', 'build', 'icon.png'),
    join(moduleDir, '..', 'build', 'tray-icon.png'),
    // Fallback to dist location
    join(moduleDir, 'electron', 'tray-icon.png'),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}

export function resolveDesktopDockIconPath(
  moduleDir: string,
  resourcesPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  if (platform !== 'darwin') return undefined;

  const candidates = [
    resourcesPath ? join(resourcesPath, 'icon.icns') : undefined,
    resourcesPath ? join(resourcesPath, 'build', 'icon.icns') : undefined,
    join(moduleDir, '..', 'build', 'icon.icns'),
    join(moduleDir, '..', 'build', 'icon.png'),
    join(moduleDir, '..', '..', '..', 'build', 'icon.icns'),
    join(moduleDir, '..', '..', '..', 'build', 'icon.png'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}
