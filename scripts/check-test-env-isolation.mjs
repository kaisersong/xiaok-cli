#!/usr/bin/env node
// Fails (exit 1) when the test suite is not isolated from host provider variables.
//
//   node scripts/check-test-env-isolation.mjs [--first-run]
//
// 1. Static: every vitest config must register tests/support/setup-host-env.
// 2. Dynamic: with fake provider keys exported, a canary test must start without
//    them under the default and the sandbox config (needs `npm run test:sandbox:build`).
// 3. Control: with XIAOK_TEST_ENV_STRICT=1 the same canary must FAIL (proves it is loud).
// 4. --first-run: the first-run login scenarios (kimi/glm/minimax) must pass with the keys exported.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
const netPatch = join(root, 'tests', 'support', 'vite-net-use-patch.cjs');
const LEAK = Object.fromEntries(['KIMI_API_KEY', 'GLM_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XIAOK_MINIMAX_API_KEY', 'ANTHROPIC_BASE_URL', 'TAVILY_API_KEY'].map(name => [name, 'leak-canary-not-a-real-key']));
const failures = [];
const log = message => process.stdout.write(`${message}\n`);

// 1. static wiring
const configs = [...readdirSync(root).filter(name => /^vitest.*\.config\.(ts|mjs|js)$/.test(name)), ...['desktop/vitest.config.ts'].filter(path => existsSync(join(root, path)))];
for (const config of configs) {
  const wired = /setup-host-env/.test(readFileSync(join(root, config), 'utf8'));
  log(`${wired ? 'ok  ' : 'FAIL'} static: ${config} ${wired ? 'registers' : 'does NOT register'} setup-host-env`);
  if (!wired) failures.push(`${config} is not wired to tests/support/setup-host-env`);
}

function run(label, args, extraEnv = {}, expectFailure = false) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...LEAK, ...extraEnv }, encoding: 'utf8', timeout: 600_000 });
  const passed = result.status === 0;
  const good = expectFailure ? !passed : passed;
  log(`${good ? 'ok  ' : 'FAIL'} ${label} (exit ${result.status}${expectFailure ? ', failure expected' : ''})`);
  if (!good) { failures.push(label); process.stdout.write(`${(result.stdout ?? '').slice(-3000)}\n${(result.stderr ?? '').slice(-1500)}\n`); }
}

// 2. dynamic canary
run('default config canary', [vitest, 'run', '--config', 'vitest.config.ts', 'tests/support/host-env-isolation.test.ts']);
const sandboxCanary = '.test-dist/tests/support/host-env-isolation.test.js';
if (!existsSync(join(root, sandboxCanary))) { log('FAIL sandbox canary missing; run `npm run test:sandbox:build` first'); failures.push('sandbox build missing'); }
else {
  const sandbox = ['-r', netPatch, vitest, 'run', '--no-cache', '--config', 'vitest.sandbox.config.mjs', '--configLoader', 'runner'];
  run('sandbox config canary', [...sandbox, sandboxCanary]);
  // 3. control
  run('strict-mode control (must fail loudly)', [...sandbox, sandboxCanary], { XIAOK_TEST_ENV_STRICT: '1' }, true);
  // 4. first-run login scenarios with the keys exported
  if (process.argv.includes('--first-run')) run('first-run login scenarios with keys exported', [...sandbox, '.test-dist/tests/commands/chat-interactive-runtime.test.js', '-t', 'continues first-run auto chat after selecting']);
}

if (failures.length > 0) { log(`\ntest env isolation check FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
log('\ntest env isolation check passed');
