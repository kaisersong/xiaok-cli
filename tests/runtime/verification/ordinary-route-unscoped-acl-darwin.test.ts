import { expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';

const observed = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:child_process', async load => {
  const actual = await load<typeof import('node:child_process')>();
  return { ...actual, spawnSync(path: string, ...args: unknown[]) {
    if (path === '/bin/ls' && Array.isArray(args[0]) && args[0][0] === '-lde') observed.count++;
    return Reflect.apply(actual.spawnSync, actual, [path, ...args]);
  } };
});

it.skipIf(process.platform !== 'darwin' || existsSync('/Library/Application Support/xiaok-verification'))(
  'checks the actual ordinary install path and real root ACL once across unchanged unscoped reads', async () => {
    const { readInstalledCurrentProfile } = await import('../../../src/runtime/verification/migration-markers.js');
    for (let n = 0; n < 5; n++) expect(readInstalledCurrentProfile().kind).toBe('ordinary');
    expect(observed.count).toBe(1);
  },
);
