import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCliStratumPlan,
  runCliProductSession,
} from './kimi-k3-d9/cli-driver.mjs';

const REQUIRED_OPTIONS = Object.freeze([
  'closure-manifest',
  'closure-manifest-hash',
  'plan',
  'product-config',
  'mcp-settings',
  'profile',
  'arm',
  'preserved-thinking',
  'tmux',
  'timeout-ms',
]);
const OPTIONAL_OPTIONS = Object.freeze([
  'session-root-parent',
  'preserve-session-root',
]);
const PATH_OPTIONS = Object.freeze([
  'closure-manifest',
  'plan',
  'product-config',
  'mcp-settings',
  'tmux',
]);

function fail(code) {
  throw new Error(code);
}

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
}

export function parseD9LiveArmArgs(argv) {
  if (!Array.isArray(argv)) {
    fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  }
  if (argv.includes('--product-root')) {
    fail('KIMI_D9_LEGACY_PRODUCT_ROOT_FORBIDDEN');
  }
  if (argv.length % 2 !== 0) {
    fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  }

  const allowed = new Set([...REQUIRED_OPTIONS, ...OPTIONAL_OPTIONS]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      typeof key !== 'string'
      || !key.startsWith('--')
      || !allowed.has(key.slice(2))
      || values.has(key.slice(2))
      || typeof value !== 'string'
      || value.length === 0
    ) {
      fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
    }
    values.set(key.slice(2), value);
  }
  if (REQUIRED_OPTIONS.some(key => !values.has(key))) {
    fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  }
  if (
    PATH_OPTIONS.some(key => !isAbsolute(values.get(key)))
    || (
      values.has('session-root-parent')
      && !isAbsolute(values.get('session-root-parent'))
    )
    || !/^[0-9a-f]{64}$/u.test(values.get('closure-manifest-hash'))
    || !['k3', 'k3-256k'].includes(values.get('profile'))
    || !['baseline', 'candidate'].includes(values.get('arm'))
  ) {
    fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  }
  const timeoutMs = Number(values.get('timeout-ms'));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  }
  const preservedThinking = parseBoolean(
    values.get('preserved-thinking'),
  );
  const preserveSessionRoot = values.has('preserve-session-root')
    ? parseBoolean(values.get('preserve-session-root'))
    : false;
  if (preservedThinking !== (values.get('arm') === 'candidate')) {
    fail('KIMI_D9_LIVE_ARM_ARGUMENT_INVALID');
  }

  return Object.freeze({
    closureManifestPath: values.get('closure-manifest'),
    closureManifestHash: values.get('closure-manifest-hash'),
    planPath: values.get('plan'),
    productConfigPath: values.get('product-config'),
    mcpSettingsPath: values.get('mcp-settings'),
    profile: values.get('profile'),
    arm: values.get('arm'),
    preservedThinking,
    tmuxExecutable: values.get('tmux'),
    timeoutMs,
    sessionRootParent: values.get('session-root-parent'),
    preserveSessionRoot,
  });
}

async function readJson(path) {
  const bytes = await readFile(path);
  if (bytes.length === 0 || bytes.length > 1_048_576) {
    fail('KIMI_D9_LIVE_ARM_INPUT_INVALID');
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('KIMI_D9_LIVE_ARM_INPUT_INVALID');
  }
}

export async function runD9LiveArm(argv) {
  const args = parseD9LiveArmArgs(argv);
  const [
    planInput,
    productConfigBytes,
    mcpSettingsBytes,
  ] = await Promise.all([
    readJson(args.planPath),
    readFile(args.productConfigPath),
    readFile(args.mcpSettingsPath),
  ]);
  const result = await runCliProductSession({
    ...args,
    plan: createCliStratumPlan(planInput),
    productConfigBytes,
    mcpSettingsBytes,
  });
  return result.evidence;
}

async function main(argv) {
  const evidence = await runD9LiveArm(argv);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (evidence.status !== 'completed') {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  await main(process.argv.slice(2));
}
