import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
it('keeps only exact immutable return authorization across real GC and prevents execution/rebinding resurrection', () => {
  const output = execFileSync(process.execPath, ['--expose-gc', '--import', 'tsx', resolve('tests/support/delegation-gc.ts')], { encoding: 'utf8', timeout: 15000 });
  expect(JSON.parse(output)).toEqual({ collected: true, readable: true, rebindDenied: true, newCaptureDenied: true, newDelegationDenied: true, revocationDenied: true });
}, 20000);
