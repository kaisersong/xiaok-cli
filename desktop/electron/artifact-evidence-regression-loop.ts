import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { validateCompletionEvidence } from '../../src/runtime/guards/completion-evidence.js';
import type {
  CompletionEvidenceRecord,
  CompletionExpectation,
  CompletionKind,
  CompletionOwnerKind,
} from './completion-evidence-types.js';
import { BUILT_IN_LOOP_IDS } from './loop-types.js';

export const ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID = BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION;
export const ARTIFACT_EVIDENCE_SOURCE_OWNER_ID = 'desktop-sqlite-completion-source';

export type EvidenceAnomalyKind =
  | 'completed_without_evidence'
  | 'artifact_kind_mismatch'
  | 'legacy_unclassified_completion'
  | 'source_unavailable'
  | 'validation_failed';

export type EvidenceAnomalyStatus = 'open' | 'resolved' | 'ignored';

export type ArtifactEvidenceRegressionNextActionKind =
  | 'none'
  | 'inspect_anomalies'
  | 'inspect_source';

export interface EvidenceAnomaly {
  id: string;
  loopId: typeof ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID;
  ownerKind: CompletionOwnerKind;
  ownerId: string;
  kind: EvidenceAnomalyKind;
  status: EvidenceAnomalyStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  lastResolvedAt?: number;
  seenCount: number;
  ignoredUntil?: number;
  message: string;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
}

export interface ArtifactEvidenceRegressionScanInput {
  loopRunId?: string;
  now?: number;
}

export interface ArtifactEvidenceRegressionScanResult {
  loopId: typeof ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID;
  loopRunId?: string;
  scannedOwnerCount: number;
  openAnomalyCount: number;
  resolvedAnomalyCount: number;
  anomalies: EvidenceAnomaly[];
  summaryEvidence: {
    kind: 'log_diagnostic';
    summary: string;
    metadata: {
      findings: string[];
      loopRunId?: string;
      scannedOwnerCount: number;
      openAnomalyCount: number;
      resolvedAnomalyCount: number;
    };
  };
  nextActionKind: ArtifactEvidenceRegressionNextActionKind;
  nextActionSummary?: string;
}

export interface EvidenceAnomalyFilter {
  loopId?: typeof ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID;
  ownerKind?: CompletionOwnerKind;
  ownerId?: string;
  kind?: EvidenceAnomalyKind;
  status?: EvidenceAnomalyStatus;
}

interface CompletionRecordRow {
  id: string;
  owner_kind: CompletionOwnerKind;
  owner_id: string;
  status: string;
  ok: number;
  failure_kind: string | null;
  message: string | null;
  expectation_id: string | null;
  evidence_ids_json: string;
  created_at: number;
}

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
  kind: CompletionKind;
  summary: string;
  uri: string | null;
  metadata_json: string;
  created_at: number;
  orphaned_at: number | null;
}

interface EvidenceAnomalyRow {
  id: string;
  loop_id: typeof ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID;
  owner_kind: CompletionOwnerKind;
  owner_id: string;
  kind: EvidenceAnomalyKind;
  status: EvidenceAnomalyStatus;
  first_seen_at: number;
  last_seen_at: number;
  last_resolved_at: number | null;
  seen_count: number;
  ignored_until: number | null;
  message: string;
  evidence_ids_json: string;
  metadata_json: string;
}

interface PendingAnomaly {
  ownerKind: CompletionOwnerKind;
  ownerId: string;
  kind: EvidenceAnomalyKind;
  message: string;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
}

interface OwnerSnapshot {
  record: CompletionRecordRow;
  expectation?: CompletionExpectation;
  evidence: Array<CompletionEvidenceRecord & { id: string }>;
}

const SCANNER_ANOMALY_KINDS: EvidenceAnomalyKind[] = [
  'completed_without_evidence',
  'artifact_kind_mismatch',
  'legacy_unclassified_completion',
  'validation_failed',
];

export class ArtifactEvidenceRegressionScanner {
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

  scan(input: ArtifactEvidenceRegressionScanInput = {}): ArtifactEvidenceRegressionScanResult {
    const now = input.now ?? Date.now();
    try {
      return this.transaction(() => this.scanCompletionSource(input.loopRunId, now));
    } catch (error) {
      if (!isSourceUnavailableError(error)) {
        throw error;
      }
      return this.transaction(() => this.recordSourceUnavailable(input.loopRunId, now, error));
    }
  }

  listAnomalies(filter: EvidenceAnomalyFilter = {}): EvidenceAnomaly[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.loopId) {
      clauses.push('loop_id = ?');
      params.push(filter.loopId);
    }
    if (filter.ownerKind) {
      clauses.push('owner_kind = ?');
      params.push(filter.ownerKind);
    }
    if (filter.ownerId) {
      clauses.push('owner_id = ?');
      params.push(filter.ownerId);
    }
    if (filter.kind) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
    const rows = typedRows<EvidenceAnomalyRow>(this.db.prepare(`
      select * from evidence_anomalies${where}
      order by first_seen_at asc, owner_kind asc, owner_id asc, kind asc
    `).all(...params));
    return rows.map(row => this.anomalyRowToRecord(row));
  }

  ignoreAnomaly(id: string, ignoredUntil: number, now: number): EvidenceAnomaly | undefined {
    const result = this.db.prepare(`
      update evidence_anomalies
      set status = 'ignored', ignored_until = ?, last_resolved_at = null
      where id = ? and status != 'resolved'
    `).run(ignoredUntil, id);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getAnomalyById(id);
  }

  private scanCompletionSource(
    loopRunId: string | undefined,
    now: number
  ): ArtifactEvidenceRegressionScanResult {
    const snapshots = this.loadCompletedOwnerSnapshots();
    const scannedOwnerKeys = new Set<string>();
    const activeAnomalyKeys = new Set<string>();

    for (const snapshot of snapshots) {
      const ownerKey = ownerKeyOf(snapshot.record.owner_kind, snapshot.record.owner_id);
      scannedOwnerKeys.add(ownerKey);
      const pending = this.detectAnomaly(snapshot, loopRunId);
      if (!pending) {
        continue;
      }
      activeAnomalyKeys.add(anomalyKeyOf(
        ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
        pending.ownerKind,
        pending.ownerId,
        pending.kind
      ));
      this.upsertAnomaly(pending, now);
    }

    const resolvedAnomalyCount = this.resolveInactiveAnomalies(scannedOwnerKeys, activeAnomalyKeys, now);
    const sourceResolvedCount = this.resolveSourceUnavailable(now);
    const anomalies = this.listAnomalies({ loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID });
    const openAnomalyCount = countByStatus(anomalies, 'open');
    const resolvedCount = resolvedAnomalyCount + sourceResolvedCount;

    return this.resultFromAnomalies({
      loopRunId,
      scannedOwnerCount: snapshots.length,
      resolvedAnomalyCount: resolvedCount,
      anomalies,
      nextActionKind: openAnomalyCount > 0 ? 'inspect_anomalies' : 'none',
    });
  }

  private loadCompletedOwnerSnapshots(): OwnerSnapshot[] {
    const rows = typedRows<CompletionRecordRow>(this.db.prepare(`
      select * from completion_records
      where status = 'completed'
      order by owner_kind asc, owner_id asc, created_at desc, id desc
    `).all());
    const latestRows: CompletionRecordRow[] = [];
    const seenOwners = new Set<string>();
    for (const row of rows) {
      const ownerKey = ownerKeyOf(row.owner_kind, row.owner_id);
      if (seenOwners.has(ownerKey)) {
        continue;
      }
      seenOwners.add(ownerKey);
      latestRows.push(row);
    }

    return latestRows.map(record => ({
      record,
      expectation: this.getExpectation(record.owner_kind, record.owner_id),
      evidence: this.listEvidenceForOwner(record.owner_kind, record.owner_id),
    }));
  }

  private getExpectation(ownerKind: CompletionOwnerKind, ownerId: string): CompletionExpectation | undefined {
    const row = this.db.prepare(`
      select * from completion_expectations
      where owner_kind = ? and owner_id = ?
    `).get(ownerKind, ownerId) as CompletionExpectationRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      expectedKinds: parseJson<CompletionKind[]>(row.expected_kinds_json),
      source: row.source,
      confidence: row.confidence,
    };
  }

  private listEvidenceForOwner(
    ownerKind: CompletionOwnerKind,
    ownerId: string
  ): Array<CompletionEvidenceRecord & { id: string }> {
    const rows = typedRows<CompletionEvidenceRow>(this.db.prepare(`
      select * from completion_evidence
      where owner_kind = ? and owner_id = ? and orphaned_at is null
      order by created_at asc, id asc
    `).all(ownerKind, ownerId));
    return rows.map(row => ({
      id: row.id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      kind: row.kind,
      summary: row.summary,
      uri: row.uri ?? undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    }));
  }

  private detectAnomaly(snapshot: OwnerSnapshot, loopRunId: string | undefined): PendingAnomaly | undefined {
    const { record, expectation, evidence } = snapshot;
    if (!expectation) {
      return {
        ownerKind: record.owner_kind,
        ownerId: record.owner_id,
        kind: 'legacy_unclassified_completion',
        message: 'Completed owner has no completion expectation.',
        evidenceIds: [],
        metadata: stripUndefined({
          completionRecordId: record.id,
          completionRecordCreatedAt: record.created_at,
          loopRunId,
        }),
      };
    }

    const validation = validateCompletionEvidence({
      ownerKind: record.owner_kind,
      ownerId: record.owner_id,
      targetStatus: 'completed',
      expectation,
      evidence,
    });
    if (validation.ok) {
      return undefined;
    }

    const metadata = stripUndefined({
      expectedKinds: expectation.expectedKinds,
      evidenceKinds: unique(evidence.map(item => item.kind)),
      failureKind: validation.failureKind ?? 'validation_failed',
      completionRecordId: record.id,
      completionRecordCreatedAt: record.created_at,
      loopRunId,
    });

    if (validation.failureKind === 'evidence_missing') {
      return {
        ownerKind: record.owner_kind,
        ownerId: record.owner_id,
        kind: 'completed_without_evidence',
        message: validation.message ?? 'Completed owner is missing completion evidence.',
        evidenceIds: evidence.map(item => item.id),
        metadata,
      };
    }

    if (validation.failureKind === 'evidence_kind_mismatch') {
      return {
        ownerKind: record.owner_kind,
        ownerId: record.owner_id,
        kind: 'artifact_kind_mismatch',
        message: validation.message ?? 'Completion evidence kind does not match the expected completion kind.',
        evidenceIds: evidence.map(item => item.id),
        metadata,
      };
    }

    return {
      ownerKind: record.owner_kind,
      ownerId: record.owner_id,
      kind: 'validation_failed',
      message: validation.message ?? 'Completion evidence failed validation.',
      evidenceIds: evidence.map(item => item.id),
      metadata,
    };
  }

  private upsertAnomaly(input: PendingAnomaly, now: number): EvidenceAnomaly {
    const existing = this.getAnomalyByUnique(input.ownerKind, input.ownerId, input.kind);
    if (existing?.status === 'ignored' && existing.ignoredUntil !== undefined && existing.ignoredUntil > now) {
      return existing;
    }

    const evidenceIdsJson = JSON.stringify(input.evidenceIds);
    const metadataJson = JSON.stringify(input.metadata);
    if (existing) {
      this.db.prepare(`
        update evidence_anomalies
        set status = 'open',
            last_seen_at = ?,
            last_resolved_at = null,
            seen_count = seen_count + 1,
            ignored_until = null,
            message = ?,
            evidence_ids_json = ?,
            metadata_json = ?
        where id = ?
      `).run(now, input.message, evidenceIdsJson, metadataJson, existing.id);
      const updated = this.getAnomalyById(existing.id);
      if (!updated) {
        throw new Error('Evidence anomaly update did not persist a record.');
      }
      return updated;
    }

    const id = randomUUID();
    this.db.prepare(`
      insert into evidence_anomalies (
        id, loop_id, owner_kind, owner_id, kind, status, first_seen_at, last_seen_at,
        last_resolved_at, seen_count, ignored_until, message, evidence_ids_json, metadata_json
      ) values (
        @id, @loopId, @ownerKind, @ownerId, @kind, 'open', @firstSeenAt, @lastSeenAt,
        null, 1, null, @message, @evidenceIdsJson, @metadataJson
      )
    `).run({
      id,
      loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      kind: input.kind,
      firstSeenAt: now,
      lastSeenAt: now,
      message: input.message,
      evidenceIdsJson,
      metadataJson,
    });
    const inserted = this.getAnomalyById(id);
    if (!inserted) {
      throw new Error('Evidence anomaly insert did not persist a record.');
    }
    return inserted;
  }

  private resolveInactiveAnomalies(
    scannedOwnerKeys: Set<string>,
    activeAnomalyKeys: Set<string>,
    now: number
  ): number {
    if (scannedOwnerKeys.size === 0) {
      return 0;
    }
    const rows = typedRows<EvidenceAnomalyRow>(this.db.prepare(`
      select * from evidence_anomalies
      where loop_id = ?
        and status in ('open', 'ignored')
        and kind in (${SCANNER_ANOMALY_KINDS.map(() => '?').join(', ')})
      order by first_seen_at asc, id asc
    `).all(ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID, ...SCANNER_ANOMALY_KINDS));

    let resolved = 0;
    for (const row of rows) {
      if (!scannedOwnerKeys.has(ownerKeyOf(row.owner_kind, row.owner_id))) {
        continue;
      }
      if (activeAnomalyKeys.has(anomalyKeyOf(row.loop_id, row.owner_kind, row.owner_id, row.kind))) {
        continue;
      }
      const result = this.db.prepare(`
        update evidence_anomalies
        set status = 'resolved', last_resolved_at = ?, ignored_until = null
        where id = ? and status in ('open', 'ignored')
      `).run(now, row.id);
      resolved += Number(result.changes);
    }
    return resolved;
  }

  private resolveSourceUnavailable(now: number): number {
    const result = this.db.prepare(`
      update evidence_anomalies
      set status = 'resolved', last_resolved_at = ?, ignored_until = null
      where loop_id = ?
        and owner_kind = 'loop_run'
        and kind = 'source_unavailable'
        and status in ('open', 'ignored')
    `).run(now, ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID);
    return Number(result.changes);
  }

  private recordSourceUnavailable(
    loopRunId: string | undefined,
    now: number,
    error: unknown
  ): ArtifactEvidenceRegressionScanResult {
    this.upsertAnomaly({
      ownerKind: 'loop_run',
      ownerId: ARTIFACT_EVIDENCE_SOURCE_OWNER_ID,
      kind: 'source_unavailable',
      message: `Desktop SQLite source is unavailable: ${errorMessage(error)}`,
      evidenceIds: [],
      metadata: stripUndefined({
        loopRunId,
        errorMessage: errorMessage(error),
      }),
    }, now);

    const anomalies = this.listAnomalies({ loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID });
    const openAnomalyCount = countByStatus(anomalies, 'open');
    return this.resultFromAnomalies({
      loopRunId,
      scannedOwnerCount: 0,
      resolvedAnomalyCount: 0,
      anomalies,
      nextActionKind: openAnomalyCount > 0 ? 'inspect_source' : 'none',
    });
  }

  private resultFromAnomalies(input: {
    loopRunId?: string;
    scannedOwnerCount: number;
    resolvedAnomalyCount: number;
    anomalies: EvidenceAnomaly[];
    nextActionKind: ArtifactEvidenceRegressionNextActionKind;
  }): ArtifactEvidenceRegressionScanResult {
    const openAnomalyCount = countByStatus(input.anomalies, 'open');
    const openFindings = input.anomalies
      .filter(anomaly => anomaly.status === 'open')
      .map(anomaly => `${anomaly.kind}:${anomaly.ownerKind}:${anomaly.ownerId}`);
    const findings = findingsForResult(openFindings, input.scannedOwnerCount, input.resolvedAnomalyCount);
    const summary = summaryForResult(openAnomalyCount, input.resolvedAnomalyCount, input.nextActionKind);
    return {
      loopId: ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
      loopRunId: input.loopRunId,
      scannedOwnerCount: input.scannedOwnerCount,
      openAnomalyCount,
      resolvedAnomalyCount: input.resolvedAnomalyCount,
      anomalies: input.anomalies,
      summaryEvidence: {
        kind: 'log_diagnostic',
        summary,
        metadata: stripUndefined({
          findings,
          loopRunId: input.loopRunId,
          scannedOwnerCount: input.scannedOwnerCount,
          openAnomalyCount,
          resolvedAnomalyCount: input.resolvedAnomalyCount,
        }) as ArtifactEvidenceRegressionScanResult['summaryEvidence']['metadata'],
      },
      nextActionKind: input.nextActionKind,
      nextActionSummary: nextActionSummary(input.nextActionKind, openAnomalyCount),
    };
  }

  private getAnomalyByUnique(
    ownerKind: CompletionOwnerKind,
    ownerId: string,
    kind: EvidenceAnomalyKind
  ): EvidenceAnomaly | undefined {
    const row = this.db.prepare(`
      select * from evidence_anomalies
      where loop_id = ? and owner_kind = ? and owner_id = ? and kind = ?
    `).get(ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID, ownerKind, ownerId, kind) as EvidenceAnomalyRow | undefined;
    return row ? this.anomalyRowToRecord(row) : undefined;
  }

  private getAnomalyById(id: string): EvidenceAnomaly | undefined {
    const row = this.db.prepare('select * from evidence_anomalies where id = ?').get(id) as EvidenceAnomalyRow | undefined;
    return row ? this.anomalyRowToRecord(row) : undefined;
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists evidence_anomalies (
        id text primary key,
        loop_id text not null,
        owner_kind text not null,
        owner_id text not null,
        kind text not null,
        status text not null,
        first_seen_at integer not null,
        last_seen_at integer not null,
        last_resolved_at integer,
        seen_count integer not null,
        ignored_until integer,
        message text not null,
        evidence_ids_json text not null,
        metadata_json text not null default '{}',
        unique(loop_id, owner_kind, owner_id, kind)
      );

      create index if not exists idx_evidence_anomalies_status
      on evidence_anomalies(loop_id, status, last_seen_at);

      create index if not exists idx_evidence_anomalies_owner
      on evidence_anomalies(loop_id, owner_kind, owner_id);
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

  private anomalyRowToRecord(row: EvidenceAnomalyRow): EvidenceAnomaly {
    return {
      id: row.id,
      loopId: row.loop_id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      kind: row.kind,
      status: row.status,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastResolvedAt: row.last_resolved_at ?? undefined,
      seenCount: row.seen_count,
      ignoredUntil: row.ignored_until ?? undefined,
      message: row.message,
      evidenceIds: parseJson<string[]>(row.evidence_ids_json),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    };
  }
}

function countByStatus(anomalies: EvidenceAnomaly[], status: EvidenceAnomalyStatus): number {
  return anomalies.filter(anomaly => anomaly.status === status).length;
}

function ownerKeyOf(ownerKind: CompletionOwnerKind, ownerId: string): string {
  return `${ownerKind}\u0000${ownerId}`;
}

function anomalyKeyOf(
  loopId: typeof ARTIFACT_EVIDENCE_REGRESSION_LOOP_ID,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  kind: EvidenceAnomalyKind
): string {
  return `${loopId}\u0000${ownerKind}\u0000${ownerId}\u0000${kind}`;
}

function unique<T>(items: T[]): T[] {
  return items.filter((item, index) => items.indexOf(item) === index);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function summaryForResult(
  openAnomalyCount: number,
  resolvedAnomalyCount: number,
  nextActionKind: ArtifactEvidenceRegressionNextActionKind
): string {
  if (nextActionKind === 'inspect_source') {
    return 'Artifact evidence regression scanner could not read the desktop SQLite source.';
  }
  if (openAnomalyCount > 0) {
    return `Artifact evidence regression scanner found ${openAnomalyCount} open anomaly${openAnomalyCount === 1 ? '' : 'ies'}.`;
  }
  if (resolvedAnomalyCount > 0) {
    return `Artifact evidence regression scanner resolved ${resolvedAnomalyCount} anomaly${resolvedAnomalyCount === 1 ? '' : 'ies'}.`;
  }
  return 'Artifact evidence regression scanner found no open anomalies.';
}

function findingsForResult(
  openFindings: string[],
  scannedOwnerCount: number,
  resolvedAnomalyCount: number
): string[] {
  if (openFindings.length > 0) {
    return openFindings;
  }
  if (resolvedAnomalyCount > 0) {
    return [`resolved_anomalies:${resolvedAnomalyCount}`];
  }
  return [`scan_completed:scanned_owners=${scannedOwnerCount}`];
}

function nextActionSummary(
  nextActionKind: ArtifactEvidenceRegressionNextActionKind,
  openAnomalyCount: number
): string | undefined {
  switch (nextActionKind) {
    case 'inspect_anomalies':
      return `Inspect ${openAnomalyCount} open artifact evidence anomaly${openAnomalyCount === 1 ? '' : 'ies'}.`;
    case 'inspect_source':
      return 'Inspect the desktop SQLite completion evidence source.';
    case 'none':
      return undefined;
  }
}

function isSourceUnavailableError(error: unknown): boolean {
  const message = errorMessage(error);
  return /no such table|no such column|SQLITE_CORRUPT|database disk image is malformed|file is not a database|unable to open database file|malformed JSON|Unexpected token|not valid JSON/iu.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
