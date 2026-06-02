export interface PermissionPolicySnapshot {
  globalAllow: string[];
  globalDeny: string[];
  projectAllow: string[];
  projectDeny: string[];
  sessionAllow: string[];
  sessionDeny: string[];
}

export interface PermissionPolicyDecision {
  action: 'allow' | 'deny' | 'prompt';
  rule: string;
}

export class PermissionPolicyEngine {
  constructor(private readonly snapshot: PermissionPolicySnapshot) {}

  async evaluate(toolName: string, input: Record<string, unknown>): Promise<PermissionPolicyDecision> {
    const target = getRuleTarget(input);
    const rule = target ? `${toolName}:${target}` : toolName;
    const denyRules = [
      ...this.snapshot.globalDeny,
      ...this.snapshot.projectDeny,
      ...this.snapshot.sessionDeny,
    ];
    const allowRules = [
      ...this.snapshot.globalAllow,
      ...this.snapshot.projectAllow,
      ...this.snapshot.sessionAllow,
    ];

    if (matches(denyRules, toolName, input)) {
      return { action: 'deny', rule };
    }
    if (matches(allowRules, toolName, input)) {
      return { action: 'allow', rule };
    }
    return { action: 'prompt', rule };
  }
}

export function matches(rules: string[], toolName: string, input: Record<string, unknown>): boolean {
  return rules.some((rule) => {
    const parenMatch = rule.match(/^([a-z_]+)\((.*)\)$/i);
    const colonMatch = parenMatch ? null : rule.match(/^([a-z_]+):(.*)$/i);
    const [ruleTool, pattern = '*'] = colonMatch
      ? [colonMatch[1], colonMatch[2]]
      : parenMatch
        ? [parenMatch[1], parenMatch[2]]
        : [toolName, rule];
    if (ruleTool !== toolName) {
      return false;
    }

    const rawTarget = getRuleTarget(input);
    const [normalizedPattern, target] = usesPathTarget(input)
      ? [normalizePathSeparators(pattern), normalizePathSeparators(rawTarget)]
      : [pattern, rawTarget];
    const regex = buildRuleRegex(normalizedPattern);
    return regex.test(target);
  });
}

function usesPathTarget(input: Record<string, unknown>): boolean {
  return typeof input.file_path === 'string' || typeof input.path === 'string';
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

export function buildRuleRegex(pattern: string): RegExp {
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    return new RegExp(`^${prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}(?: [\\s\\S]*)?$`);
  }

  return new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*')}$`,
  );
}

export function getRuleTarget(input: Record<string, unknown>): string {
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
