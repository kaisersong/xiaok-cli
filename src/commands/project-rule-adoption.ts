import { dirname, join } from 'node:path';
import { adoptProjectRule, listPendingProjectRules, getGlobalSettingsPath } from '../ai/permissions/settings.js';
import { escapeProjectRuleDisplay, promptProjectRuleAdoption } from '../ui/permission-prompt.js';

export function shouldPromptProjectRuleAdoption(options: {
  auto: boolean;
  json?: boolean;
  print?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}): boolean {
  return !options.auto && !options.json && !options.print && Boolean(options.stdinIsTTY && options.stdoutIsTTY);
}

export async function promptPendingProjectRules(cwd: string): Promise<void> {
  const rules = await listPendingProjectRules(cwd);
  if (rules.length === 0) return;
  process.stdout.write(`这个项目自带了 ${rules.length} 条放行规则。放行后，匹配的操作不再询问你。下面逐条确认，直接回车就是不采纳。\n`);
  let adopted = 0;
  for (const [index, rule] of rules.entries()) {
    if (!await promptProjectRuleAdoption(rule, index + 1, rules.length)) continue;
    try {
      await adoptProjectRule(cwd, rule);
      adopted++;
    } catch (error) {
      const message = error instanceof Error && error.message === 'Project rule is no longer present'
        ? '这条规则在询问期间被修改了，已跳过，下次启动会重新询问。'
        : '这条没有生效，下次启动会再问。';
      process.stdout.write(`${message}\n`);
    }
  }
  const recordPath = join(dirname(getGlobalSettingsPath()), 'project-rule-adoptions.json');
  process.stdout.write(`已采纳 ${adopted} 条，跳过 ${rules.length - adopted} 条，可用 /settings 查看；要撤销，删除 ${escapeProjectRuleDisplay(recordPath)} 中的记录后重新启动\n`);
}
