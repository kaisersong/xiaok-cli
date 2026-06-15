import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { validateCompletionEvidence } from '../../src/runtime/guards/completion-evidence.js';
import type {
  CompleteOwnerWithEvidenceInput,
  CompletionEvidenceInsertInput,
  CompletionOwnerKind,
  CompletionRecordFilter,
  CompletionRecordStatus,
  CompletionValidationRecord,
  CompletionExpectation,
  CompletionExpectationUpsertInput,
  StoredCompletionEvidenceRecord,
  StoredCompletionExpectation,
} from './completion-evidence-types.js';

interface CompletionExpectationRow {
  id: string;
  schema_version: number;
  owner_kind: CompletionOwnerKind;
  owner_id: string;
  expected_kinds_json: string;
  source: CompletionExpectation['source'];
  confidence: CompletionExpectation['confidence'];
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

interface CompletionEvidenceRow {
  id: string;
  schema_version: number;
  owner_kind: CompletionOwnerKind;
  owner_id: string;
  kind: StoredCompletionEvidenceRecord['kind'];
  summary: string;
  uri: string | null;
  metadata_json: string;
  created_at: number;
  orphaned_at: number | null;
}

interface CompletionRecordRow {
  id: string;
  owner_kind: CompletionOwnerKind;
  owner_id: string;
  status: CompletionRecordStatus;
  ok: number;
  failure_kind: CompletionValidationRecord['failureKind'] | null;
  message: string | null;
  expectation_id: string | null;
  evidence_ids_json: string;
  created_at: number;
}

export class CompletionEvidenceValidationError extends Error {
  readonly record: CompletionValidationRecord;

  constructor(record: CompletionValidationRecord) {
    super(record.message ?? 'Completion evidence validation failed.');
    this.name = 'CompletionEvidenceValidationError';
    this.record = record;
  }
}

export class CompletionEvidenceStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.applySchema();
  }

  close(): void {
    this.db.close();
  }

  upsertExpectation(input: CompletionExpectationUpsertInput): StoredCompletionExpectation {
    const now = input.now ?? Date.now();
    const id = input.id ?? randomUUID();
    const expectedKindsJson = JSON.stringify(input.expectedKinds);
    const metadataJson = JSON.stringify(input.metadata ?? {});

    this.db.prepare(`
      insert into completion_expectations (
        id, schema_version, owner_kind, owner_id, expected_kinds_json, source, confidence,
        metadata_json, created_at, updated_at
      ) values (
        @id, 1, @ownerKind, @ownerId, @expectedKindsJson, @source, @confidence,
        @metadataJson, @createdAt, @updatedAt
      )
      on conflict(owner_kind, owner_id) do update set
        expected_kinds_json = excluded.expected_kinds_json,
        source = excluded.source,
        confidence = excluded.confidence,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run({
      id,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      expectedKindsJson,
      source: input.source,
      confidence: input.confidence,
      metadataJson,
      createdAt: now,
      updatedAt: now,
    });

    const record = this.getExpectation(input.ownerKind, input.ownerId);
    if (!record) {
      throw new Error('Completion expectation upsert did not persist a record.');
    }
    return record;
  }

  insertEvidence(input: CompletionEvidenceInsertInput): StoredCompletionEvidenceRecord {
    const now = input.now ?? Date.now();
    const id = input.id ?? randomUUID();
    const metadataJson = JSON.stringify(input.metadata ?? {});

    this.db.prepare(`
      insert into completion_evidence (
        id, schema_version, owner_kind, owner_id, kind, summary, uri, metadata_json,
        created_at, orphaned_at
      ) values (
        @id, 1, @ownerKind, @ownerId, @kind, @summary, @uri, @metadataJson,
        @createdAt, null
      )
    `).run({
      id,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      kind: input.kind,
      summary: input.summary,
      uri: input.uri ?? null,
      metadataJson,
      createdAt: now,
    });

    const row = this.db.prepare('select * from completion_evidence where id = ?').get(id) as CompletionEvidenceRow | undefined;
    if (!row) {
      throw new Error('Completion evidence insert did not persist a record.');
    }
    return this.evidenceRowToRecord(row);
  }

  completeOwnerWithEvidence(input: CompleteOwnerWithEvidenceInput): CompletionValidationRecord {
    return this.validateOwnerWithEvidence('completed', input);
  }

  blockOwnerWithEvidence(input: CompleteOwnerWithEvidenceInput): CompletionValidationRecord {
    return this.validateOwnerWithEvidence('blocked', input);
  }

  listEvidenceForOwner(ownerKind: CompletionOwnerKind, ownerId: string): StoredCompletionEvidenceRecord[] {
    const rows = typedRows<CompletionEvidenceRow>(this.db.prepare(`
      select * from completion_evidence
      where owner_kind = ? and owner_id = ? and orphaned_at is null
      order by created_at asc, id asc
    `).all(ownerKind, ownerId));
    return rows.map(row => this.evidenceRowToRecord(row));
  }

  listCompletionRecords(filter: CompletionRecordFilter = {}): CompletionValidationRecord[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.ownerKind) {
      clauses.push('owner_kind = ?');
      params.push(filter.ownerKind);
    }
    if (filter.ownerId) {
      clauses.push('owner_id = ?');
      params.push(filter.ownerId);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
    const rows = typedRows<CompletionRecordRow>(this.db.prepare(`
      select * from completion_records${where}
      order by created_at asc, id asc
    `).all(...params));
    return rows.map(row => this.completionRecordRowToRecord(row));
  }

  markEvidenceOrphaned(evidenceId: string, now: number): boolean {
    const result = this.db.prepare(`
      update completion_evidence
      set orphaned_at = ?
      where id = ?
    `).run(now, evidenceId);
    return result.changes === 1;
  }

  private validateOwnerWithEvidence(
    status: CompletionRecordStatus,
    input: CompleteOwnerWithEvidenceInput
  ): CompletionValidationRecord {
    const record = this.transaction(() => {
      const now = input.now ?? Date.now();
      const expectation = this.getExpectation(input.ownerKind, input.ownerId);
      const evidence = this.listEvidenceForOwner(input.ownerKind, input.ownerId);
      const result = validateCompletionEvidence({
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        targetStatus: status,
        expectation,
        evidence,
      });
      const record = this.insertCompletionRecord({
        id: input.recordId ?? randomUUID(),
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        status,
        ok: result.ok,
        failureKind: result.failureKind,
        message: result.message,
        expectationId: expectation?.id,
        evidenceIds: evidence.map(record => record.id),
        createdAt: now,
      });
      return record;
    });
    if (!record.ok) {
      throw new CompletionEvidenceValidationError(record);
    }
    return record;
  }

  private insertCompletionRecord(record: CompletionValidationRecord): CompletionValidationRecord {
    this.db.prepare(`
      insert into completion_records (
        id, owner_kind, owner_id, status, ok, failure_kind, message,
        expectation_id, evidence_ids_json, created_at
      ) values (
        @id, @ownerKind, @ownerId, @status, @ok, @failureKind, @message,
        @expectationId, @evidenceIdsJson, @createdAt
      )
    `).run({
      id: record.id,
      ownerKind: record.ownerKind,
      ownerId: record.ownerId,
      status: record.status,
      ok: record.ok ? 1 : 0,
      failureKind: record.failureKind ?? null,
      message: record.message ?? null,
      expectationId: record.expectationId ?? null,
      evidenceIdsJson: JSON.stringify(record.evidenceIds),
      createdAt: record.createdAt,
    });
    return record;
  }

  private getExpectation(ownerKind: CompletionOwnerKind, ownerId: string): StoredCompletionExpectation | undefined {
    const row = this.db.prepare(`
      select * from completion_expectations
      where owner_kind = ? and owner_id = ?
    `).get(ownerKind, ownerId) as CompletionExpectationRow | undefined;
    return row ? this.expectationRowToRecord(row) : undefined;
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists completion_expectations (
        id text primary key,
        schema_version integer not null,
        owner_kind text not null,
        owner_id text not null,
        expected_kinds_json text not null,
        source text not null,
        confidence text not null,
        metadata_json text not null,
        created_at integer not null,
        updated_at integer not null,
        unique(owner_kind, owner_id)
      );

      create index if not exists idx_completion_expectations_owner
      on completion_expectations(owner_kind, owner_id);

      create table if not exists completion_evidence (
        id text primary key,
        schema_version integer not null,
        owner_kind text not null,
        owner_id text not null,
        kind text not null,
        summary text not null,
        uri text,
        metadata_json text not null,
        created_at integer not null,
        orphaned_at integer
      );

      create index if not exists idx_completion_evidence_owner
      on completion_evidence(owner_kind, owner_id, orphaned_at);

      create table if not exists completion_records (
        id text primary key,
        owner_kind text not null,
        owner_id text not null,
        status text not null,
        ok integer not null,
        failure_kind text,
        message text,
        expectation_id text,
        evidence_ids_json text not null,
        created_at integer not null
      );

      create index if not exists idx_completion_records_filter
      on completion_records(owner_kind, owner_id, status, created_at);
    `);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try {
        this.db.exec('rollback');
      } catch { /* ignore rollback errors */ }
      throw error;
    }
  }

  private expectationRowToRecord(row: CompletionExpectationRow): StoredCompletionExpectation {
    const metadata = parseJson<Record<string, unknown>>(row.metadata_json);
    return {
      id: row.id,
      schemaVersion: 1,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      expectedKinds: parseJson<StoredCompletionExpectation['expectedKinds']>(row.expected_kinds_json),
      source: row.source,
      confidence: row.confidence,
      metadata,
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private evidenceRowToRecord(row: CompletionEvidenceRow): StoredCompletionEvidenceRecord {
    const metadata = parseJson<Record<string, unknown>>(row.metadata_json);
    return {
      id: row.id,
      schemaVersion: 1,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      kind: row.kind,
      summary: row.summary,
      uri: row.uri ?? undefined,
      metadata,
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
      orphanedAt: row.orphaned_at ?? undefined,
    };
  }

  private completionRecordRowToRecord(row: CompletionRecordRow): CompletionValidationRecord {
    return {
      id: row.id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      status: row.status,
      ok: row.ok === 1,
      failureKind: row.failure_kind ?? undefined,
      message: row.message ?? undefined,
      expectationId: row.expectation_id ?? undefined,
      evidenceIds: parseJson<string[]>(row.evidence_ids_json),
      createdAt: row.created_at,
    };
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}
