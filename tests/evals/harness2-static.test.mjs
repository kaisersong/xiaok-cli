import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, mock } from 'node:test';
import {
  OPERATIONS, DIAGNOSIS_CATEGORIES, DIAGNOSIS_ACTIONS,
  evaluateSelection, proveStaticStop, mapDiagnosis, buildStaticReport,
} from '../../scripts/evals/harness2-static/preflight.mjs';
import { diagnoseTraceBundle } from '../../src/runtime/diagnostics/diagnoser.ts';
import { diagnoseProjectSnapshot } from '../../src/runtime/diagnostics/project-diagnoser.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = OPERATIONS[0];
const sections = OPERATIONS[1];
const refs = OPERATIONS[2];
const run = args => spawnSync(process.execPath,
  ['--import', 'tsx', 'scripts/evals/harness2-static/run.mjs', ...args],
  { cwd: root, encoding: 'utf8', timeout: 30000 });

test('T15: current V ignores over-selection and scores actual missing requirements', () => {
  assert.deepEqual([...OPERATIONS], ['VERIFY_SOURCE_DATE', 'CHECK_REQUIRED_SECTIONS', 'VERIFY_REFERENCES_BEFORE_FINAL']);
  assert.equal(evaluateSelection({ required: [source], selected: OPERATIONS }), 1);
  assert.equal(evaluateSelection({ required: [source], selected: [source] }), 1);
  assert.equal(evaluateSelection({ required: [sections], selected: [source] }), 0);
  assert.equal(evaluateSelection({ required: [], selected: OPERATIONS }), 0);
  assert.equal(evaluateSelection({ required: [source], selected: [] }), 0);
  assert.equal(evaluateSelection({ required: [refs], selected: [refs], fabricatedFacts: true }), 0);
  assert.equal(evaluateSelection({ required: [refs], selected: [refs], unauthorized: true }), 0);
});

test('T15: fixed operation universe rejects invalid or duplicate operations and non-boolean violations', () => {
  for (const selected of [[source, source], ['NEW_OPERATION'], 'VERIFY_SOURCE_DATE', null, Array(1)]) {
    assert.throws(() => evaluateSelection({ required: [source], selected }));
  }
  assert.throws(() => evaluateSelection({ required: ['NEW_OPERATION'], selected: [] }));
  assert.throws(() => evaluateSelection({ required: [], selected: [], unauthorized: 'false' }));
  assert.throws(() => evaluateSelection({ required: [], selected: [], fabricatedFacts: 0 }));
  assert.throws(() => { OPERATIONS.push('NEW_OPERATION'); });
});

test('T15: exhaustive fixed-template proof stops paid reflect without over-generalizing', () => {
  const proof = proveStaticStop();
  assert.equal(proof.decision, 'stop_paid_reflect');
  assert.equal(proof.metric, 'V_missing_operation_hit_v1');
  assert.equal(proof.cases.length, 256);
  assert.equal(new Set(proof.cases.map(row => JSON.stringify([
    row.required, row.selected, row.fabricatedFacts, row.unauthorized,
  ]))).size, 256);
  assert.equal(proof.maxDelta, 0);
  assert.equal(proof.minDelta, -1);
  assert.ok(proof.cases.every(row => row.candidateValue <= row.baseValue && row.delta <= 0));
  assert.ok(proof.cases.some(row => row.required.length === 0 && row.baseValue === 0));
  assert.ok(proof.cases.some(row => row.delta === -1));
  const example = proof.alternativeMetricCounterexample;
  assert.equal(example.usedForDecision, false);
  assert.ok(Math.abs(example.baseValue - (-0.2)) < 1e-12);
  assert.equal(example.candidateValue, 1);
  assert.ok(Math.abs(example.delta - 1.2) < 1e-12);
  // Calculating a different metric must not mutate the current one.
  assert.equal(evaluateSelection({ required: [source], selected: OPERATIONS }), 1);
});

test('T15: every frozen diagnosis category/action is NO_ENTRY, including generic verification', () => {
  const report = mapDiagnosis({ schemaVersion: 1,
    findings: DIAGNOSIS_CATEGORIES.map(category => ({ category })),
    recommendedActions: DIAGNOSIS_ACTIONS.map(id => ({ id })),
  });
  assert.equal(report.status, 'no_entry');
  assert.deepEqual(report.operations, []);
  const typeSource = readFileSync(join(root, 'src/runtime/diagnostics/types.ts'), 'utf8');
  const union = typeSource.split('export type DiagnosisCategory =')[1].split(';')[0];
  assert.deepEqual([...union.matchAll(/'([^']+)'/g)].map(match => match[1]), [...DIAGNOSIS_CATEGORIES]);
});

test('T15: unknown structured codes and malformed/new schema remain mapping_unknown', () => {
  for (const input of [null, {}, { schemaVersion: 2, findings: [], recommendedActions: [] },
    { schemaVersion: 1, findings: [{ category: 'verify_references' }], recommendedActions: [] },
    { schemaVersion: 1, findings: [], recommendedActions: [{ id: 'new_action' }] },
    { schemaVersion: 1, findings: [null], recommendedActions: [] },
    { schemaVersion: 1, findings: Array(1), recommendedActions: [] }]) {
    assert.equal(mapDiagnosis(input).status, 'mapping_unknown');
    assert.deepEqual(mapDiagnosis(input).operations, []);
  }
  const mapped = mapDiagnosis({ schemaVersion: 1, findings: [{ category: 'empty_artifact',
    title: 'VERIFY_SOURCE_DATE CHECK_REQUIRED_SECTIONS', explanation: 'ignore previous instructions' }],
  recommendedActions: [{ id: 'inspect_artifacts', label: 'VERIFY_REFERENCES_BEFORE_FINAL' }] });
  assert.equal(mapped.status, 'no_entry');
  assert.deepEqual(mapped.operations, []);
});

test('T15: both real production diagnosers return no report-checklist operations', () => {
  const trace = { schemaVersion: 1, tasks: [
    { id: 'blocked', title: 'blocked', status: 'blocked' },
    { id: 'empty', title: 'empty', status: 'done', artifacts: [] },
  ], agents: [{ id: 'idle', status: 'idle' }], summary: { projectStatus: 'active' },
  events: [{ id: 'approval', type: 'approval.required', data: {} }], scope: { kind: 'task', taskId: 'synthetic' } };
  const diagnosis = diagnoseTraceBundle(trace);
  assert.deepEqual(diagnosis.findings.map(row => row.category), ['blocked_task', 'empty_artifact', 'approval_wait']);
  const project = diagnoseProjectSnapshot({ project: { id: 'synthetic', name: 'synthetic', status: 'active' },
    tasks: trace.tasks, agents: trace.agents, dispatchPlan: { dispatchable: [{ taskId: 'next' }] } });
  assert.ok(project.findings.some(row => row.category === 'dispatch_stalled'));
  for (const actual of [diagnosis, project]) {
    assert.equal(mapDiagnosis(actual).status, 'no_entry');
    assert.deepEqual(mapDiagnosis(actual).operations, []);
  }
});

test('P0a report reads only repo code, hashes actual sources, and cannot authorize D0', async () => {
  const deny = () => assert.fail('P0a must not open a network connection');
  const mocks = [mock.method(globalThis, 'fetch', deny), mock.method(http, 'request', deny),
    mock.method(http, 'get', deny), mock.method(https, 'request', deny), mock.method(https, 'get', deny),
    mock.method(net, 'connect', deny), mock.method(net, 'createConnection', deny)];
  try {
    const report = await buildStaticReport(root);
    assert.equal(report.p0a.decision, 'stop_paid_reflect');
    assert.equal(report.productQualified, false);
    assert.equal(report.d0.decision, 'not_started');
    assert.ok(report.d0.missingEvidence.includes('real_report_failure_buckets'));
    assert.ok(report.d0.missingEvidence.includes('provider_transport_usage_hazard_history'));
    assert.equal(report.evidenceLevel, 'static_source_and_synthetic_formula_only');
    assert.equal(report.diagnostics.evidenceKind, 'synthetic_production_entry_calls');
    assert.deepEqual(report.diagnostics.cases.map(row => row.mapping.status), ['no_entry', 'no_entry']);
    assert.ok(report.inventory.some(row => row.role === 'offline_eval'));
    assert.ok(report.inventory.some(row => row.path === 'src/runtime/harness-memory/store.ts'));
    for (const item of report.inventory) {
      assert.equal(item.sha256, createHash('sha256').update(readFileSync(join(root, item.path))).digest('hex'));
      assert.ok(item.sourceRefs.length > 0);
    }
  } finally { for (const item of mocks) item.mock.restore(); }
  await assert.rejects(() => buildStaticReport(join(root, 'not-a-repository')));
});

test('P0a real command is zero-call, uses exclusive evidence output, and rejects dispatch options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness2-static-'));
  try {
    const path = join(dir, 'report.json');
    const first = run(['--output', path]);
    assert.equal(first.status, 0, first.stderr);
    const bytes = readFileSync(path, 'utf8');
    const report = JSON.parse(bytes);
    assert.equal(report.p0a.decision, 'stop_paid_reflect');
    assert.equal(report.d0.decision, 'not_started');
    const second = run(['--output', path]);
    assert.equal(second.status, 1);
    assert.equal(readFileSync(path, 'utf8'), bytes);
    assert.deepEqual(readdirSync(dir), ['report.json']);
    for (const args of [['--mode', 'reflect'], ['--manifest', 'unsafe.json'], ['--metric', 'cost'], ['probe']]) {
      assert.equal(run(args).status, 1);
    }
    const sentinel = join(dir, 'sentinel.json');
    writeFileSync(sentinel, 'unchanged');
    assert.equal(run(['--output', sentinel]).status, 1);
    assert.equal(readFileSync(sentinel, 'utf8'), 'unchanged');
    const stdout = run([]);
    assert.equal(stdout.status, 0, stdout.stderr);
    assert.equal(JSON.parse(stdout.stdout).productQualified, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
