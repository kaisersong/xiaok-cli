import { expect, it, vi } from 'vitest';
import { shouldPromptProjectRuleAdoption, promptPendingProjectRules } from '../../../src/commands/project-rule-adoption.js';
import { adoptProjectRule, listPendingProjectRules } from '../../../src/ai/permissions/settings.js';
import { promptProjectRuleAdoption } from '../../../src/ui/permission-prompt.js';
vi.mock('../../../src/ai/permissions/settings.js', () => ({ adoptProjectRule: vi.fn(), listPendingProjectRules: vi.fn(), getProjectAdoptionRecord: async () => ({ file: "/tmp/xiaok-test/project-rule-adoptions.json", key: "/ws/repo" }) }));
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
  [new Error('Project rule is no longer present'), '这条规则在询问期间被修改了，已跳过，下次启动会重新询问。'],
  [Object.assign(new Error('save failed'), {code: 'EACCES'}), '这条没有生效，下次启动会再问。'],
  [Object.assign(new Error('save failed'), {code: 'ENOSPC'}), '这条没有生效，下次启动会再问。'],
])('adoption failure is visible and processing continues: %j', async (error, message) => {
  vi.mocked(listPendingProjectRules).mockResolvedValue(['bash(echo \x1b[2J)', 'bash(ls)']);
  vi.mocked(promptProjectRuleAdoption).mockResolvedValue(true);
  vi.mocked(adoptProjectRule).mockReset().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await promptPendingProjectRules('/ws/repo');
    expect(write).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(write.mock.calls.flat().join('')).toContain('已采纳 1 条，跳过 1 条，');
    expect(write.mock.calls.flat().join('')).not.toContain('\x1b');
    expect(adoptProjectRule).toHaveBeenNthCalledWith(1, '/ws/repo', 'bash(echo \x1b[2J)');
    expect(adoptProjectRule).toHaveBeenNthCalledWith(2, '/ws/repo', 'bash(ls)');
  } finally { write.mockRestore(); }
});

it('prints pending count, adoption totals and the actual record path', async () => {
  vi.mocked(listPendingProjectRules).mockResolvedValue(['bash(ls)', 'read(*)', 'edit(*)']);
  vi.mocked(promptProjectRuleAdoption).mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  vi.mocked(adoptProjectRule).mockReset().mockResolvedValue(undefined);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await promptPendingProjectRules('/ws/repo');
    const output = write.mock.calls.flat().join('');
    expect(output).toContain('这个项目自带了 3 条放行规则。放行后，匹配的操作不再询问你。下面逐条确认，直接回车就是不采纳。');
    expect(promptProjectRuleAdoption).toHaveBeenNthCalledWith(1, 'bash(ls)', 1, 3);
    expect(output).toContain('已采纳 2 条，跳过 1 条，可用 /settings 查看。\n');
  } finally { write.mockRestore(); }
});
it('prints nothing when no project rules are pending', async () => {
  vi.mocked(listPendingProjectRules).mockResolvedValue([]);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await promptPendingProjectRules('/ws/repo');
    expect(write).not.toHaveBeenCalled();
  } finally { write.mockRestore(); }
});
