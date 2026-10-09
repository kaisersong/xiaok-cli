import { adoptProjectRule, listPendingProjectRules } from '../ai/permissions/settings.js';
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
  for (const rule of await listPendingProjectRules(cwd)) {
    if (!await promptProjectRuleAdoption(rule)) continue;
    try { await adoptProjectRule(cwd, rule); }
    catch (error) {
      const message = error instanceof Error && error.message === 'Project rule is no longer present'
        ? '项目规则已变更，跳过' : '采纳记录保存失败';
      process.stdout.write(`${message}：${escapeProjectRuleDisplay(rule)}\n`);
    }
  }
}
