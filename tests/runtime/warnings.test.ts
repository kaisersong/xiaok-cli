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

  it('suppresses only SQLite ExperimentalWarning messages', () => {
    const message = 'SQLite is an experimental feature and might change at any time';
    expect(shouldSuppressWarning(message, ['ExperimentalWarning'])).toBe(true);
    expect(shouldSuppressWarning(Object.assign(new Error(message), { name: 'ExperimentalWarning' }))).toBe(true);
    expect(shouldSuppressWarning('Fetch API is an experimental feature', ['ExperimentalWarning'])).toBe(false);
    expect(shouldSuppressWarning(Object.assign(new Error('Fetch API is an experimental feature'), { name: 'ExperimentalWarning' }))).toBe(false);
    expect(shouldSuppressWarning(message)).toBe(false);
    expect(shouldSuppressWarning(message, ['Warning'])).toBe(false);
    expect(shouldSuppressWarning(message, ['DeprecationWarning', 'DEP0180'])).toBe(false);
    expect(shouldSuppressWarning('prefix: ' + message, ['ExperimentalWarning'])).toBe(false);
    expect(shouldSuppressWarning(Object.assign(new Error('The `punycode` module is deprecated.'), { code: 'DEP0040' }))).toBe(true);
  });

  it('boots the CLI through a late-loaded main module so warning filtering installs first', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'index.ts'), 'utf8');

    expect(source).toContain("await import('./main.js')");
    expect(source).not.toContain("import { registerChatCommands }");
    expect(source).not.toContain("import { registerDoctorCommands }");
  });
});
