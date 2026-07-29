import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { verifyGuardTree } from './runtime-guard.mjs';

const execFileAsync = promisify(execFile);

const FORBIDDEN_ENVIRONMENT = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'DYLD_LIBRARY_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
]);

const ALLOWED_ENVIRONMENT = new Set([
  'HOME',
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XIAOK_CONFIG_DIR',
  'KIMI_API_KEY',
  'XIAOK_D9_RUNTIME_GUARD_POLICY',
  'LANG',
  'LC_ALL',
  'TERM',
]);

function fail(code, details = '') {
  throw new Error(details ? `${code}: ${details}` : code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function within(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

async function realpathWithin(root, path, code) {
  const resolvedPath = await realpath(resolve(path)).catch(() => fail(code, path));
  if (!within(root, resolvedPath)) {
    fail(code, resolvedPath);
  }
  return resolvedPath;
}

function buildEnvironment(input) {
  const environment = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    if (FORBIDDEN_ENVIRONMENT.has(name) && value !== '') {
      fail('KIMI_D9_LAUNCH_ENV_INJECTION', name);
    }
    if (!FORBIDDEN_ENVIRONMENT.has(name) && !ALLOWED_ENVIRONMENT.has(name)) {
      fail('KIMI_D9_LAUNCH_ENV_NOT_ALLOWED', name);
    }
    if (value !== undefined) {
      environment[name] = String(value);
    }
  }
  environment.NODE_OPTIONS = '';
  environment.NODE_PATH = '';
  environment.DYLD_LIBRARY_PATH = '';
  environment.DYLD_FALLBACK_LIBRARY_PATH = '';
  environment.DYLD_INSERT_LIBRARIES = '';
  return environment;
}

async function defaultNodeRuntimeProbe(nodeExecutable) {
  const expression = [
    'JSON.stringify({',
    'nodeVersion:process.version,',
    'modulesAbi:process.versions.modules,',
    'nodeApi:process.versions.napi,',
    'platform:process.platform,',
    'arch:process.arch,',
    "registerHooksType:typeof require('node:module').registerHooks",
    '})',
  ].join('');
  const { stdout } = await execFileAsync(nodeExecutable, ['-p', expression], {
    encoding: 'utf8',
    env: {
      NODE_OPTIONS: '',
      NODE_PATH: '',
      DYLD_LIBRARY_PATH: '',
      DYLD_FALLBACK_LIBRARY_PATH: '',
      DYLD_INSERT_LIBRARIES: '',
    },
  });
  return JSON.parse(stdout.trim());
}

export async function probeNodeLaunchContract(nodeExecutable, options = {}) {
  const processExecPathRealpath = await realpath(resolve(nodeExecutable)).catch(() =>
    fail('KIMI_D9_LAUNCH_NODE_OUTSIDE_CLOSURE', nodeExecutable));
  const processExecPathSha256 = sha256(await readFile(processExecPathRealpath));
  const probe = options.probe ?? defaultNodeRuntimeProbe;
  const runtime = await probe(processExecPathRealpath);
  if (runtime.registerHooksType !== 'function') {
    fail('KIMI_D9_GUARD_UNSUPPORTED');
  }
  return {
    processExecPathRealpath,
    processExecPathSha256,
    nodeVersion: runtime.nodeVersion,
    modulesAbi: String(runtime.modulesAbi),
    nodeApi: String(runtime.nodeApi),
    platform: runtime.platform,
    arch: runtime.arch,
    registerHooksType: runtime.registerHooksType,
  };
}

function verifyNodeLaunchContract(actual, expected) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (actual[field] !== expectedValue) {
      fail('KIMI_D9_NODE_LAUNCH_CONTRACT_MISMATCH', field);
    }
  }
}

export async function createLaunchSpec(input) {
  const closureRoot = await realpath(resolve(input.closureRoot)).catch(() =>
    fail('KIMI_D9_LAUNCH_CLOSURE_MISSING'));
  const command = await realpathWithin(
    closureRoot,
    input.nodeExecutable,
    'KIMI_D9_LAUNCH_NODE_OUTSIDE_CLOSURE',
  );
  if (input.expectedNodeLaunchContract) {
    const actualNodeLaunchContract = await probeNodeLaunchContract(command, {
      probe: input.nodeRuntimeProbe,
    });
    verifyNodeLaunchContract(
      actualNodeLaunchContract,
      input.expectedNodeLaunchContract,
    );
  }
  const entry = await realpathWithin(
    closureRoot,
    resolve(closureRoot, input.entryRelativePath),
    'KIMI_D9_LAUNCH_ENTRY_OUTSIDE_CLOSURE',
  );
  const guard = await realpathWithin(
    closureRoot,
    resolve(closureRoot, input.guardRelativePath),
    'KIMI_D9_LAUNCH_GUARD_OUTSIDE_CLOSURE',
  );
  const guardRoot = resolve(guard, '..');
  if (input.expectedGuardTreeDigest) {
    await verifyGuardTree(guardRoot, input.expectedGuardTreeDigest);
  }

  const env = buildEnvironment(input.allowedEnvironment);
  const policy = input.runtimeGuardPolicy ?? {
    closureRoot,
    allowedRealpaths: [entry],
  };
  env.XIAOK_D9_RUNTIME_GUARD_POLICY = JSON.stringify(policy);

  return {
    command,
    args: [
      '--no-global-search-paths',
      '--import',
      guard,
      entry,
      ...(input.args ?? []),
    ],
    cwd: closureRoot,
    env,
  };
}

export async function launchCli(input) {
  const spec = await createLaunchSpec(input);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: input.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      resolvePromise({ child, code, signal, spec });
    });
  });
}
