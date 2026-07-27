import { builtinModules, isBuiltin, registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.startsWith('node:') ? name : `node:${name}`),
]);

function fail(code, details = '') {
  throw new Error(details ? `${code}: ${details}` : code);
}

function within(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export function assertRuntimeGuardSupport(moduleApi = { registerHooks }) {
  if (typeof moduleApi.registerHooks !== 'function') {
    fail('KIMI_D9_GUARD_UNSUPPORTED');
  }
  return true;
}

function normalizeAllowedRealpaths(paths) {
  return new Set(paths.map((path) => realpathSync(resolve(path))));
}

export function createRuntimeGuardHooks(policy) {
  const closureRoot = realpathSync(resolve(policy.closureRoot));
  const allowedRealpaths = normalizeAllowedRealpaths(policy.allowedRealpaths ?? []);

  function assertResolvedUrl(url) {
    if (url.startsWith('node:') || isBuiltin(url) || BUILTINS.has(url)) {
      return;
    }
    if (!url.startsWith('file:')) {
      fail('KIMI_D9_GUARD_UNKNOWN_SCHEME', url);
    }
    const path = realpathSync(fileURLToPath(url));
    if (!within(closureRoot, path)) {
      fail('KIMI_D9_GUARD_RESOLUTION_ESCAPE', path);
    }
    if (!allowedRealpaths.has(path)) {
      fail('KIMI_D9_GUARD_GRAPH_MISMATCH', path);
    }
  }

  return {
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:') || isBuiltin(specifier) || BUILTINS.has(specifier)) {
        return nextResolve(specifier, context);
      }
      const resolution = nextResolve(specifier, context);
      assertResolvedUrl(resolution.url);
      return resolution;
    },
    load(url, context, nextLoad) {
      assertResolvedUrl(url);
      return nextLoad(url, context);
    },
  };
}

export function registerRuntimeGuard(policy, moduleApi = { registerHooks }) {
  assertRuntimeGuardSupport(moduleApi);
  const hooks = createRuntimeGuardHooks(policy);
  moduleApi.registerHooks(hooks);
  return hooks;
}

export async function digestGuardTree(guardRoot) {
  const { digestTree } = await import('./cli-closure-build.mjs');
  return (await digestTree(guardRoot, {
    closureRoot: resolve(guardRoot, '..', '..'),
  })).digest;
}

export async function verifyGuardTree(guardRoot, expectedDigest) {
  const actualDigest = await digestGuardTree(guardRoot);
  if (actualDigest !== expectedDigest) {
    fail('KIMI_D9_GUARD_DIGEST_MISMATCH');
  }
  return actualDigest;
}

if (process.env.XIAOK_D9_RUNTIME_GUARD_POLICY) {
  let policy;
  try {
    policy = JSON.parse(process.env.XIAOK_D9_RUNTIME_GUARD_POLICY);
  } catch {
    fail('KIMI_D9_GUARD_POLICY_INVALID');
  }
  registerRuntimeGuard(policy);
}
