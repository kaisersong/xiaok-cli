import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');
const desktopRoot = join(repoRoot, 'desktop');

describe('React Doctor tooling', () => {
  it('uses the installed local binary instead of npx latest', async () => {
    const pkg = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));

    expect(pkg.scripts.doctor).toBe('react-doctor');
    expect(pkg.scripts['doctor:json']).toBe('react-doctor --json --no-score --fail-on none');
    expect(pkg.scripts['doctor:staged']).toBe('react-doctor --staged --no-score --fail-on error');
  });

  it('keeps react-doctor as a dev-only dependency', async () => {
    const pkg = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));

    expect(pkg.dependencies?.['react-doctor']).toBeUndefined();
    expect(pkg.devDependencies?.['react-doctor']).toBeDefined();
  });

  it('keeps staged-only reduced-motion environment checks out of the failure gate', async () => {
    const config = JSON.parse(await readFile(join(desktopRoot, 'react-doctor.config.json'), 'utf8'));

    expect(config.surfaces?.ciFailure?.excludeRules).toContain('react-doctor/require-reduced-motion');
  });
});
