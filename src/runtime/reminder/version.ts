import { readFileSync } from 'node:fs';

let cachedVersion: string | undefined;

export function readXiaokVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  const payload = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };
  cachedVersion = payload.version ?? '0.0.0';
  return cachedVersion;
}
