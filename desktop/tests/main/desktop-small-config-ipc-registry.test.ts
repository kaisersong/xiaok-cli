// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
let facts: { initial: unknown[]; normal: unknown[]; aliasPersisted: boolean; getterReads: number; getterError: string; agentDenied: boolean; agentError: string; requests: number; outstanding: number; sourceDenials: Array<{ method: string; source: string; reads: number; error: string }> };
beforeAll(async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-small-config-')));
  const require = createRequire(import.meta.url);
  const script = fileURLToPath(new URL('../fixtures/small-config-owned-child/config-child.mts', import.meta.url));
  const preload = fileURLToPath(new URL('../fixtures/small-config-owned-child/account-preload.mjs', import.meta.url));
  let complete = false;
  try {
    const result = await promisify(execFile)(process.execPath, ['--import', require.resolve('tsx'), '--import', preload, script], {
      timeout: 15000, env: { ...process.env, XIAOK_SMALL_CONFIG_TEST_HOME: root, XIAOK_CONFIG_DIR: join(root, 'config'), XIAOK_DISABLE_GLOBAL_PLUGINS: '1', XIAOK_CONVERSATION_ACTIVITY: '0' },
    });
    const line = result.stdout.split('\n').find(value => value.startsWith('CONFIG_FACTS:'));
    expect(line).toBeDefined(); facts = JSON.parse(line!.slice('CONFIG_FACTS:'.length)); complete = true;
  } finally { if (complete) rmSync(root, { recursive: true, force: true }); }
}, 20000);
it('runs all four actual Main registrations and actual config read/write including original rounding', () => {
  expect(facts.initial).toEqual([{ enabled: false }, { maxConcurrentTasks: 3 }]);
  expect(facts.normal).toEqual([{ enabled: true }, { maxConcurrentTasks: 7 }, { maxConcurrentTasks: 7 }]);
  expect(facts.requests).toBe(0); expect(facts.outstanding).toBe(0);
});
it('captures before the config load yields so aliases cannot change the real saved value', () => { expect(facts.aliasPersisted).toBe(true); });
it('refuses a getter before reading it or writing configuration', () => { expect(facts.getterReads).toBe(0); expect(facts.getterError).toBe('desktop_config_input_invalid'); });
it('denies direct nonuser service mutation before any configuration IO', () => { expect(facts.agentDenied).toBe(true); expect(facts.agentError).toBe('desktop_config_request_source_forbidden'); });
it('denies both same-permission sibling setters for agent and scheduler before reading input', () => {
  expect(facts.sourceDenials).toEqual(['saveSkillDebugConfig', 'saveKswarmConfig'].flatMap(method => ['agent', 'scheduler'].map(source => ({ method, source, reads: 0, error: 'desktop_config_request_source_forbidden' }))));
});
