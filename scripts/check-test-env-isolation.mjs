#!/usr/bin/env node
// Fails (exit 1) when the test suite is not really isolated from host provider variables.
//
//   node scripts/check-test-env-isolation.mjs [--first-run] [--require-desktop]
//   node scripts/check-test-env-isolation.mjs --config <file> --run-dir <dir> [--canary <test file>]   (check one config)
//
// For every vitest config (the registered list below; an unregistered vitest*.config.* fails the check):
//   1. STATIC  – load the config with vite's own loader (not text matching), resolve every `setupFiles`
//                entry against the directory vitest is run from, require that it exists and lies INSIDE
//                that directory (vite refuses to load a setup file outside its root: "Cannot find module").
//   2. DYNAMIC – run vitest from that directory with fake provider keys exported; the canary test must
//                see none of them (the setup file really loaded and stripped them).
//   3. CONTROL – the same canary with XIAOK_TEST_ENV_STRICT=1 must FAIL (the check is loud).
// --first-run additionally runs the first-run login scenarios (kimi/glm/minimax) with the keys exported.
// Desktop dependencies are not installed in every CI job: without them the desktop DYNAMIC part is reported
// SKIPPED (never silently passed); --require-desktop turns that into a failure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootRequire = createRequire(join(root, 'package.json'));
const LEAK = Object.fromEntries(['KIMI_API_KEY', 'GLM_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XIAOK_MINIMAX_API_KEY', 'ANTHROPIC_BASE_URL', 'TAVILY_API_KEY'].map(name => [name, 'leak-canary-not-a-real-key']));
const SANDBOX_CANARY = '.test-dist/tests/support/host-env-isolation.test.js';
const SANDBOX_FLAGS = ['-r', join(root, 'tests', 'support', 'vite-net-use-patch.cjs')];
const SANDBOX_ARGS = ['--no-cache', '--configLoader', 'runner'];

/** Every config in the repo, the directory vitest is run from (per the npm scripts) and its canary. */
export const REGISTERED = [
  { config: 'vitest.config.ts', runDir: '.', canary: 'tests/support/host-env-isolation.test.ts' },                         // npm run test:full
  { config: 'vitest.sandbox.config.mjs', runDir: '.', canary: SANDBOX_CANARY, sandbox: true },                            // npm run test:sandbox:run
  { config: 'vitest.skill-release.config.mjs', runDir: '.', canary: SANDBOX_CANARY, sandbox: true },                      // npm run test:skill:release:run
  { config: 'desktop/vitest.config.ts', runDir: 'desktop', canary: 'tests/host-env-isolation.test.ts', desktop: true },     // cd desktop && npm run test
];

const log = message => process.stdout.write(`${message}\n`);
const inside = (dir, file) => { const rel = relative(dir, file); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

async function loadSetupFiles(configFile) {
  const { loadConfigFromFile } = await import(pathToFileURL(rootRequire.resolve('vite')).href);
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile, dirOf(configFile));
  if (!loaded) throw new Error(`could not load ${configFile}`);
  const value = typeof loaded.config === 'function' ? await loaded.config({ command: 'serve', mode: 'test' }) : loaded.config;
  const setup = value?.test?.setupFiles;
  return Array.isArray(setup) ? setup : setup ? [setup] : [];
}
const dirOf = file => resolve(file, '..');

/** STATIC part. Returns a list of problems (empty = ok). */
export async function checkSetupFiles({ config, runDir, expectCompiled }) {
  const problems = [];
  let entries;
  try { entries = await loadSetupFiles(config); } catch (error) { return [`cannot load config: ${error instanceof Error ? error.message : error}`]; }
  if (entries.length === 0) return ['config has no test.setupFiles'];
  let reachesIsolation = false;
  for (const entry of entries) {
    const resolved = resolve(runDir, String(entry));
    if (!inside(runDir, resolved)) { problems.push(`setupFiles entry ${entry} resolves to ${resolved}, outside the directory vitest runs from (${runDir})`); continue; }
    if (!existsSync(resolved)) { problems.push(`setupFiles entry ${entry} does not exist (${resolved})${expectCompiled ? '; run npm run test:sandbox:build first' : ''}`); continue; }
    reachesIsolation = true;
  }
  if (!reachesIsolation && problems.length === 0) problems.push('no usable setupFiles entry');
  return problems;
}

function vitestBin(runDir, { own = false } = {}) {
  // `own`: vitest must come from runDir/node_modules itself (Desktop has its own dependency set; the root vitest lacks jsdom).
  if (own && !existsSync(join(runDir, 'node_modules', 'vitest', 'package.json'))) return undefined;
  try { return join(createRequire(join(runDir, 'package.json')).resolve('vitest/package.json'), '..', 'vitest.mjs'); } catch { return undefined; }
}

function run(label, runDir, bin, flags, args, extraEnv, expectFailure) {
  const result = spawnSync(process.execPath, [...flags, bin, 'run', ...args], { cwd: runDir, env: { ...process.env, ...LEAK, ...extraEnv }, encoding: 'utf8', timeout: 600_000 });
  const good = expectFailure ? result.status !== 0 : result.status === 0;
  log(`${good ? 'ok  ' : 'FAIL'} ${label} (exit ${result.status}${expectFailure ? ', failure expected' : ''})`);
  if (!good) log(`${(result.stdout ?? '').slice(-2500)}\n${(result.stderr ?? '').slice(-1200)}`);
  return good;
}

/** DYNAMIC + CONTROL parts for one config. Returns problems. */
function checkCanary({ config, runDir, canary, sandbox, desktop }) {
  const bin = vitestBin(runDir, { own: Boolean(desktop) });
  if (!bin || !existsSync(bin)) return { skipped: `vitest dependencies are not installed in ${relative(root, runDir) || '.'}` };
  const canaryFile = resolve(runDir, canary);
  if (!existsSync(canaryFile)) return { problems: [`canary ${canary} does not exist${sandbox ? '; run npm run test:sandbox:build first' : ''}`] };
  // The wrapper widens `include` to the canary only, so configs that list a single test file can be exercised too.
  const configDir = dirOf(config);
  const wrapper = join(configDir, `.env-check-${process.pid}-${Date.now()}.config.mjs`);
  writeFileSync(wrapper, `import { mergeConfig } from 'vitest/config';\nimport base from './${config.split(sep).pop()}';\nexport default mergeConfig(base, { test: { include: [${JSON.stringify(relative(runDir, canaryFile).split(sep).join('/'))}] } });\n`);
  const flags = sandbox ? SANDBOX_FLAGS : [];
  const args = [...(sandbox ? SANDBOX_ARGS : []), '--config', wrapper, relative(runDir, canaryFile).split(sep).join('/')];
  const name = relative(root, config) || config;
  try {
    const problems = [];
    if (!run(`${name}: canary starts without leaked provider keys (run from ${relative(root, runDir) || '.'})`, runDir, bin, flags, args, {}, false)) problems.push(`${name}: canary failed`);
    if (!run(`${name}: strict-mode control fails loudly`, runDir, bin, flags, args, { XIAOK_TEST_ENV_STRICT: '1' }, true)) problems.push(`${name}: strict-mode control did not fail`);
    return { problems };
  } finally { rmSync(wrapper, { force: true }); }
}

/** Check a single config; returns { problems, skipped }. Exported for the regression test (via --config). */
export async function checkConfig(entry, { requireDesktop = false } = {}) {
  const config = resolve(root, entry.config);
  const runDir = resolve(root, entry.runDir);
  const label = relative(root, config) || entry.config;
  const problems = (await checkSetupFiles({ config, runDir, expectCompiled: entry.sandbox })).map(p => `${label}: ${p}`);
  log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} static: ${label} (run from ${relative(root, runDir) || '.'})${problems.length ? `\n     - ${problems.join('\n     - ')}` : ''}`);
  if (problems.length > 0) return { problems };
  const dynamic = checkCanary({ ...entry, config, runDir });
  if (dynamic.skipped) {
    log(`${requireDesktop || !entry.desktop ? 'FAIL' : 'SKIP'} dynamic: ${label}: ${dynamic.skipped} (未测)`);
    return { problems: requireDesktop || !entry.desktop ? [`${label}: ${dynamic.skipped}`] : [], skipped: dynamic.skipped };
  }
  return { problems: dynamic.problems };
}

function unregisteredConfigs() {
  const known = new Set(REGISTERED.map(entry => entry.config));
  const found = [];
  for (const dir of ['.', 'desktop']) for (const name of readdirSync(join(root, dir))) {
    if (/^vitest.*\.config\.(ts|mts|mjs|js|cjs)$/.test(name)) { const rel = dir === '.' ? name : `${dir}/${name}`; if (!known.has(rel)) found.push(rel); }
  }
  return found;
}

function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function main() {
  const failures = [];
  const single = arg('--config');
  if (single) {
    const result = await checkConfig({ config: single, runDir: arg('--run-dir') ?? '.', canary: arg('--canary') ?? 'tests/support/host-env-isolation.test.ts', sandbox: process.argv.includes('--sandbox') });
    failures.push(...result.problems);
  } else {
    for (const config of unregisteredConfigs()) failures.push(`${config} is not registered in scripts/check-test-env-isolation.mjs (add it with its run directory and canary)`);
    for (const entry of REGISTERED) failures.push(...(await checkConfig(entry, { requireDesktop: process.argv.includes('--require-desktop') })).problems);
    if (process.argv.includes('--first-run') && failures.length === 0) {
      const bin = vitestBin(root);
      if (!run('first-run login scenarios with keys exported', root, bin, SANDBOX_FLAGS, [...SANDBOX_ARGS, '--config', 'vitest.sandbox.config.mjs', '.test-dist/tests/commands/chat-interactive-runtime.test.js', '-t', 'continues first-run auto chat after selecting'], {}, false)) failures.push('first-run login scenarios failed');
    }
  }
  if (failures.length > 0) { log(`\ntest env isolation check FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
  log('\ntest env isolation check passed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
