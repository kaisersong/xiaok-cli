import {
  DEFAULT_GOAL_TURN_LIMIT,
  type GoalInput,
  type GoalState,
} from '../runtime/goal/index.js';

export type GoalSlashCommand =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'pause' }
  | { kind: 'resume'; turnLimit?: number }
  | { kind: 'cancel' }
  | { kind: 'create'; objective: string }
  | { kind: 'replace'; objective: string }
  | { kind: 'invalid'; message: string };

const FILE_OBJECTIVE = /(?:修改|修复|实现|重构|新增|创建|写入|编辑|删除|代码|文件|项目|build|implement|fix|refactor|write|edit|file|code)/iu;
const COMMAND_OBJECTIVE = /(?:测试|构建|验证|运行|执行|发布|部署|test|build|verify|run|execute|lint|typecheck|deploy|publish)/iu;

export function parseGoalSlashCommand(input: string): GoalSlashCommand | null {
  const trimmed = input.trim();
  if (!/^\/goal(?:\s|$)/u.test(trimmed)) return null;
  const rest = trimmed.slice('/goal'.length).trim();
  if (!rest) return { kind: 'help' };
  if (rest === 'status') return { kind: 'status' };
  if (rest === 'pause') return { kind: 'pause' };
  if (rest === 'resume') return { kind: 'resume' };
  if (rest.startsWith('resume ')) {
    const raw = rest.slice('resume '.length).trim();
    const turnLimit = Number(raw);
    return Number.isSafeInteger(turnLimit)
      ? { kind: 'resume', turnLimit }
      : { kind: 'invalid', message: '用法：/goal resume [newTurnLimit]' };
  }
  if (rest === 'cancel') return { kind: 'cancel' };
  if (rest === 'replace') return { kind: 'invalid', message: '用法：/goal replace <objective>' };
  if (rest.startsWith('replace ')) {
    const objective = rest.slice('replace '.length).trim();
    return objective
      ? { kind: 'replace', objective }
      : { kind: 'invalid', message: '用法：/goal replace <objective>' };
  }
  if (/^(?:status|pause|cancel)\s+/u.test(rest)) {
    return { kind: 'invalid', message: `Goal 子命令不接受额外参数：${rest}` };
  }
  return { kind: 'create', objective: rest };
}

export function inferGoalInput(objective: string): GoalInput {
  const needsFile = FILE_OBJECTIVE.test(objective);
  const needsCommand = COMMAND_OBJECTIVE.test(objective);
  const expectedEvidenceKinds: GoalInput['expectedEvidenceKinds'] = needsFile
    ? (needsCommand ? ['file_artifact', 'command_action'] : ['file_artifact'])
    : (needsCommand ? ['command_action'] : ['answer']);
  return {
    objective: objective.trim(),
    completionCriterion: objective.trim(),
    expectedEvidenceKinds,
    turnLimit: DEFAULT_GOAL_TURN_LIMIT,
  };
}

export function isUnsupportedSingleShotGoalInput(input: string): boolean {
  return parseGoalSlashCommand(input) !== null;
}

export function formatGoalPreview(input: GoalInput, replacing = false): string {
  return [
    replacing ? '将替换当前 Goal：' : '将创建 Goal：',
    `目标：${input.objective}`,
    `完成条件：${input.completionCriterion ?? '未指定'}`,
    `证据：${input.expectedEvidenceKinds.join(', ')}`,
    `轮次上限：${input.turnLimit ?? DEFAULT_GOAL_TURN_LIMIT}`,
  ].join('\n');
}

export function formatGoalStatus(goal: GoalState): string {
  const seconds = Math.round(goal.activeWallClockMs / 1000);
  return [
    `Goal · ${goal.status} · ${goal.turnsUsed}/${goal.budgetLimits.turnLimit} turns`,
    `目标：${goal.objective}`,
    `完成条件：${goal.completionCriterion ?? '未指定'}`,
    `证据要求：${goal.expectedEvidenceKinds.join(', ')}`,
    `用量：${goal.tokensUsed} tokens · ${seconds}s active`,
    ...(goal.terminalReason ? [`原因：${goal.terminalReason}`] : []),
  ].join('\n');
}

export function formatGoalSummaryLine(goal: GoalState | null): string {
  if (!goal) return '';
  return `Goal · ${goal.status} · ${goal.turnsUsed}/${goal.budgetLimits.turnLimit} turns`;
}

export function buildGoalContinuationInput(goal: GoalState): {
  systemTrigger: 'goal_continuation';
  prompt: string;
} {
  return {
    systemTrigger: 'goal_continuation',
    prompt: [
      '[system_trigger: goal_continuation]',
      '继续推进当前 Goal。先检查尚缺的完成证据，执行下一项最有价值且可验证的工作。',
      '不要把这条内部触发器解释为新的用户请求，也不要重复已经完成的工作。',
      `goal_id=${goal.goalId}; epoch=${goal.epoch}; next_turn=${goal.turnsUsed + 1}`,
    ].join('\n'),
  };
}

export const GOAL_COMMAND_HELP = [
  '/goal <objective>',
  '/goal status',
  '/goal pause',
  '/goal resume [newTurnLimit]',
  '/goal cancel',
  '/goal replace <objective>',
].join('\n');
