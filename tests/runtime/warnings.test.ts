import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldSuppressWarning } from '../../src/runtime/warnings.js';

describe('shouldSuppressWarning', () => {
  it('suppresses the known punycode deprecation warning', () => {
    expect(shouldSuppressWarning('The `punycode` module is deprecated.', ['DEP0040']))
      .toBe(true);
  });

  it('does not suppress unrelated deprecation warnings', () => {
    expect(shouldSuppressWarning('fs.Stats constructor is deprecated.', ['DEP0180']))
      .toBe(false);
  });

  it('does not suppress non-deprecation warnings that mention punycode', () => {
    expect(shouldSuppressWarning('failed to parse punycode input', ['XIAOK_WARN']))
      .toBe(false);
  });

  it('boots the CLI through a late-loaded main module so warning filtering installs first', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'index.ts'), 'utf8');

    expect(source).toContain("await import('./main.js')");
    expect(source).not.toContain("import { registerChatCommands }");
    expect(source).not.toContain("import { registerDoctorCommands }");
  });
});
