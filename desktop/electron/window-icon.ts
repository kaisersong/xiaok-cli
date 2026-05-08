import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveDesktopWindowIconPath(
  moduleDir: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  if (platform !== 'win32') return undefined;

  const candidate = join(moduleDir, '..', 'build', 'icon.png');
  return fileExists(candidate) ? candidate : undefined;
}
