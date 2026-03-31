export type PermissionMode = 'default' | 'auto' | 'plan';
export type PermissionDecision = 'allow' | 'deny' | 'prompt';

export interface PermissionManagerOptions {
  mode: PermissionMode;
  allowRules?: string[];
  denyRules?: string[];
}

export class PermissionManager {
  private mode: PermissionMode;
  private allowRules: string[];
  private denyRules: string[];

  constructor(options: PermissionManagerOptions) {
    this.mode = options.mode;
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
    if (this.matches(this.denyRules, toolName, input)) {
      return 'deny';
    }

    if (this.mode === 'plan' && ['write', 'edit', 'bash'].includes(toolName)) {
      return 'deny';
    }

    if (this.mode === 'auto') {
      return 'allow';
    }

    if (['read', 'glob', 'grep', 'skill', 'tool_search'].includes(toolName)) {
      return 'allow';
    }

    if (this.matches(this.allowRules, toolName, input)) {
      return 'allow';
    }

    return 'prompt';
  }

  private matches(rules: string[], toolName: string, input: Record<string, unknown>): boolean {
    return rules.some((rule) => {
      const [ruleTool, pattern = '*'] = rule.includes(':') ? rule.split(':', 2) : [toolName, rule];
      if (ruleTool !== toolName) {
        return false;
      }

      const target = this.getRuleTarget(input);
      const regex = new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      );
      return regex.test(target);
    });
  }

  private getRuleTarget(input: Record<string, unknown>): string {
    if (typeof input.command === 'string') {
      return input.command;
    }

    if (typeof input.file_path === 'string') {
      return input.file_path;
    }

    if (typeof input.path === 'string') {
      return input.path;
    }

    return '';
  }
}
