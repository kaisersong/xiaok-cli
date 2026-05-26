import { describe, expect, it } from 'vitest';
import {
  getYzjSafeDefaultTools,
  resolveYzjAllowedTools,
} from '../../src/commands/yzj-safe-tools.js';

describe('yzj safe tool defaults', () => {
  it('returns the default safe tool subset (read-only + meta)', () => {
    const safe = getYzjSafeDefaultTools();
    expect(safe).toContain('read');
    expect(safe).toContain('grep');
    expect(safe).toContain('glob');
    expect(safe).toContain('subagent');
    expect(safe).not.toContain('write');
    expect(safe).not.toContain('edit');
    expect(safe).not.toContain('bash');
  });

  it('returns the safe default subset when no overrides given', () => {
    const allowed = resolveYzjAllowedTools({});
    expect(allowed).toEqual(getYzjSafeDefaultTools());
  });

  it('returns undefined when disable_safe_default is true', () => {
    const allowed = resolveYzjAllowedTools({ disableSafeDefault: true });
    expect(allowed).toBeUndefined();
  });

  it('merges extra_allowed_tools into the safe default', () => {
    const allowed = resolveYzjAllowedTools({
      extraAllowedTools: ['write', 'edit'],
    });
    expect(allowed).toEqual(expect.arrayContaining(['read', 'write', 'edit']));
    const seen = new Set(allowed);
    expect(seen.size).toBe(allowed?.length);
  });

  it('ignores empty / non-string entries in extra_allowed_tools', () => {
    const allowed = resolveYzjAllowedTools({
      extraAllowedTools: ['', 'bash'] as string[],
    });
    expect(allowed).toContain('bash');
    expect(allowed).not.toContain('');
  });

  it('disable_safe_default takes precedence over extra_allowed_tools', () => {
    const allowed = resolveYzjAllowedTools({
      disableSafeDefault: true,
      extraAllowedTools: ['write'],
    });
    expect(allowed).toBeUndefined();
  });
});
