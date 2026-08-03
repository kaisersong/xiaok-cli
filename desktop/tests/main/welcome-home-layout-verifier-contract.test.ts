import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/verify-welcome-home-layout.mjs');
const PACKAGE_PATH = resolve(process.cwd(), 'package.json');

describe('welcome home installed layout verifier contract', () => {
  it('provides a repeatable CDP geometry and scroll gate', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);

    const script = readFileSync(SCRIPT_PATH, 'utf8');
    const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['verify:welcome-home-layout']).toBe('node scripts/verify-welcome-home-layout.mjs');
    expect(script).toContain("'[data-testid=\"welcome-home\"]'");
    expect(script).toContain("'#welcome-overview-title'");
    expect(script).toContain("'[aria-labelledby=\"welcome-continue-title\"]'");
    expect(script).toContain('scrollHeight > main.clientHeight');
    expect(script).toContain('bottomBreathingRoom >= 80');
    expect(script).toContain('layoutScrollOwners.length === 0');
    expect(script).toContain('consoleErrors.length === 0');
    expect(script).toContain('pageErrors.length === 0');
  });
});
