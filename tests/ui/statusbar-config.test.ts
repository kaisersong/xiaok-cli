import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatusBar } from '../../src/ui/statusbar.js';

describe('statusbar config', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'xiaok-statusbar-config-'));
    vi.stubEnv('XIAOK_CONFIG_DIR', configDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(configDir, {recursive: true, force: true, maxRetries: 3});
  });
  it('previews candidate fields without changing the active statusline', () => {
    const bar = new StatusBar(); bar.init('example-model', 'sess_example', '/projects/demo', 'auto');
    bar.setFields(['model', 'project']);
    const before = bar.getStatusLine();
    expect(bar.getStatusLineForFields(['project', 'model']).replace(/\x1b\[[0-9;]*m/g, ''))
      .toBe('demo · example-model');
    expect(bar.getFields()).toEqual(['model', 'project']);
    expect(bar.getStatusLine()).toBe(before);
  });
  it('shows only explicitly selected fields in the requested order', () => {
    const bar = new StatusBar();
    bar.init('example-model', 'sess_example', '/projects/demo', 'auto');
    bar.updateBranch('feature/example');
    bar.setFields(['project', 'branch', 'model', 'session-id']);
    expect(bar.getStatusLine().replace(/\x1b\[[0-9;]*m/g, ''))
      .toBe('demo · feature/example · example-model · sess_example');
    bar.setFields(['tokens']);
    expect(bar.getStatusLine()).not.toContain('feature/example');
  });

  it('hides all status fields without hiding live activity', () => {
    const bar = new StatusBar();
    bar.init('example-model', 'sess_example', '/projects/demo', 'auto');
    bar.updateBranch('feature/example');
    bar.setFields([]);
    expect(bar.getStatusLine()).toBe('');
    bar.beginActivity('Working', 0);
    expect(bar.getActivityLine(1000)).toContain('Working');
  });

  it('keeps selected field values on one terminal row', () => {
    const bar = new StatusBar();
    bar.init('example\nmodel\x1b[2J', 'sess_example', '/projects/demo', 'auto');
    bar.setFields(['model']);
    const line = bar.getStatusLine().replace(/\x1b\[[0-9;]*m/g, '');
    expect(line).not.toMatch(/[\r\n\x1b]/);
    expect(line).toContain('example');
  });
  it('can limit output to configured fields', () => {
    const bar = new StatusBar();
    bar.init('claude-opus-4-6', 'sess_1', '/Users/song/projects/xiaok-cli', 'plan');
    bar.updateBranch('feature/wave2');
    bar.update({ inputTokens: 1000, outputTokens: 1000 });
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
      bar.update({ inputTokens: 1000, outputTokens: 1000 });

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
