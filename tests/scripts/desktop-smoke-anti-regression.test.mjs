/**
 * Anti-regression for #126 / #127:
 * - model list must come from an independent KIMI_CODING_PROFILES source (not a
 *   self-proving hardcoded literal of the live 4 models)
 * - sibling pin checker must fail when ANY clone drifts (including release's
 *   second build-windows block)
 * - verify script must honor --models-source / KIMI_CODING_MODELS_SOURCE
 *
 * Mac full packaged smoke is intentionally out of scope for this PR (product);
 * freeze gate still requires manual Mac/Windows packaged smoke.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readKimiCodingModels } from '../../scripts/read-kimi-coding-models.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const PIN_SCRIPT = join(root, 'scripts/check-desktop-sibling-pins.mjs');
const VERIFY_SCRIPT = join(root, 'scripts/verify-packaged-kimi-smoke-result.mjs');

const PIN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PIN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PIN_C = 'cccccccccccccccccccccccccccccccccccccccc';
const PIN_BAD = '1111111111111111111111111111111111111111';

function profilesFixture(models) {
  const body = models.map((m) => `  '${m}': '${m}-wire',`).join('\n');
  return `export const KIMI_CODING_PROFILES = Object.freeze({\n${body}\n} as const);\n`;
}

// #150 M6: what the packaged app writes after cut('南京市长江大桥') through the worker.
function passingSegmentation(overrides = {}) {
  const unpacked = 'C:\\a\\win-unpacked\\resources\\app.asar.unpacked\\node_modules\\nodejieba';
  return {
    status: 'pass',
    sample: '南京市长江大桥',
    expected: '南京市 长江大桥',
    output: '南京市 长江大桥',
    elapsedMs: 812,
    workerEntry: `${unpacked}\\index.js`,
    nativeBinding: `${unpacked}\\build\\Release\\nodejieba.node`,
    dictionaryDir: `${unpacked}\\submodules\\cppjieba\\dict`,
    ...overrides,
  };
}

function cloneBlock(pins) {
  // pins: { plugins, kswarm, broker } — null means unpinned shallow clone
  const lines = [];
  for (const [repo, sha] of [
    ['kai-xiaok-plugins', pins.plugins],
    ['kswarm', pins.kswarm],
    ['intent-broker', pins.broker],
  ]) {
    lines.push(`git clone --no-checkout --depth 1 https://github.com/kaisersong/${repo}.git ../${repo}`);
    if (sha) {
      lines.push(`git -C ../${repo} fetch --depth 1 origin ${sha}`);
      lines.push(`git -C ../${repo} checkout --detach FETCH_HEAD`);
    }
  }
  return lines.join('\n');
}

function writeWorkflowPair(dir, { releaseBlocks, crossBlocks }) {
  const wfDir = join(dir, '.github', 'workflows');
  mkdirSync(wfDir, { recursive: true });
  const release = releaseBlocks
    .map((pins, i) => `  job-${i}:\n    steps:\n      - run: |\n${cloneBlock(pins).split('\n').map((l) => `          ${l}`).join('\n')}`)
    .join('\n');
  const cross = crossBlocks
    .map((pins, i) => `  job-${i}:\n    steps:\n      - run: |\n${cloneBlock(pins).split('\n').map((l) => `          ${l}`).join('\n')}`)
    .join('\n');
  const releasePath = join(wfDir, 'desktop-release.yml');
  const crossPath = join(wfDir, 'desktop-cross-platform.yml');
  writeFileSync(releasePath, `jobs:\n${release}\n`);
  writeFileSync(crossPath, `jobs:\n${cross}\n`);
  return { releasePath, crossPath };
}

function runPinCheck(releasePath, crossPath) {
  return spawnSync('node', [PIN_SCRIPT, '--release', releasePath, '--cross', crossPath], {
    encoding: 'utf8',
  });
}

test('readKimiCodingModels parses live KIMI_CODING_PROFILES keys', () => {
  const models = readKimiCodingModels();
  assert.ok(models.includes('k3'));
  assert.ok(models.includes('k3.1-pro'));
  assert.equal(models.length, new Set(models).size);
});

test('readKimiCodingModels follows independent source fixture (kills literal-4-model mutation)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-models-fx-'));
  try {
    const fixture = join(dir, 'kimi-models.ts');
    writeFileSync(fixture, profilesFixture(['fx-alpha', 'fx-beta']));
    assert.deepEqual(readKimiCodingModels(fixture), ['fx-alpha', 'fx-beta']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-packaged-kimi-smoke-result honors --models-source fixture (kills hardcoded expected mutation)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-smoke-verify-fx-'));
  try {
    const modelsPath = join(dir, 'kimi-models.ts');
    writeFileSync(modelsPath, profilesFixture(['fx-alpha', 'fx-beta']));
    const resultPath = join(dir, 'result.json');
    writeFileSync(
      resultPath,
      JSON.stringify({
        schemaVersion: 1,
        status: 'pass',
        modelResults: ['fx-alpha', 'fx-beta'].map((model) => ({
          model,
          requests: 2,
          secondTurnReplayedReasoning: true,
        })),
        authorizationDenyNetworkRequests: 0,
        rollbackDenyNetworkRequests: 0,
        segmentation: passingSegmentation(),
      }),
    );
    const ok = spawnSync(
      'node',
      [VERIFY_SCRIPT, resultPath, dir, '--models-source', modelsPath],
      { encoding: 'utf8' },
    );
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    assert.match(ok.stdout, /fx-alpha, fx-beta/);

    // Same result against a different fixture expectation must fail
    const otherModels = join(dir, 'other-models.ts');
    writeFileSync(otherModels, profilesFixture(['fx-alpha', 'fx-beta', 'fx-gamma']));
    const fail = spawnSync(
      'node',
      [VERIFY_SCRIPT, resultPath, dir, '--models-source', otherModels],
      { encoding: 'utf8' },
    );
    assert.notEqual(fail.status, 0);
    assert.match(fail.stderr, /modelResults\.length/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-packaged-kimi-smoke-result accepts matching live result and rejects count drift', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-smoke-verify-'));
  try {
    const models = readKimiCodingModels();
    const resultPath = join(dir, 'result.json');
    writeFileSync(
      resultPath,
      JSON.stringify({
        schemaVersion: 1,
        status: 'pass',
        modelResults: models.map((model) => ({
          model,
          requests: 2,
          secondTurnReplayedReasoning: true,
        })),
        authorizationDenyNetworkRequests: 0,
        rollbackDenyNetworkRequests: 0,
        segmentation: passingSegmentation(),
      }),
    );
    const ok = spawnSync('node', [VERIFY_SCRIPT, resultPath, dir], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);

    const bad = JSON.parse(readFileSync(resultPath, 'utf8'));
    bad.modelResults = bad.modelResults.slice(0, 1);
    writeFileSync(resultPath, JSON.stringify(bad));
    const fail = spawnSync('node', [VERIFY_SCRIPT, resultPath, dir], { encoding: 'utf8' });
    assert.notEqual(fail.status, 0);
    assert.match(fail.stderr, /modelResults\.length/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-packaged-kimi-smoke-result rejects missing smokeRoot even with canary present (B3)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-smoke-b3-'));
  try {
    const models = readKimiCodingModels();
    const appdata = join(dir, 'appdata');
    mkdirSync(appdata, { recursive: true });
    writeFileSync(join(appdata, 'leak.txt'), 'PACKAGED_SMOKE_RUNTIME_ONLY leaked');
    const resultPath = join(dir, 'result.json');
    writeFileSync(
      resultPath,
      JSON.stringify({
        schemaVersion: 1,
        status: 'pass',
        modelResults: models.map((model) => ({
          model,
          requests: 2,
          secondTurnReplayedReasoning: true,
        })),
        authorizationDenyNetworkRequests: 0,
        rollbackDenyNetworkRequests: 0,
        segmentation: passingSegmentation(),
      }),
    );

    // With smokeRoot: canary must fail the verify
    const withRoot = spawnSync('node', [VERIFY_SCRIPT, resultPath, dir], { encoding: 'utf8' });
    assert.notEqual(withRoot.status, 0, withRoot.stdout + withRoot.stderr);
    assert.match(withRoot.stderr, /canary|PACKAGED_SMOKE_RUNTIME_ONLY|persisted/);

    // Without smokeRoot: must also fail (B3 — previously exited 0 and printed pass)
    const withoutRoot = spawnSync('node', [VERIFY_SCRIPT, resultPath], { encoding: 'utf8' });
    assert.notEqual(withoutRoot.status, 0, withoutRoot.stdout + withoutRoot.stderr);
    assert.match(withoutRoot.stderr, /smokeRoot/i);
    assert.doesNotMatch(withoutRoot.stdout, /\[packaged-kimi-smoke\] pass:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-packaged-kimi-smoke-result requires the packaged Chinese segmentation step (#150 M6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-smoke-seg-'));
  try {
    const models = readKimiCodingModels();
    const resultPath = join(dir, 'result.json');
    const write = (segmentation) => writeFileSync(resultPath, JSON.stringify({
      schemaVersion: 1,
      status: 'pass',
      modelResults: models.map((model) => ({ model, requests: 2, secondTurnReplayedReasoning: true })),
      authorizationDenyNetworkRequests: 0,
      rollbackDenyNetworkRequests: 0,
      ...(segmentation === undefined ? {} : { segmentation }),
    }));
    const run = () => spawnSync('node', [VERIFY_SCRIPT, resultPath, dir], { encoding: 'utf8' });

    write(passingSegmentation());
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    assert.match(ok.stdout, /segmentation pass: "南京市 长江大桥" in 812ms, nodejieba=.*app\.asar\.unpacked/);

    for (const [segmentation, message] of [
      [undefined, /segmentation result is missing/],
      [{ status: 'not-run' }, /segmentation status is "not-run"/],
      [passingSegmentation({ output: '南京 市长 江大桥' }), /segmentation output="南京 市长 江大桥", expected "南京市 长江大桥"/],
      [passingSegmentation({ output: '南京市长江大桥' }), /segmentation output=/],
      [passingSegmentation({ workerEntry: 'D:\\a\\xiaok-cli\\desktop\\node_modules\\nodejieba\\index.js' }), /workerEntry is not inside app\.asar/],
      [passingSegmentation({ dictionaryDir: '/home/dev/xiaok-cli/node_modules/nodejieba/submodules/cppjieba/dict' }), /dictionaryDir is not inside app\.asar/],
    ]) {
      write(segmentation);
      const fail = run();
      assert.notEqual(fail.status, 0, fail.stdout);
      assert.match(fail.stderr, message);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-desktop-sibling-pins passes on current workflows', () => {
  const result = spawnSync('node', [PIN_SCRIPT], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /matches desktop-release/);
  // Live release has two clone blocks (build-mac + build-windows)
  assert.match(result.stdout, /release×2/);
});

test('sibling pins: second clone drift in release must fail (B1 / kills first-only match)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sibling-pins-b1-'));
  try {
    const good = { plugins: PIN_A, kswarm: PIN_B, broker: PIN_C };
    const badWindows = { plugins: PIN_A, kswarm: PIN_BAD, broker: PIN_C };
    const { releasePath, crossPath } = writeWorkflowPair(dir, {
      releaseBlocks: [good, badWindows],
      crossBlocks: [good],
    });
    const result = runPinCheck(releasePath, crossPath);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /internal pin drift|kswarm/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sibling pins: cross-platform second-block drift must fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sibling-pins-cross-'));
  try {
    const good = { plugins: PIN_A, kswarm: PIN_B, broker: PIN_C };
    const drifted = { plugins: PIN_A, kswarm: PIN_BAD, broker: PIN_C };
    const { releasePath, crossPath } = writeWorkflowPair(dir, {
      releaseBlocks: [good, good],
      crossBlocks: [good, drifted],
    });
    const result = runPinCheck(releasePath, crossPath);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /pin drift/);
    assert.match(result.stderr, /occurrence 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sibling pins: unpinned clone must fail (kills failed=true no-op mutation)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sibling-pins-unpin-'));
  try {
    const good = { plugins: PIN_A, kswarm: PIN_B, broker: PIN_C };
    const unpinned = { plugins: PIN_A, kswarm: null, broker: PIN_C };
    const { releasePath, crossPath } = writeWorkflowPair(dir, {
      releaseBlocks: [good],
      crossBlocks: [unpinned],
    });
    const result = runPinCheck(releasePath, crossPath);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /without a pinned SHA/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sibling pins: matching multi-block fixtures pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sibling-pins-ok-'));
  try {
    const good = { plugins: PIN_A, kswarm: PIN_B, broker: PIN_C };
    const { releasePath, crossPath } = writeWorkflowPair(dir, {
      releaseBlocks: [good, good],
      crossBlocks: [good],
    });
    const result = runPinCheck(releasePath, crossPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /matches desktop-release/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
