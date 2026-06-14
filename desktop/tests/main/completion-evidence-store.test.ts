import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CompletionEvidenceStore,
  CompletionEvidenceValidationError,
} from '../../electron/completion-evidence-store.js';
import type {
  CompletionEvidenceRecord,
  CompletionExpectation,
} from '../../electron/completion-evidence-types.js';

describe('CompletionEvidenceStore', () => {
  let rootDir: string;
  let dbPath: string;
  let store: CompletionEvidenceStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-completion-evidence-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    dbPath = join(rootDir, 'completion-evidence.sqlite');
    store = new CompletionEvidenceStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch { /* already closed */ }
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates schema', () => {
    store.close();
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare(`
      select name from sqlite_master
      where type = 'table' and name like 'completion_%'
      order by name
    `).all() as Array<{ name: string }>;
    db.close();

    expect(rows.map(row => row.name)).toEqual([
      'completion_evidence',
      'completion_expectations',
      'completion_records',
    ]);
  });

  it('upserts an explicit expectation for the same owner', () => {
    const initial = store.upsertExpectation(taskExpectation({
      expectedKinds: ['answer'],
      now: 1_000,
      metadata: { sourceTaskId: 'task-1' },
    }));
    const updated = store.upsertExpectation(taskExpectation({
      expectedKinds: ['file_artifact'],
      source: 'tool_schema',
      now: 2_000,
      metadata: { sourceTaskId: 'task-2' },
    }));

    expect(updated.id).toBe(initial.id);
    expect(updated).toMatchObject({
      ownerKind: 'task',
      ownerId: 'owner-1',
      expectedKinds: ['file_artifact'],
      source: 'tool_schema',
      confidence: 'explicit',
      schemaVersion: 1,
      createdAt: 1_000,
      updatedAt: 2_000,
      metadataJson: JSON.stringify({ sourceTaskId: 'task-2' }),
    });
  });

  it('inserts evidence with persisted metadata fields', () => {
    const evidence = store.insertEvidence(taskEvidence({
      id: 'evidence-answer-1',
      kind: 'answer',
      summary: '已直接回答。',
      metadata: { responseId: 'resp-1' },
      now: 3_000,
    }));

    expect(evidence).toMatchObject({
      id: 'evidence-answer-1',
      schemaVersion: 1,
      createdAt: 3_000,
      ownerKind: 'task',
      ownerId: 'owner-1',
      kind: 'answer',
      metadata: { responseId: 'resp-1' },
      metadataJson: JSON.stringify({ responseId: 'resp-1' }),
    });
    expect(store.listEvidenceForOwner('task', 'owner-1')).toEqual([evidence]);
  });

  it('validates a completed owner and records the outcome in one transaction', () => {
    const expectation = store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    const evidence = store.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '已直接回答。',
      metadata: { responseId: 'resp-1' },
      now: 1_100,
    }));

    const record = store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    });

    expect(record).toMatchObject({
      ownerKind: 'task',
      ownerId: 'owner-1',
      status: 'completed',
      ok: true,
      expectationId: expectation.id,
      evidenceIds: [evidence.id],
      createdAt: 1_200,
    });
    expect(store.listCompletionRecords({ ownerKind: 'task', ownerId: 'owner-1', status: 'completed' })).toEqual([record]);
  });

  it('rejects a completed owner with no evidence and records the failed validation', () => {
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));

    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    })).toThrow(CompletionEvidenceValidationError);

    const [record] = store.listCompletionRecords({ ownerKind: 'task', ownerId: 'owner-1' });
    expect(record).toMatchObject({
      status: 'completed',
      ok: false,
      failureKind: 'evidence_missing',
      message: 'Completion evidence is missing for the target owner.',
      evidenceIds: [],
      createdAt: 1_200,
    });
  });

  it('rejects a legacy expectation for a new completion', () => {
    store.upsertExpectation(taskExpectation({
      expectedKinds: ['answer'],
      source: 'legacy_classifier',
      confidence: 'legacy',
      now: 1_000,
    }));
    store.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '已直接回答。',
      metadata: { responseId: 'resp-1' },
      now: 1_100,
    }));

    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    })).toThrow(/Legacy completion expectations cannot authorize completed status/);

    const [record] = store.listCompletionRecords({ ownerKind: 'task', ownerId: 'owner-1' });
    expect(record).toMatchObject({
      status: 'completed',
      ok: false,
      failureKind: 'validation_failed',
    });
  });

  it('does not expose orphan evidence to the validator', () => {
    store.upsertExpectation(taskExpectation({ expectedKinds: ['answer'], now: 1_000 }));
    const evidence = store.insertEvidence(taskEvidence({
      kind: 'answer',
      summary: '已直接回答。',
      metadata: { responseId: 'resp-1' },
      now: 1_100,
    }));
    expect(store.markEvidenceOrphaned(evidence.id, 1_150)).toBe(true);

    expect(store.listEvidenceForOwner('task', 'owner-1')).toEqual([]);
    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    })).toThrow(/Completion evidence is missing/);

    const [record] = store.listCompletionRecords({ ownerKind: 'task', ownerId: 'owner-1' });
    expect(record).toMatchObject({
      ok: false,
      failureKind: 'evidence_missing',
      evidenceIds: [],
    });
  });

  it('records blocked owners when blocked evidence exists', () => {
    const evidence = store.insertEvidence(taskEvidence({
      kind: 'blocked',
      summary: '等待用户补充验收标准。',
      now: 2_000,
    }));

    const record = store.blockOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 2_100,
    });

    expect(record).toMatchObject({
      status: 'blocked',
      ok: true,
      evidenceIds: [evidence.id],
    });
    expect(store.listCompletionRecords({ status: 'blocked' })).toEqual([record]);
  });

  it('rejects completed file artifact owners when declared local paths are missing', () => {
    const workspaceRoot = join(rootDir, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    store.upsertExpectation(taskExpectation({ expectedKinds: ['file_artifact'], now: 1_000 }));
    store.insertEvidence(taskEvidence({
      kind: 'file_artifact',
      summary: 'Report generated.',
      metadata: {
        workspaceRoot,
        localPaths: ['missing.md'],
      },
      now: 1_100,
    }));

    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    })).toThrow(/File artifact evidence local path is missing: missing.md/);
  });

  it('accepts completed file artifact owners when declared local paths exist', () => {
    const workspaceRoot = join(rootDir, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'report.md'), '# Report\n');
    store.upsertExpectation(taskExpectation({ expectedKinds: ['file_artifact'], now: 1_000 }));
    const evidence = store.insertEvidence(taskEvidence({
      kind: 'file_artifact',
      summary: 'Report generated.',
      metadata: {
        workspaceRoot,
        localPaths: ['report.md'],
      },
      now: 1_100,
    }));

    const record = store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    });

    expect(record).toMatchObject({
      ok: true,
      evidenceIds: [evidence.id],
    });
  });

  it('does not let invalid local paths override a valid file artifact URI', () => {
    store.upsertExpectation(taskExpectation({ expectedKinds: ['file_artifact'], now: 1_000 }));
    const evidence = store.insertEvidence(taskEvidence({
      kind: 'file_artifact',
      summary: 'Report uploaded.',
      uri: 'https://example.com/report.md',
      metadata: {
        localPaths: ['missing.md'],
      },
      now: 1_100,
    }));

    const record = store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    });

    expect(record).toMatchObject({
      ok: true,
      evidenceIds: [evidence.id],
    });
  });

  it.skipIf(process.platform === 'win32')('rejects file artifact local paths that escape through a symlinked directory', () => {
    const workspaceRoot = join(rootDir, 'workspace');
    const outsideRoot = join(rootDir, 'outside');
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(outsideRoot, 'report.md'), '# Outside Report\n');
    symlinkSync(outsideRoot, join(workspaceRoot, 'linked'), 'dir');
    store.upsertExpectation(taskExpectation({ expectedKinds: ['file_artifact'], now: 1_000 }));
    store.insertEvidence(taskEvidence({
      kind: 'file_artifact',
      summary: 'Report generated.',
      metadata: {
        workspaceRoot,
        localPaths: ['linked/report.md'],
      },
      now: 1_100,
    }));

    expect(() => store.completeOwnerWithEvidence({
      ownerKind: 'task',
      ownerId: 'owner-1',
      now: 1_200,
    })).toThrow(/File artifact evidence local path escapes workspace: linked\/report\.md/);
  });
});

function taskExpectation(input: {
  expectedKinds: CompletionExpectation['expectedKinds'];
  source?: CompletionExpectation['source'];
  confidence?: CompletionExpectation['confidence'];
  metadata?: Record<string, unknown>;
  now?: number;
}): CompletionExpectation & { metadata?: Record<string, unknown>; now?: number } {
  return {
    ownerKind: 'task',
    ownerId: 'owner-1',
    expectedKinds: input.expectedKinds,
    source: input.source ?? 'task_spec',
    confidence: input.confidence ?? 'explicit',
    metadata: input.metadata,
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
