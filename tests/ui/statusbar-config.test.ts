import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

  it('loads configured fields from project settings during init', () => {
    const cwd = join(tmpdir(), `xiaok-statusbar-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });
    writeFileSync(
      join(cwd, '.xiaok', 'settings.json'),
      JSON.stringify({
        ui: {
          statusBar: {
            fields: ['model', 'mode'],
          },
        },
      }, null, 2),
      'utf8',
    );

    try {
      const bar = new StatusBar();
      bar.init('claude-opus-4-6', 'sess_1', cwd, 'plan');
      bar.updateBranch('feature/wave2');
      bar.update({ inputTokens: 1000, outputTokens: 1000, budget: 4000 });

      const line = bar.getStatusLine();

      expect(line).toContain('claude-opus-4-6');
      expect(line).toContain('plan');
      expect(line).not.toContain('xiaok-statusbar-');
      expect(line).not.toContain('feature/wave2');
      expect(line).not.toContain('50%');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
