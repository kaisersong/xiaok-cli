import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readKimiCodingModels } from '../../scripts/read-kimi-coding-models.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('readKimiCodingModels parses live KIMI_CODING_PROFILES keys', () => {
  const models = readKimiCodingModels();
  assert.ok(models.includes('k3'));
  assert.ok(models.includes('k3.1-pro'));
  assert.equal(models.length, new Set(models).size);
});

test('verify-packaged-kimi-smoke-result accepts matching result and rejects count drift', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-smoke-verify-'));
  try {
    const models = readKimiCodingModels();
    const resultPath = join(dir, 'result.json');
    writeFileSync(resultPath, JSON.stringify({
      schemaVersion: 1,
      status: 'pass',
      modelResults: models.map((model) => ({
        model,
        requests: 2,
        secondTurnReplayedReasoning: true,
      })),
      authorizationDenyNetworkRequests: 0,
      rollbackDenyNetworkRequests: 0,
    }));
    const ok = spawnSync('node', [join(root, 'scripts/verify-packaged-kimi-smoke-result.mjs'), resultPath, dir], {
      encoding: 'utf8',
    });
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);

    const bad = JSON.parse(readFileSync(resultPath, 'utf8'));
    bad.modelResults = bad.modelResults.slice(0, 1);
    writeFileSync(resultPath, JSON.stringify(bad));
    const fail = spawnSync('node', [join(root, 'scripts/verify-packaged-kimi-smoke-result.mjs'), resultPath], {
      encoding: 'utf8',
    });
    assert.notEqual(fail.status, 0);
    assert.match(fail.stderr, /modelResults\.length/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-desktop-sibling-pins passes on current workflows', () => {
  const result = spawnSync('node', [join(root, 'scripts/check-desktop-sibling-pins.mjs')], {
    encoding: 'utf8',
    cwd: root,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /matches desktop-release/);
});
