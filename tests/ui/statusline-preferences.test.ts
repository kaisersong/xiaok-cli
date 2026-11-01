import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatusBar } from '../../src/ui/statusbar.js';
import { runStatuslineCommand } from '../../src/commands/chat-statusline.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-statusline-pref-'));
  roots.push(root);
  vi.stubEnv('XIAOK_CONFIG_DIR', root);
  const bar = new StatusBar();
  bar.init('example-model', 'sess_example', join(root, 'project'), 'auto');
  bar.updateBranch('feature/example');
  return {root, bar};
}

describe('statusline command preferences', () => {
  it.each([
    [['tokens', 'session'], 'plan', '3% · $0.05 · project · feature/example'],
    [['tokens', 'session', 'mode'], 'plan', '3% · $0.05 · project · feature/example · plan'],
    [['model', 'mode', 'tokens', 'session'], 'default', 'claude-sonnet-4-20250514 · 3% · $0.05 · feature/example · project'],
  ] as const)('retains the visible fragment order for legacy fields %j in mode %s', (fields, mode, expected) => {
    const {root} = fixture();
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ui:{statusBar:{fields}}}));
    const next = new StatusBar(); next.init('claude-sonnet-4-20250514', 'sess_example', join(root, 'project'), mode);
    next.updateBranch('feature/example'); next.update({inputTokens:6000,outputTokens:2000});
    expect(next.getStatusLine().replace(/\x1b\[[0-9;]*m/g, '')).toBe(expected);
    expect(next.getStatusLineForFields(next.getEditableFields()).replace(/\x1b\[[0-9;]*m/g, '')).toBe(expected);
  });
  it.each([{}, {version:1}, {version:2,fields:[]}, {version:1,fields:[1]}, {version:1,fields:['unknown']}])(
    'does not interpret an invalid or future preference as off: %j', preference => {
      const {root} = fixture();
      writeFileSync(join(root, 'statusline.json'), JSON.stringify(preference));
      const next = new StatusBar(); next.init('example-model', 'sess_example', root);
      expect(next.getStatusLine()).toContain('example-model');
    });
  it('saves field order, applies immediately and reloads on restart', () => {
    const {root, bar} = fixture();
    writeFileSync(join(root, 'settings.json'), JSON.stringify({permissions: {deny: ['bash(*)']}, ui: {statusBar: {fields: ['mode']}}}));
    const before = readFileSync(join(root, 'settings.json'), 'utf8');
    expect(runStatuslineCommand('project,branch,model,project', bar)).toContain('已保存');
    expect(bar.getFields()).toEqual(['project', 'branch', 'model']);
    const next = new StatusBar(); next.init('example-model', 'sess_example', '/projects/demo'); next.updateBranch('feature/example');
    expect(next.getFields()).toEqual(['project', 'branch', 'model']);
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(join(root, 'statusline.json'), 'utf8')).fields).toEqual(['project', 'branch', 'model']);
  });

  it('persists off and resets to defaults without requiring restart', () => {
    const {root, bar} = fixture();
    runStatuslineCommand('off', bar);
    expect(bar.getStatusLine()).toBe('');
    const next = new StatusBar(); next.init('example-model', 'sess_example', root); next.updateBranch('feature/example');
    expect(next.getStatusLine()).toBe('');
    expect(runStatuslineCommand('reset', next)).toContain('已保存');
    expect(next.getStatusLine()).toContain('example-model');
    expect(next.getStatusLine()).toContain('feature/example');
  });

  it('rejects unknown fields and keeps the previous preference bytes and runtime state', () => {
    const {root, bar} = fixture();
    runStatuslineCommand('model,project', bar);
    const before = readFileSync(join(root, 'statusline.json'), 'utf8');
    expect(runStatuslineCommand('model,arbitrary-command', bar)).toContain('未知字段');
    expect(readFileSync(join(root, 'statusline.json'), 'utf8')).toBe(before);
    expect(bar.getFields()).toEqual(['model', 'project']);
  });

  it('reports failed writes and keeps the active fields', () => {
    const {root, bar} = fixture();
    const before = bar.getFields();
    mkdirSync(join(root, 'statusline.json'));
    expect(runStatuslineCommand('model', bar)).toContain('保存失败');
    expect(bar.getFields()).toEqual(before);
  });

  it('falls back from a malformed new preference to legacy project fields', () => {
    const {root} = fixture();
    mkdirSync(join(root, 'project', '.xiaok'), {recursive: true});
    writeFileSync(join(root, 'project', '.xiaok', 'settings.json'), JSON.stringify({ui: {statusBar: {fields: ['session', 'tokens']}}}));
    writeFileSync(join(root, 'statusline.json'), '{broken');
    const next = new StatusBar(); next.init('claude-sonnet-4-20250514', 'sess_example', join(root, 'project'));
    next.update({inputTokens:6000, outputTokens:2000});
    expect(next.getStatusLine()).toContain('project');
    expect(next.getStatusLine()).toContain('$');
    expect(runStatuslineCommand('', next)).toContain('/statusline model,branch,tokens,project');
  });
});
