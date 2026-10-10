import { resolve, win32 } from 'node:path';
import { resolveRealPath } from '../../ai/permissions/workspace.js';

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

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * 比较前先规范化：resolve 消除 `.`/`..`，再用 realpath（不存在时取最近已存在父目录）解析符号链接，
 * 最后统一分隔符。非 Windows 主机上遇到 Windows 风格绝对路径时只做词法规范化。
 */
function canonicalizePathForMatch(path: string): string {
  if (process.platform !== 'win32' && WINDOWS_ABSOLUTE_PATH.test(path)) {
    return normalizePathForMatch(win32.resolve(path));
  }
  return normalizePathForMatch(resolveRealPath(resolve(path)));
}

function matchesPrefix(prefixes: string[], value: string): boolean {
  if (prefixes.length === 0) return false;
  const normalizedValue = canonicalizePathForMatch(value);
  return prefixes.some((prefix) => {
    const normalizedPrefix = canonicalizePathForMatch(prefix);
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
      try {
        if (matchesPrefix(denylist, path)) {
          return { allowed: false, reason: 'path is explicitly denied' };
        }
        if (allowlist.length > 0 && !matchesPrefix(allowlist, path)) {
          return { allowed: false, reason: 'path is outside allowlist' };
        }
        return { allowed: true };
      } catch {
        // 无法规范化的路径（含 NUL、符号链接环等）一律拒绝（fail-closed）
        return { allowed: false, reason: 'path could not be normalized' };
      }
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
