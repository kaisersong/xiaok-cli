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

function matchesPrefix(prefixes: string[], value: string): boolean {
  return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
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
