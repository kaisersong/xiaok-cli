export interface SandboxPolicyOptions {
  pathAllowlist?: string[];
  allowedPaths?: Set<string> | string[];
  pathDenylist?: string[];
  allowedEnv?: string[];
  network?: 'allow' | 'deny';
}

export interface SandboxDecision {
  allowed: boolean;
  reason?: string;
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '');
}

function matchesPrefix(prefixes: string[], value: string): boolean {
  const normalizedValue = normalizePathForMatch(value);
  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizePathForMatch(prefix);
    return normalizedValue === normalizedPrefix || normalizedValue.startsWith(`${normalizedPrefix}/`);
  });
}

export function extractSandboxAllowedPaths(rules: string[]): string[] {
  const prefixes: string[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const match = rule.match(/^sandbox-expand:[^(]+\((.*)\)$/i);
    if (!match) {
      continue;
    }

    let pattern = match[1]?.trim() ?? '';
    if (!pattern || pattern === '*') {
      continue;
    }

    if (pattern.endsWith('/*') || pattern.endsWith('\\*')) {
      pattern = pattern.slice(0, -2);
    }

    if (!pattern || seen.has(pattern)) {
      continue;
    }

    seen.add(pattern);
    prefixes.push(pattern);
  }

  return prefixes;
}

export function createSandboxPolicy(options: SandboxPolicyOptions) {
  const legacyAllowlist = options.allowedPaths
    ? Array.from(options.allowedPaths)
    : [];
  const allowlist = [...(options.pathAllowlist ?? legacyAllowlist)];
  const denylist = options.pathDenylist ?? [];
  const allowedEnv = new Set(options.allowedEnv ?? []);

  return {
    checkPath(path: string): SandboxDecision {
      if (matchesPrefix(denylist, path)) {
        return { allowed: false, reason: 'path is explicitly denied' };
      }
      if (allowlist.length > 0 && !matchesPrefix(allowlist, path)) {
        return { allowed: false, reason: 'path is outside allowlist' };
      }
      return { allowed: true };
    },

    filterEnv(env: Record<string, string>): Record<string, string> {
      return Object.fromEntries(Object.entries(env).filter(([key]) => allowedEnv.has(key)));
    },

    checkNetworkAccess(): SandboxDecision {
      return options.network === 'deny'
        ? { allowed: false, reason: 'network access disabled by sandbox policy' }
        : { allowed: true };
    },

    expandAllowedPaths(paths: string[]): void {
      for (const path of paths) {
        if (!allowlist.includes(path)) {
          allowlist.push(path);
        }
      }
    },
  };
}
