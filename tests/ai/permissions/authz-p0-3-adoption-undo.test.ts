import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addAllowRule, adoptProjectRule, getProjectAdoptionRecord, listPendingProjectRules, loadSettings } from '../../../src/ai/permissions/settings.js';
import { promptPendingProjectRules } from '../../../src/commands/project-rule-adoption.js';
import { promptProjectRuleAdoption } from '../../../src/ui/permission-prompt.js';

vi.mock('../../../src/ui/permission-prompt.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/ui/permission-prompt.js')>(),
  promptProjectRuleAdoption: vi.fn(),
}));

const rule = 'bash(ls)';
const undoSentence = '如需撤销，可清除本项目的采纳记录（会同时撤销本项目全部已采纳规则，下次使用时会重新询问）';
let root: string;
let project: string;
async function createProject(name: string): Promise<string> {
  const cwd = join(root, name);
  await mkdir(join(cwd, '.xiaok'), { recursive: true });
  await writeFile(join(cwd, '.xiaok', 'settings.json'), JSON.stringify({ permissions: { allow: [rule] } }));
  return cwd;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'xiaok-adoption-undo-'));
  vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
  project = await createProject('project');
  vi.mocked(promptProjectRuleAdoption).mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

it('clearing the printed adoption array asks again and preserves other projects and local rules', async () => {
  const other = await createProject('other');
  await adoptProjectRule(other, rule);
  await addAllowRule('project', 'read(*)', project);
  await addAllowRule('project', 'edit(*)', other);
  vi.mocked(promptProjectRuleAdoption).mockResolvedValue(true);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await promptPendingProjectRules(project);
  const output = write.mock.calls.map(call => call[0]).join('');
  expect(await listPendingProjectRules(project)).toEqual([]);
  expect((await loadSettings(project)).approvedProjectAllow).toContain(rule);
  const { file, key } = await getProjectAdoptionRecord(project);
  const text = await readFile(file, 'utf8');
  const printedKey = JSON.stringify(key);
  expect(output).toContain(undoSentence);
  expect(output).toContain(file);
  expect(output).toContain(printedKey);
  expect(text).toContain(printedKey);
  const resolved = await realpath(project);
  expect(key).toBe(process.platform === 'win32' ? resolved.toLowerCase() : resolved);
  expect(output).not.toMatch(/删除|重新启动|xiaok\s+[^\n]*(?:undo|revoke)/);
  expect(output).toContain('已采纳 1 条，跳过 0 条，可用 /settings 查看。\n');

  // Follow the displayed instruction: find this JSON key and empty only its adoption array.
  const state = JSON.parse(text);
  const before = JSON.parse(text);
  const keyFromOutput = JSON.parse(output.slice(output.indexOf(printedKey), output.indexOf(printedKey) + printedKey.length));
  state.adoptions[keyFromOutput] = [];
  await writeFile(file, JSON.stringify(state, null, 2) + '\n');
  expect(await listPendingProjectRules(project)).toEqual([rule]);
  expect((await loadSettings(project)).approvedProjectAllow).toEqual(['read(*)']);
  expect(await listPendingProjectRules(other)).toEqual([]);
  const after = JSON.parse(await readFile(file, 'utf8'));
  const otherRecord = await getProjectAdoptionRecord(other);
  expect(after.adoptions[otherRecord.key]).toEqual(before.adoptions[otherRecord.key]);
  expect(after.localRules).toEqual(before.localRules);
});

it('does not print undo instructions when no rule is adopted', async () => {
  vi.mocked(promptProjectRuleAdoption).mockResolvedValue(false);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await promptPendingProjectRules(project);
  const output = write.mock.calls.map(call => call[0]).join('');
  expect(output).toContain('已采纳 0 条，跳过 1 条，可用 /settings 查看。\n');
  expect(output).not.toContain('如需撤销');
  expect(output).not.toContain('project-rule-adoptions.json');
});
