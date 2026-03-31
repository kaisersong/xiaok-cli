import { describe, expect, it } from 'vitest';
import { StatusBar } from '../../src/ui/statusbar.js';

describe('statusbar config', () => {
  it('can limit output to configured fields', () => {
    const bar = new StatusBar();
    bar.init('claude-opus-4-6', 'sess_1', '/Users/song/projects/xiaok-cli', 'plan');
    bar.updateBranch('feature/wave2');
    bar.update({ inputTokens: 1000, outputTokens: 1000, budget: 4000 });
    bar.setFields(['model', 'mode']);

    const line = bar.getStatusLine();

    expect(line).toContain('claude-opus-4-6');
    expect(line).toContain('plan');
    expect(line).not.toContain('xiaok-cli');
    expect(line).not.toContain('feature/wave2');
    expect(line).not.toContain('50%');
  });
});
