import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRootPackageJson(): {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
}

describe('npm global install contract', () => {
  it('keeps native nodejieba optional so global installs do not fail on its postinstall', () => {
    const pkg = readRootPackageJson();

    expect(pkg.dependencies?.nodejieba).toBeUndefined();
    expect(pkg.optionalDependencies?.nodejieba).toBeTruthy();
  });
});
