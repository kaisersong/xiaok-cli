// Regression for the actual compiled public creator and clone; explicit root/SHA bind the production module.
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
let compiledBytes;
try { compiledBytes = readFileSync(compiledPath); } catch { throw Error('NOT_AVAILABLE: existing production module must be built by owner first'); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(compiledBytes) !== expectedJS) throw Error('NOT_AVAILABLE: compiled bytes do not match owner receipt');
const production = await import(pathToFileURL(compiledPath).href);
if (typeof production.createIntentLedgerRecord !== 'function' || typeof production.cloneIntentRecord !== 'function') throw Error('NOT_AVAILABLE: existing public exports missing, not feature RED');
const scenarios = [{"sessionId": "sess_store", "instanceId": "inst_store", "intentId": "intent_store", "riskTier": "medium", "sourceLine": 27}, {"sessionId": "sess_trace", "instanceId": "inst_trace", "intentId": "intent_trace", "riskTier": "high", "sourceLine": 74}, {"sessionId": "sess_guard", "instanceId": "inst_guard", "intentId": "intent_guard", "riskTier": "medium", "sourceLine": 130}, {"sessionId": "sess_multi", "instanceId": "inst_multi", "intentId": "intent_first", "riskTier": "medium", "sourceLine": 152}, {"sessionId": "sess_multi", "instanceId": "inst_multi", "intentId": "intent_second", "riskTier": "medium", "sourceLine": 157}, {"sessionId": "sess_dispatch_store", "instanceId": "inst_dispatch_store", "intentId": "intent_dispatch_store", "riskTier": "medium", "sourceLine": 190}];
function legacyDraft(input) {
  const riskTier = input.riskTier;
  const step = (order, key, dependsOn) => ({ stepId: `${input.intentId}:step:${key}`, key, order, role: key, skillName: null, dependsOn, status: 'planned', riskTier });
  // Original flat data fixture only; no stages or normalization implementation.
  return { instanceId: input.instanceId, intentId: input.intentId, sessionId: input.sessionId, rawIntent: 'Write a proposal', normalizedIntent: 'write a proposal', intentType: 'generate', deliverable: 'proposal', explicitConstraints: [], delegationBoundary: [], riskTier, templateId: 'tpl_generate', steps: [step(0, 'collect', []), step(1, 'compose', [`${input.intentId}:step:collect`])], continuationMode: 'new_intent' };
}
function missing(draft) {
  for (const key of ['stages', 'finalDeliverable', 'intentMode', 'segmentationConfidence']) assert.equal(Object.hasOwn(draft, key), false, `original input ${key} must stay absent`);
}
function metadata(record) { return { finalDeliverable: record.finalDeliverable, intentMode: record.intentMode, segmentationConfidence: record.segmentationConfidence }; }
const expected = { finalDeliverable: 'proposal', intentMode: 'single_stage', segmentationConfidence: 'low' };
for (const input of scenarios) {
  test(`public creator immediate legacy metadata: ${input.intentId}`, () => {
    const draft = legacyDraft(input); missing(draft);
    const record = production.createIntentLedgerRecord(draft, 100);
    missing(draft);
    assert.equal(record.stages.length, 1);
    assert.equal(record.stages[0].stageId, `${input.intentId}:stage:1`);
    assert.deepEqual(record.steps.map(step => step.stepId), [`${input.intentId}:step:collect`, `${input.intentId}:step:compose`]);
    assert.deepEqual(metadata(record), expected);
  });
  test(`existing real clone normalization control: ${input.intentId}`, () => {
    const draft = legacyDraft(input); missing(draft);
    const intermediate = production.createIntentLedgerRecord(draft, 100);
    const normalized = production.cloneIntentRecord(intermediate);
    missing(draft);
    assert.deepEqual(metadata(normalized), expected);
  });
}
