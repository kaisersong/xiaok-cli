import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { confirmChatPermission } from '../../src/commands/chat-permission.js';
import { buildPermissionPromptOptions, deriveRule, formatPermissionPromptLines } from '../../src/ui/permission-prompt.js';
import { loadSettings, mergeRules, addAllowRule } from '../../src/ai/permissions/settings.js';
import { PermissionManager } from '../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';

const command = 'sleep 1; tail -6 probe.log | grep -v warning | head -8';
const expectedRules = ['bash(sleep *)', 'bash(tail *)', 'bash(grep *)', 'bash(head *)'];
let root: string, cwd: string, previous: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'compound-approval-'));
  cwd = join(root, 'project'); mkdirSync(cwd);
  previous = process.env.XIAOK_CONFIG_DIR; process.env.XIAOK_CONFIG_DIR = join(root, 'config');
});
afterEach(() => {
  if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previous;
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

async function manager(project = cwd) {
  return new PermissionManager({ mode: 'default', cwd: project, ...mergeRules(await loadSettings(project)) });
}

describe('compound command approval through real UI choice, registry, save and reload', () => {
  it.each(['allow_project', 'allow_global', 'allow_session'] as const)('%s covers the full command in the current process', async action => {
    const permission = await manager();
    const onPrompt = vi.fn(async (name: string, input: Record<string, unknown>) => confirmChatPermission(name, input, {
      prompt: async () => buildPermissionPromptOptions(deriveRule(name, input), name, input).find(o => o.choice.action === action)!.choice,
      addAllowRule: (scope, rule) => addAllowRule(scope, rule, cwd),
      addSessionRule: rule => permission.addSessionRule(rule),
    }));
    const execute = vi.fn(async () => 'EXECUTED');
    const registry = new ToolRegistry({ permissionManager: permission, onPrompt }, [{ permission: 'bash',
      definition: { name: 'bash', description: 'side-effect-free authorization probe', inputSchema: { type: 'object', properties: {} } }, execute }]);
    expect(await registry.executeTool('bash', { command })).toBe('EXECUTED');
    expect(await registry.executeTool('bash', { command })).toBe('EXECUTED');
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    const reloaded = await manager();
    expect(await reloaded.check('bash', { command })).toBe(action === 'allow_session' ? 'prompt' : 'allow');
    const rules = mergeRules(await loadSettings(cwd)).allowRules;
    expect(rules).toEqual(action === 'allow_session' ? [] : expectedRules);
    const other = join(root, 'other'); mkdirSync(other);
    expect(await (await manager(other)).check('bash', { command })).toBe(action === 'allow_global' ? 'allow' : 'prompt');
  });

  it('displays every scope carried by the persistent choice', () => {
    const options = buildPermissionPromptOptions(deriveRule('bash', { command }), 'bash', { command });
    const choice = options.find(o => o.choice.action === 'allow_global')!.choice;
    expect(choice).toHaveProperty('rules', expectedRules);
    const lines = formatPermissionPromptLines('bash', { command }, options.map(o => ({ label: o.label, selected: false })));
    for (const rule of expectedRules) expect(lines.join('\n')).toContain(`始终允许的范围: ${rule}`);
  });

  it('deduplicates repeated executables without changing the single-rule choice shape', () => {
    const input = { command: 'sleep 1; sleep 2' };
    const option = buildPermissionPromptOptions(deriveRule('bash', input), 'bash', input).find(o => o.choice.action === 'allow_global');
    expect(option!.choice).toEqual({ action: 'allow_global', rule: 'bash(sleep *)' });
  });

  it('does not split separators inside quoted arguments into grants', async () => {
    const input = { command: 'printf "a;b"; sleep 1' };
    const option = buildPermissionPromptOptions(deriveRule('bash', input), 'bash', input).find(o => o.choice.action === 'allow_project');
    expect(option!.choice).toHaveProperty('rules', ['bash(printf *)', 'bash(sleep *)']);
  });

  it('new command suffixes and explicit denials remain gated after saving all scopes', async () => {
    for (const rule of expectedRules) await addAllowRule('global', rule, cwd);
    const permission = await manager();
    expect(await permission.check('bash', { command })).toBe('allow');
    expect(await permission.check('bash', { command: command + '; ls' })).toBe('prompt');
    permission.addSessionDenyRule('bash(tail *)');
    expect(await permission.check('bash', { command })).toBe('deny');
  });

  it.each([
    'sleep 1; sudo id', 'sleep 1; rm -rf /outside/example', 'sleep 1; echo x > /outside/result',
    'sleep 1; $(uname)', 'sleep 1; echo "unterminated',
  ])('does not offer remembered approval for mandatory-review command: %s', value => {
    const input = { command: value };
    expect(buildPermissionPromptOptions(deriveRule('bash', input), 'bash', input).map(o => o.choice.action))
      .toEqual(['allow_once', 'deny']);
  });
});
