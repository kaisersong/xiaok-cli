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
