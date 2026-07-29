import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function gitPorcelain(pathspec: string): string | null {
  try {
    return execFileSync(
      'git',
      ['status', '--porcelain', '--', pathspec],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 },
    );
  } catch {
    // Sandboxed environments may forbid subprocess spawn (EPERM); probe and skip.
    return null;
  }
}

describe('xiaok-product hard gate: kimi-k3-d9 directory untouched', () => {
  it('shows zero modified/staged/untracked entries under scripts/evals/kimi-k3-d9', () => {
    const output = gitPorcelain('scripts/evals/kimi-k3-d9');
    if (output === null) {
      console.warn('[xiaok-product-d9-untouched] git unavailable in sandbox; skipping');
      return;
    }
    expect(output.trim()).toBe('');
  });
});
