import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRootPackageJson(): {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
}

describe('npm global install contract', () => {
  it('keeps native nodejieba optional so global installs do not fail on its postinstall', () => {
    const pkg = readRootPackageJson();

    expect(pkg.dependencies?.nodejieba).toBeUndefined();
    expect(pkg.optionalDependencies?.nodejieba).toBeTruthy();
  });

  it('does not expose internal authorization or profile modules through package deep imports', () => {
    const pkg = readRootPackageJson();

    expect(pkg.exports).toEqual({
      '.': './dist/index.js',
      './package.json': './package.json',
    });
    expect(pkg.exports).not.toHaveProperty('./dist/*');

    const probe = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "import('xiaokcode/dist/ai/runtime/provider-conversation-authorization.js')",
        ".then(() => process.exit(2))",
        ".catch((error) => process.exit(error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ? 0 : 3));",
      ].join(''),
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(probe.status).toBe(0);
  });
});
