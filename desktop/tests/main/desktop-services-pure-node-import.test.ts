// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('loads actual DesktopServices in a fresh ordinary Node process without creating a fake Electron app', async () => {
  const require = createRequire(import.meta.url);
  const entry = pathToFileURL(resolve(process.cwd(), 'electron', 'desktop-services.ts')).href;
  const result = await promisify(execFile)(process.execPath, [
    '--import', pathToFileURL(require.resolve('tsx')).href,
    '--input-type=module', '-e', `await import(${JSON.stringify(entry)});`,
  ], { cwd: process.cwd(), timeout: 15000 });
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('does not provide an export named');
});
