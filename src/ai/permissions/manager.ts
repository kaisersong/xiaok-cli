import { posix, win32 } from 'node:path';
export type PermissionMode = 'default' | 'auto' | 'plan';
export type PermissionDecision = 'allow' | 'deny' | 'prompt';
import { PermissionPolicyEngine, requiresCommandConfirmation, getCommandWriteTargets, hasMatchingCommandAllowRule, requiresAlwaysCommandConfirmation } from './policy-engine.js';
import { isScreenAutomationFallbackInvocation, isSensitiveToolInvocation } from './sensitive-paths.js';
import { classifyBashCommand, requiresAutoPromptForBashCommand } from '../tools/bash-safety.js';

export interface PermissionManagerOptions {
  mode: PermissionMode;
  cwd?: string;
  allowRules?: string[];
  denyRules?: string[];
}

function readBashCommand(input: Record<string, unknown>): string {
  return typeof input.command === 'string' ? input.command : '';
}

export class PermissionManager {
  private mode: PermissionMode;
  private readonly cwd: string;
  private allowRules: string[];
  private denyRules: string[];

  constructor(options: PermissionManagerOptions) {
    this.mode = options.mode;
    this.cwd = options.cwd ?? process.cwd();
    this.allowRules = options.allowRules ?? [];
    this.denyRules = options.denyRules ?? [];
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  addSessionRule(rule: string): void {
    if (!this.allowRules.includes(rule)) {
      this.allowRules.push(rule);
    }
  }

  addSessionDenyRule(rule: string): void {
    if (!this.denyRules.includes(rule)) {
      this.denyRules.push(rule);
    }
  }

  static nextMode(mode: PermissionMode): PermissionMode {
    if (mode === 'default') return 'auto';
    if (mode === 'auto') return 'plan';
    return 'default';
  }

  async check(toolName: string, input: Record<string, unknown>): Promise<PermissionDecision> {
    const policy = new PermissionPolicyEngine({
      globalAllow: this.allowRules,
      globalDeny: this.denyRules,
      projectAllow: [],
      projectDeny: [],
      sessionAllow: [],
      sessionDeny: [],
    });
    const evaluation = await policy.evaluate(toolName, input);
    if (evaluation.action === 'deny') {
      return 'deny';
    }

    if (this.mode === 'plan' && ['write', 'edit', 'bash'].includes(toolName)) {
      return 'deny';
    }

    if (toolName === 'bash') {
      const risk = classifyBashCommand(readBashCommand(input));
      if (risk.level === 'block') {
        return 'deny';
      }
    }

    if (toolName === 'bash') {
      const command = readBashCommand(input);
      const conservative = this.mode !== 'auto' || hasMatchingCommandAllowRule(this.allowRules, command);
      if (conservative ? requiresCommandConfirmation(command) : requiresAlwaysCommandConfirmation(command)) return 'prompt';
      if (conservative) {
        const targets = getCommandWriteTargets(command);
        const hasWorkdir = Object.hasOwn(input, 'workdir');
        if (targets.length && hasWorkdir && typeof input.workdir !== 'string') return 'prompt';
        const api = /^[a-z]:|^\\\\|^\/\//i.test(this.cwd) ? win32 : posix;
        const effectiveDir = typeof input.workdir === 'string' ? api.resolve(this.cwd, input.workdir) : this.cwd;
        if (targets.length && hasWorkdir && isOutsideWorkspace(input.workdir as string, this.cwd)) return 'prompt';
        if (targets.some(target => isOutsideWorkspace(target, this.cwd, effectiveDir))) return 'prompt';
        if (targets.length && this.mode !== 'auto') return 'prompt';
      }
    }

    if (isSensitiveToolInvocation(toolName, input) && evaluation.action !== 'allow') {
      return 'deny';
    }

    if (isScreenAutomationFallbackInvocation(toolName, input)) {
      return 'deny';
    }

    if (this.mode === 'auto') {
      if (toolName === 'bash') {
        const autoPromptRisk = requiresAutoPromptForBashCommand(readBashCommand(input));
        if (autoPromptRisk && evaluation.action !== 'allow') {
          return 'prompt';
        }
      }

      return 'allow';
    }

    if (['read', 'glob', 'grep', 'skill', 'tool_search', 'install_skill', 'uninstall_skill'].includes(toolName)) {
      return 'allow';
    }

    if (evaluation.action === 'allow') {
      return 'allow';
    }

    return 'prompt';
  }
}

/** Resolve lexical paths conservatively across POSIX, drive and UNC forms. */
function isOutsideWorkspace(target: string, cwd: string, effectiveDir = cwd): boolean {
  if (/^[~]|[$`]/.test(target)) return true;
  const windows = /^[a-z]:|^\\\\|^\/\//i;
  const api = windows.test(cwd) ? win32 : posix;
  if (windows.test(target) && api !== win32) return true;
  if (api === win32 && posix.isAbsolute(target) && !windows.test(target)) return true;
  const relative = api.relative(api.resolve(cwd), api.resolve(effectiveDir, target));
  return relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative);
}
