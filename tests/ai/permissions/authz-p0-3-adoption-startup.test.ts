import { expect, it, vi } from 'vitest';
import { shouldPromptProjectRuleAdoption, promptPendingProjectRules } from '../../../src/commands/project-rule-adoption.js';
import { adoptProjectRule, listPendingProjectRules } from '../../../src/ai/permissions/settings.js';
import { promptProjectRuleAdoption } from '../../../src/ui/permission-prompt.js';
vi.mock('../../../src/ai/permissions/settings.js', () => ({ adoptProjectRule: vi.fn(), listPendingProjectRules: vi.fn() }));
vi.mock('../../../src/ui/permission-prompt.js', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/ui/permission-prompt.js')>(), promptProjectRuleAdoption: vi.fn() }));

it.each([
  [{auto: false, json: false, print: false, stdinIsTTY: true, stdoutIsTTY: true}, true],
  [{auto: true, stdinIsTTY: true, stdoutIsTTY: true}, false],
  [{auto: false, json: true, stdinIsTTY: true, stdoutIsTTY: true}, false],
  [{auto: false, print: true, stdinIsTTY: true, stdoutIsTTY: true}, false],
  [{auto: false, stdinIsTTY: false, stdoutIsTTY: true}, false],
  [{auto: false, stdinIsTTY: true, stdoutIsTTY: false}, false],
] as const)('startup adoption gate: %j', (options, expected) => {
  expect(shouldPromptProjectRuleAdoption(options)).toBe(expected);
});
it.each([
  [new Error('Project rule is no longer present'), '项目规则已变更，跳过'],
  [Object.assign(new Error('save failed'), {code: 'EACCES'}), '采纳记录保存失败'],
  [Object.assign(new Error('save failed'), {code: 'ENOSPC'}), '采纳记录保存失败'],
])('adoption failure is visible and processing continues: %j', async (error, message) => {
  vi.mocked(listPendingProjectRules).mockResolvedValue(['bash(echo \x1b[2J)', 'bash(ls)']);
  vi.mocked(promptProjectRuleAdoption).mockResolvedValue(true);
  vi.mocked(adoptProjectRule).mockReset().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await promptPendingProjectRules('/ws/repo');
    expect(write).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(write.mock.calls.flat().join('')).not.toContain('\x1b');
    expect(adoptProjectRule).toHaveBeenNthCalledWith(1, '/ws/repo', 'bash(echo \x1b[2J)');
    expect(adoptProjectRule).toHaveBeenNthCalledWith(2, '/ws/repo', 'bash(ls)');
  } finally { write.mockRestore(); }
});
