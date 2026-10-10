import type { PermissionChoice } from '../types.js';

type TerminalDecide = (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>;

/** 双端决定完成后，才保存获胜终端选择的规则。 */
export async function confirmChatPermission(
  name: string,
  input: Record<string, unknown>,
  options: {
    prompt: (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<PermissionChoice>;
    race?: (terminal: TerminalDecide) => Promise<boolean>;
    addAllowRule: (scope: 'project' | 'global', rule: string) => Promise<void>;
    addSessionRule: (rule: string) => void;
  },
): Promise<boolean> {
  const terminal: { choice?: PermissionChoice; signal?: AbortSignal } = {};
  const tuiDecide: TerminalDecide = async (_name, _input, signal) => {
    terminal.signal = signal;
    const choice = await options.prompt(name, input, signal);
    if (signal?.aborted || choice.action === 'deny') return false;
    terminal.choice = choice;
    return true;
  };
  const allowed = options.race ? await options.race(tuiDecide) : await tuiDecide(name, input);
  if (!allowed || terminal.signal?.aborted) return allowed;
  const choice = terminal.choice;
  try {
    if (choice?.action === 'allow_session') options.addSessionRule(choice.rule);
    if (choice?.action === 'allow_project' || choice?.action === 'allow_global') {
      await options.addAllowRule(choice.action === 'allow_project' ? 'project' : 'global', choice.rule);
      options.addSessionRule(choice.rule);
    }
  } catch (err) {
    // 本次已放行；规则落盘失败不反转为 deny，也不让异常冒泡改写结算语义。
    process.stderr.write(`[permission] failed to persist allow rule: ${String(err)}\n`);
  }
  return allowed;
}
