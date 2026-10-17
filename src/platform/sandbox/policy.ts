import {types} from 'node:util';
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

const readonlyPolicyProofs=new WeakMap<object,()=>boolean>();
const arrayPrototype=Array.prototype, some=arrayPrototype.some, includes=arrayPrototype.includes, push=arrayPrototype.push;
const stringReplace=String.prototype.replace;
function safeRuleArray(value:unknown):boolean{
 if(!value||typeof value!=='object'||types.isProxy(value)||!Array.isArray(value)||Object.getPrototypeOf(value)!==arrayPrototype)return false;
 if(arrayPrototype.some!==some||arrayPrototype.includes!==includes||arrayPrototype.push!==push||String.prototype.replace!==stringReplace)return false;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 return Reflect.ownKeys(descriptors).every(key=>key==='length'||typeof key==='string'&&/^(0|[1-9][0-9]*)$/.test(key)&&'value' in descriptors[key]&&typeof descriptors[key].value==='string');
}
function safeNetworkOption(options:object):boolean{
 if(types.isProxy(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))return false;
 const descriptor=Object.getOwnPropertyDescriptor(options,'network');
 if(!descriptor)return Object.getOwnPropertyDescriptor(Object.prototype,'network')===undefined;
 return 'value' in descriptor&&[undefined,'allow','deny'].includes(descriptor.value);
}
export function isReadonlySandboxPolicy(policy:unknown):boolean{
 if(!policy||typeof policy!=='object')return false;
 const proof=readonlyPolicyProofs.get(policy);return proof?.()===true;
}
export function createSandboxPolicy(options: SandboxPolicyOptions) {
  const legacyAllowlist = options.allowedPaths
    ? Array.from(options.allowedPaths)
    : [];
  const allowlist = [...(options.pathAllowlist ?? legacyAllowlist)];
  const denylist = options.pathDenylist ?? [];
  const allowedEnv = new Set(options.allowedEnv ?? []);

  const policy = {
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
  const functions=Object.getOwnPropertyDescriptors(policy), prototype=Object.getPrototypeOf(policy);
  readonlyPolicyProofs.set(policy,()=>{
    if(Object.getPrototypeOf(policy)!==prototype||Reflect.ownKeys(policy).length!==Reflect.ownKeys(functions).length)return false;
    for(const key of Object.keys(functions)){const current=Object.getOwnPropertyDescriptor(policy,key);if(!current||!('value' in current)||current.value!==functions[key].value)return false;}
    return safeRuleArray(allowlist)&&safeRuleArray(denylist)&&safeNetworkOption(options);
  });
  return policy;
}
