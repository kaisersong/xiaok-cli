// Regression for public metadata compatibility and original creator own-key shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = process.env.XIAOK_REPO_ROOT;
const expectedJS = process.env.XIAOK_EXPECTED_TYPES_JS_SHA;
if (!root || !expectedJS || !/^[a-f0-9]{64}$/u.test(expectedJS)) throw Error('NOT_AVAILABLE: explicit root and owner-verified compiled SHA required');
const compiledPath = resolve(root, '.test-dist/src/runtime/intent-delegation/types.js');
let bytes;
try { bytes = readFileSync(compiledPath); } catch { throw Error('NOT_AVAILABLE: existing production module must be built by owner first'); }
if (createHash('sha256').update(bytes).digest('hex') !== expectedJS) throw Error('NOT_AVAILABLE: compiled bytes do not match owner receipt');
const production = await import(pathToFileURL(compiledPath).href);
if (typeof production.createIntentLedgerRecord !== 'function') throw Error('NOT_AVAILABLE: existing public export missing, not feature RED');

function flatPlan() {
  return {
    instanceId: 'policy_instance', intentId: 'policy_intent', sessionId: 'policy_session',
    rawIntent: 'Write a memo', normalizedIntent: 'write a memo', intentType: 'generate',
    deliverable: 'memo', explicitConstraints: [], delegationBoundary: [], riskTier: 'medium',
    templateId: 'tpl_generate', continuationMode: 'new_intent',
    steps: [{ stepId: 'policy_intent:step:compose', key: 'compose', order: 0, role: 'compose',
      skillName: null, dependsOn: [], status: 'planned', riskTier: 'medium' }],
  };
}

test('explicit undefined legacy metadata stays undefined on the input and normalizes on output', () => {
  const plan = { ...flatPlan(), stages: undefined, finalDeliverable: undefined, intentMode: undefined, segmentationConfidence: undefined };
  const before = structuredClone(plan);
  const record = production.createIntentLedgerRecord(plan, 100);
  assert.deepEqual(plan, before);
  assert.deepEqual([record.finalDeliverable, record.intentMode, record.segmentationConfidence], ['memo', 'single_stage', 'low']);
  assert.equal(record.stages[0].stageId, 'policy_intent:stage:1');
});

test('modern empty stages retain the original stage fallback and explicit scalar metadata', () => {
  const plan = { ...flatPlan(), stages: [], finalDeliverable: 'final memo', intentMode: 'multi_stage', segmentationConfidence: 'high' };
  const record = production.createIntentLedgerRecord(plan, 100);
  assert.equal(plan.stages.length, 0);
  assert.equal(record.stages.length, 1);
  assert.equal(record.stages[0].stageId, 'policy_intent:stage:1');
  assert.deepEqual([record.finalDeliverable, record.intentMode, record.segmentationConfidence], ['final memo', 'multi_stage', 'high']);
  assert.equal(record.stages[0].deliverable, 'memo');
});

test('complete modern stage data and detached step references survive earlier normalization', () => {
  const flat = flatPlan();
  const stage = { stageId: 'modern_stage', order: 0, label: 'Memo', intentType: 'generate', deliverable: 'memo',
    templateId: 'tpl_generate', riskTier: 'medium', dependsOnStageIds: [], steps: flat.steps };
  const plan = { ...flat, stages: [stage], finalDeliverable: 'final memo', intentMode: 'single_stage', segmentationConfidence: 'high' };
  const record = production.createIntentLedgerRecord(plan, 100);
  assert.equal(record.stages[0].stageId, 'modern_stage');
  assert.equal(record.finalDeliverable, 'final memo');
  assert.equal(record.segmentationConfidence, 'high');
  assert.notEqual(record.steps[0], record.stages[0].steps[0]);
  record.steps[0].dependsOn.push('output_only');
  assert.deepEqual(record.stages[0].steps[0].dependsOn, []);
  assert.deepEqual(plan.steps[0].dependsOn, []);
});

for (const [name, metadata, expected] of [
  ['untyped null stages keep existing fallback', { stages: null }, ['memo', 'single_stage', 'low']],
  ['untyped null scalar reaches existing nullish fallback', { finalDeliverable: null }, ['memo', 'single_stage', 'low']],
  ['typed mixed partial scalar', { finalDeliverable: 'final memo' }, ['final memo', 'single_stage', 'low']],
  ['typed stages without scalar metadata', { stages: [] }, ['memo', 'single_stage', 'low']],
  ['typed partial mode and confidence', { intentMode: 'multi_stage', segmentationConfidence: 'high' }, ['memo', 'multi_stage', 'high']],
]) {
  test(`compatibility metadata policy: ${name}`, () => {
    const plan = { ...flatPlan(), ...metadata };
    const before = structuredClone(plan);
    const record = production.createIntentLedgerRecord(plan, 100);
    assert.deepEqual([record.finalDeliverable, record.intentMode, record.segmentationConfidence], expected);
    assert.equal(record.stages[0].stageId, 'policy_intent:stage:1');
    assert.deepEqual(plan, before);
  });
}

test('public creator preserves original own keys and order for legacy and modern inputs', () => {
  // Exact literal field order from frozen ORIGINAL types.ts:116-139 (creator:111-140).
  // This expectation intentionally does not derive keys from either proposed implementation.
  const expectedKeys = [
    'intentId',
    'instanceId',
    'sessionId',
    'rawIntent',
    'normalizedIntent',
    'providedSourcePaths',
    'intentType',
    'deliverable',
    'finalDeliverable',
    'explicitConstraints',
    'delegationBoundary',
    'riskTier',
    'intentMode',
    'segmentationConfidence',
    'templateId',
    'stages',
    'activeStageId',
    'artifacts',
    'steps',
    'activeStepId',
    'overallStatus',
    'attemptCount',
    'createdAt',
    'updatedAt',
  ];
  const legacy = flatPlan();
  const modernFlat = flatPlan();
  const modern = {
    ...modernFlat,
    finalDeliverable: 'memo',
    intentMode: 'single_stage',
    segmentationConfidence: 'low',
    stages: [{
      stageId: 'policy_intent:stage:modern',
      order: 0,
      label: 'Memo',
      intentType: 'generate',
      deliverable: 'memo',
      templateId: 'tpl_generate',
      riskTier: 'medium',
      dependsOnStageIds: [],
      steps: modernFlat.steps,
    }],
  };
  for (const [name, plan] of [['legacy', legacy], ['modern', modern]]) {
    const record = production.createIntentLedgerRecord(plan, 100);
    assert.deepEqual(Object.keys(record), expectedKeys, `${name}: original creator keys and order`);
    assert.equal(Object.hasOwn(record, 'executionTerminals'), false, `${name}: no new own executionTerminals`);
    assert.equal(Object.hasOwn(record, 'salvageSummary'), false, `${name}: no new own salvageSummary`);
  }
});
