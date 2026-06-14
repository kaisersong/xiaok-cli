import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
  ArtifactEvidenceRegressionScanner,
} from '../../electron/artifact-evidence-regression-loop.js';
import {
  CompletionEvidenceStore,
  CompletionEvidenceValidationError,
} from '../../electron/completion-evidence-store.js';
import type {
  CompletionEvidenceRecord,
  CompletionExpectation,
} from '../../electron/completion-evidence-types.js';
import { validateCompletionEvidence } from '../../../src/runtime/guards/completion-evidence.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SOURCE_OWNER_ID = 'desktop-sqlite-completion-source';

describe('ArtifactEvidenceRegressionScanner', () => {
  let rootDir: string;
  let dbPath: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-artifact-evidence-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    dbPath = join(rootDir, 'desktop.sqlite');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('detects completed_without_evidence', () => {
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    })).toThrow(CompletionEvidenceValidationError);
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const result = scanner.scan({ loopRunId: 'run-1', now: 2_000 });

    expect(result).toMatchObject({
      loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
      loopRunId: 'run-1',
      scannedOwnerCount: 1,
      openAnomalyCount: 1,
      resolvedAnomalyCount: 0,
      nextActionKind: 'inspect_anomalies',
    });
    expect(result.summaryEvidence).toMatchObject({
      kind: 'log_diagnostic',
      metadata: {
        loopRunId: 'run-1',
        findings: ['completed_without_evidence:task:owner-1'],
      },
    });
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]).toMatchObject({
      loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
      ownerKind: 'task',
      ownerId: 'owner-1',
      kind: 'completed_without_evidence',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 2_000,
      seenCount: 1,
      evidenceIds: [],
    });

    scanner.close();
  });

  it('does not flag answer completion with answer evidence', () => {
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    const evidence = store.insertEvidence(taskEvidence({
      id: 'answer-evidence-1',
      kind: 'answer',
      summary: '已直接回答用户问题。',
      metadata: { responseId: 'resp-1' },
      now: 1_050,
    }));
    store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    });
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const result = scanner.scan({ loopRunId: 'run-1', now: 2_000 });

    expect(result).toMatchObject({
      scannedOwnerCount: 1,
      openAnomalyCount: 0,
      resolvedAnomalyCount: 0,
      nextActionKind: 'none',
    });
    expect(result.anomalies).toEqual([]);
    expect(scanner.listAnomalies()).toEqual([]);
    expect(evidence.id).toBe('answer-evidence-1');

    scanner.close();
  });

  it('flags artifact expectation with answer evidence as artifact_kind_mismatch', () => {
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['file_artifact'], now: 1_000 }));
    const evidence = store.insertEvidence(taskEvidence({
      id: 'answer-evidence-for-artifact',
      kind: 'answer',
      summary: '只给出了文字答案，没有交付文件。',
      metadata: { responseId: 'resp-1' },
      now: 1_050,
    }));
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    })).toThrow(CompletionEvidenceValidationError);
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const result = scanner.scan({ loopRunId: 'run-1', now: 2_000 });

    expect(result.openAnomalyCount).toBe(1);
    expect(result.nextActionKind).toBe('inspect_anomalies');
    expect(result.anomalies[0]).toMatchObject({
      ownerKind: 'task',
      ownerId: 'owner-1',
      kind: 'artifact_kind_mismatch',
      status: 'open',
      evidenceIds: [evidence.id],
      metadata: {
        expectedKinds: ['file_artifact'],
        evidenceKinds: ['answer'],
        failureKind: 'evidence_kind_mismatch',
        loopRunId: 'run-1',
      },
    });

    scanner.close();
  });

  it('flags legacy record without expectation as legacy_unclassified_completion', () => {
    createCompletionSchema();
    insertCompletionRecord({
      id: 'legacy-record-1',
      ownerKind: 'task',
      ownerId: 'legacy-task-1',
      status: 'completed',
      ok: 1,
      createdAt: 1_000,
    });

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const result = scanner.scan({ loopRunId: 'run-legacy', now: 2_000 });

    expect(result.openAnomalyCount).toBe(1);
    expect(result.anomalies[0]).toMatchObject({
      ownerKind: 'task',
      ownerId: 'legacy-task-1',
      kind: 'legacy_unclassified_completion',
      status: 'open',
      evidenceIds: [],
      message: 'Completed owner has no completion expectation.',
    });

    scanner.close();
  });

  it('tracks repeated anomaly across two runs', () => {
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    })).toThrow(CompletionEvidenceValidationError);
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    scanner.scan({ loopRunId: 'run-1', now: 2_000 });
    const second = scanner.scan({ loopRunId: 'run-2', now: 3_000 });

    expect(second.openAnomalyCount).toBe(1);
    expect(second.anomalies).toHaveLength(1);
    expect(second.anomalies[0]).toMatchObject({
      kind: 'completed_without_evidence',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 3_000,
      seenCount: 2,
      metadata: {
        loopRunId: 'run-2',
      },
    });
    expect(scanner.listAnomalies({ status: 'open' })).toHaveLength(1);

    scanner.close();
  });

  it('resolves anomaly when owner gains valid evidence', () => {
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    })).toThrow(CompletionEvidenceValidationError);
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    scanner.scan({ loopRunId: 'run-1', now: 2_000 });
    scanner.close();

    const updatedStore = new CompletionEvidenceStore(dbPath);
    updatedStore.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '补充了可验证的回答证据。',
      metadata: { responseSnapshotHash: 'sha256:answer' },
      now: 2_500,
    }));
    updatedStore.close();

    const rescan = new ArtifactEvidenceRegressionScanner(dbPath);
    const result = rescan.scan({ loopRunId: 'run-2', now: 3_000 });

    expect(result).toMatchObject({
      scannedOwnerCount: 1,
      openAnomalyCount: 0,
      resolvedAnomalyCount: 1,
      nextActionKind: 'none',
    });
    expect(result.anomalies[0]).toMatchObject({
      kind: 'completed_without_evidence',
      status: 'resolved',
      firstSeenAt: 2_000,
      lastSeenAt: 2_000,
      lastResolvedAt: 3_000,
      seenCount: 1,
    });
    expect(rescan.listAnomalies({ status: 'open' })).toEqual([]);

    rescan.close();
  });

  it('clears lastResolvedAt when a resolved anomaly reopens', () => {
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    })).toThrow(CompletionEvidenceValidationError);
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const initial = scanner.scan({ loopRunId: 'run-1', now: 2_000 });
    const anomalyId = initial.anomalies[0]?.id;
    expect(initial.anomalies[0]).toMatchObject({
      kind: 'completed_without_evidence',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 2_000,
      seenCount: 1,
      lastResolvedAt: undefined,
    });
    scanner.close();

    const updatedStore = new CompletionEvidenceStore(dbPath);
    const evidence = updatedStore.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '补充了可验证的回答证据。',
      metadata: { responseSnapshotHash: 'sha256:answer' },
      now: 2_500,
    }));
    updatedStore.close();

    const resolveScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const resolved = resolveScanner.scan({ loopRunId: 'run-2', now: 3_000 });
    expect(resolved.anomalies[0]).toMatchObject({
      id: anomalyId,
      kind: 'completed_without_evidence',
      status: 'resolved',
      firstSeenAt: 2_000,
      lastSeenAt: 2_000,
      lastResolvedAt: 3_000,
      seenCount: 1,
    });
    resolveScanner.close();

    const invalidStore = new CompletionEvidenceStore(dbPath);
    expect(invalidStore.markEvidenceOrphaned(evidence.id, 3_500)).toBe(true);
    invalidStore.close();

    const reopenScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const reopened = reopenScanner.scan({ loopRunId: 'run-3', now: 4_000 });
    expect(reopened).toMatchObject({
      openAnomalyCount: 1,
      resolvedAnomalyCount: 0,
      nextActionKind: 'inspect_anomalies',
    });
    expect(reopened.anomalies[0]).toMatchObject({
      id: anomalyId,
      kind: 'completed_without_evidence',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 4_000,
      seenCount: 2,
      evidenceIds: [],
    });
    expect(reopened.anomalies[0]?.lastResolvedAt).toBeUndefined();

    reopenScanner.close();
  });

  it('reports desktop SQLite source failure as source_unavailable', () => {
    const db = new DatabaseSync(dbPath);
    db.exec('create table unrelated_table (id text primary key)');
    db.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const result = scanner.scan({ loopRunId: 'run-source', now: 2_000 });

    expect(result).toMatchObject({
      scannedOwnerCount: 0,
      openAnomalyCount: 1,
      resolvedAnomalyCount: 0,
      nextActionKind: 'inspect_source',
    });
    expect(result.anomalies[0]).toMatchObject({
      ownerKind: 'loop_run',
      ownerId: SOURCE_OWNER_ID,
      kind: 'source_unavailable',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 2_000,
      seenCount: 1,
    });
    expect(result.anomalies[0]?.metadata).toMatchObject({ loopRunId: 'run-source' });
    expect(result.summaryEvidence.metadata.findings).toEqual([`source_unavailable:loop_run:${SOURCE_OWNER_ID}`]);

    scanner.close();
  });

  it('tracks source_unavailable with a stable source owner and resolves it after source recovery', () => {
    const db = new DatabaseSync(dbPath);
    db.exec('create table unrelated_table (id text primary key)');
    db.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const first = scanner.scan({ loopRunId: 'run-source-1', now: 2_000 });
    const second = scanner.scan({ loopRunId: 'run-source-2', now: 3_000 });

    expect(first.anomalies[0]).toMatchObject({
      ownerKind: 'loop_run',
      ownerId: SOURCE_OWNER_ID,
      kind: 'source_unavailable',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 2_000,
      seenCount: 1,
      metadata: { loopRunId: 'run-source-1' },
    });
    expect(second.anomalies).toHaveLength(1);
    expect(second.anomalies[0]).toMatchObject({
      id: first.anomalies[0]?.id,
      ownerKind: 'loop_run',
      ownerId: SOURCE_OWNER_ID,
      kind: 'source_unavailable',
      status: 'open',
      firstSeenAt: 2_000,
      lastSeenAt: 3_000,
      seenCount: 2,
      metadata: { loopRunId: 'run-source-2' },
    });
    scanner.close();

    createCompletionSchema();
    const recoveredScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const recovered = recoveredScanner.scan({ loopRunId: 'run-source-3', now: 4_000 });

    expect(recovered).toMatchObject({
      scannedOwnerCount: 0,
      openAnomalyCount: 0,
      resolvedAnomalyCount: 1,
      nextActionKind: 'none',
    });
    expect(recovered.anomalies).toHaveLength(1);
    expect(recovered.anomalies[0]).toMatchObject({
      id: first.anomalies[0]?.id,
      ownerKind: 'loop_run',
      ownerId: SOURCE_OWNER_ID,
      kind: 'source_unavailable',
      status: 'resolved',
      firstSeenAt: 2_000,
      lastSeenAt: 3_000,
      lastResolvedAt: 4_000,
      seenCount: 2,
    });

    recoveredScanner.close();
  });

  it('returns summaryEvidence that validates as loop_run log_diagnostic evidence', () => {
    const cleanStore = new CompletionEvidenceStore(dbPath);
    cleanStore.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    cleanStore.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '已直接回答用户问题。',
      metadata: { responseId: 'resp-clean' },
      now: 1_050,
    }));
    cleanStore.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    });
    cleanStore.close();

    const cleanScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const clean = cleanScanner.scan({ loopRunId: 'run-clean', now: 2_000 });
    expectSummaryEvidenceToValidate(clean, 'run-clean');
    cleanScanner.close();

    rmSync(rootDir, { recursive: true, force: true });
    mkdirSync(rootDir, { recursive: true });
    const openStore = new CompletionEvidenceStore(dbPath);
    openStore.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 3_000 }));
    expect(() => openStore.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 3_100,
    })).toThrow(CompletionEvidenceValidationError);
    openStore.close();

    const openScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const open = openScanner.scan({ loopRunId: 'run-open', now: 4_000 });
    expectSummaryEvidenceToValidate(open, 'run-open');
    openScanner.close();

    const resolvedStore = new CompletionEvidenceStore(dbPath);
    resolvedStore.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '补充了回答证据。',
      metadata: { responseSnapshotHash: 'sha256:resolved' },
      now: 4_500,
    }));
    resolvedStore.close();
    const resolvedScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const resolved = resolvedScanner.scan({ loopRunId: 'run-resolved', now: 5_000 });
    expect(resolved).toMatchObject({
      openAnomalyCount: 0,
      resolvedAnomalyCount: 1,
    });
    expectSummaryEvidenceToValidate(resolved, 'run-resolved');
    resolvedScanner.close();

    rmSync(rootDir, { recursive: true, force: true });
    mkdirSync(rootDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec('create table unrelated_table (id text primary key)');
    db.close();
    const sourceScanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const sourceFailure = sourceScanner.scan({ loopRunId: 'run-source', now: 6_000 });
    expectSummaryEvidenceToValidate(sourceFailure, 'run-source');
    sourceScanner.close();
  });

  it('keeps ignored anomaly quiet until it expires after 90 days', () => {
    const start = 10_000;
    const ignoredUntil = start + 90 * DAY_MS;
    const store = new CompletionEvidenceStore(dbPath);
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_100,
    })).toThrow(CompletionEvidenceValidationError);
    store.close();

    const scanner = new ArtifactEvidenceRegressionScanner(dbPath);
    const first = scanner.scan({ loopRunId: 'run-1', now: start });
    const anomalyId = first.anomalies[0]?.id;
    expect(anomalyId).toBeTruthy();
    scanner.ignoreAnomaly(anomalyId, ignoredUntil, start + 1_000);

    const beforeExpiry = scanner.scan({ loopRunId: 'run-2', now: start + 30 * DAY_MS });
    expect(beforeExpiry).toMatchObject({
      openAnomalyCount: 0,
      nextActionKind: 'none',
    });
    expect(beforeExpiry.anomalies[0]).toMatchObject({
      id: anomalyId,
      status: 'ignored',
      firstSeenAt: start,
      lastSeenAt: start,
      seenCount: 1,
      ignoredUntil,
    });

    const afterExpiry = scanner.scan({ loopRunId: 'run-3', now: ignoredUntil });
    expect(afterExpiry).toMatchObject({
      openAnomalyCount: 1,
      nextActionKind: 'inspect_anomalies',
    });
    expect(afterExpiry.anomalies[0]).toMatchObject({
      id: anomalyId,
      status: 'open',
      firstSeenAt: start,
      lastSeenAt: ignoredUntil,
      seenCount: 2,
      ignoredUntil: undefined,
    });

    scanner.close();
  });

  function createCompletionSchema(): void {
    const store = new CompletionEvidenceStore(dbPath);
    store.close();
  }

  function insertCompletionRecord(input: {
    id: string;
    ownerKind: string;
    ownerId: string;
    status: string;
    ok: 0 | 1;
    createdAt: number;
  }): void {
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      insert into completion_records (
        id, owner_kind, owner_id, status, ok, failure_kind, message,
        expectation_id, evidence_ids_json, created_at
      ) values (
        @id, @ownerKind, @ownerId, @status, @ok, null, null, null, '[]', @createdAt
      )
    `).run(input);
    db.close();
  }
});

function taskExpectation(input: {
  expectedKinds: CompletionExpectation['expectedKinds'];
  source?: CompletionExpectation['source'];
  confidence?: CompletionExpectation['confidence'];
  now?: number;
}): CompletionExpectation & { now?: number } {
  return {
    ownerKind: 'task',
    ownerId: 'owner-1',
    expectedKinds: input.expectedKinds,
    source: input.source ?? 'task_spec',
    confidence: input.confidence ?? 'explicit',
    now: input.now,
  };
}

function taskEvidence(
  input: Pick<CompletionEvidenceRecord, 'kind' | 'summary'> & Partial<CompletionEvidenceRecord> & {
    id?: string;
    now?: number;
  }
): CompletionEvidenceRecord & { id?: string; now?: number } {
  return {
    ownerKind: 'task',
    ownerId: 'owner-1',
    ...input,
  };
}

function expectSummaryEvidenceToValidate(
  result: ReturnType<ArtifactEvidenceRegressionScanner['scan']>,
  loopRunId: string
): void {
  const validation = validateCompletionEvidence({
    ownerKind: 'loop_run',
    ownerId: loopRunId,
    targetStatus: 'completed',
    expectation: {
      ownerKind: 'loop_run',
      ownerId: loopRunId,
      expectedKinds: ['log_diagnostic'],
      source: 'loop_stage_contract',
      confidence: 'explicit',
    },
    evidence: [{
      ownerKind: 'loop_run',
      ownerId: loopRunId,
      kind: result.summaryEvidence.kind,
      summary: result.summaryEvidence.summary,
      metadata: result.summaryEvidence.metadata,
    }],
  });
  expect(validation).toEqual({ ok: true });
}
