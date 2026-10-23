// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
let facts: { baselineMethods: string[]; negative: Array<{ name: string; pass: boolean; reads?: number; outputReads?: number }> };
beforeAll(async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-model-config-')));
  let completed = false;
  try {
    const require = createRequire(import.meta.url);
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', require.resolve('tsx'), '--import', fileURLToPath(new URL('../fixtures/model-provider-owned-child/account-preload.mjs', import.meta.url)), fileURLToPath(new URL('../fixtures/model-provider-owned-child/config-child.mts', import.meta.url))], {
      timeout: 12000, env: { ...process.env, XIAOK_MODEL_CONFIG_TEST_HOME: root, XIAOK_DISABLE_GLOBAL_PLUGINS: '1', XIAOK_CONVERSATION_ACTIVITY: '0' },
    });
    const line = stdout.split('\n').find(line => line.startsWith('MODEL_FACTS:'));
    expect(line).toBeDefined(); facts = JSON.parse(line!.slice('MODEL_FACTS:'.length)); completed = true;
  } finally { if (completed) rmSync(root, { recursive: true, force: true }); }
}, 15000);
it('runs all original ten actual Main delegates and actual services, config and managed-agent HTTP producer', () => {
  expect(facts.baselineMethods).toEqual(['getModelConfig', 'saveModelConfig', 'updateModelRuntimeOptions', 'getSystemOneConfig', 'saveSystemOneConfig', 'listAvailableModelsForProvider', 'testProviderConnection', 'createManagedXiaokAgent', 'deleteModel', 'deleteProvider']);
});
it.each([0, 1, 2, 3, 4, 5, 6, 7])('preserves real field/source/output boundary control %i', index => {
  expect(facts.negative[index]).toMatchObject({ pass: true });
});
