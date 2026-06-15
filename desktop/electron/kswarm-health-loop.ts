import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  BUILT_IN_LOOP_IDS,
} from './loop-types.js';
import {
  classifyKSwarmHealth,
  highestSeverityFinding,
  type KSwarmHealthDiagnosticInput,
  type KSwarmHealthFinding,
} from './kswarm-service-diagnostics.js';

export const KSWARM_SERVICE_HEALTH_LOOP_ID = BUILT_IN_LOOP_IDS.KSWARM_SERVICE_HEALTH;
export const KSWARM_SERVICE_HEALTH_OWNER_ID = 'kswarm-service';

export type KSwarmHealthAnomalyStatus = 'open' | 'resolved' | 'ignored';
export type KSwarmHealthNextActionKind =
  | 'none'
  | 'inspect_kswarm_health'
  | 'inspect_kswarm_health_source';

export interface KSwarmHealthAnomaly {
  id: string;
  loopId: typeof KSWARM_SERVICE_HEALTH_LOOP_ID;
  ownerKind: 'loop_run';
  ownerId: typeof KSWARM_SERVICE_HEALTH_OWNER_ID;
  kind: KSwarmHealthFinding['kind'] | 'source_unavailable';
  status: KSwarmHealthAnomalyStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  lastResolvedAt?: number;
  seenCount: number;
  ignoredUntil?: number;
  message: string;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
}

export interface KSwarmHealthAnomalyFilter {
  loopId?: typeof KSWARM_SERVICE_HEALTH_LOOP_ID;
  status?: KSwarmHealthAnomalyStatus;
}

export interface KSwarmServiceHealthScanInput {
  loopRunId?: string;
  now?: number;
}

export interface KSwarmServiceHealthScanResult {
  loopId: typeof KSWARM_SERVICE_HEALTH_LOOP_ID;
  loopRunId?: string;
  openAnomalyCount: number;
  resolvedAnomalyCount: number;
  anomalies: KSwarmHealthAnomaly[];
  summaryEvidence: {
    kind: 'log_diagnostic';
    summary: string;
    metadata: {
      findings: string[];
      loopRunId?: string;
      openAnomalyCount: number;
      resolvedAnomalyCount: number;
      diagnosticKinds: string[];
      logPaths: string[];
      suggestedActions: string[];
      notificationDecision?: Record<string, unknown>;
    };
  };
  nextActionKind: KSwarmHealthNextActionKind;
  nextActionSummary?: string;
}

export interface KSwarmServiceHealthScannerOptions {
  probe: () => KSwarmHealthDiagnosticInput | Promise<KSwarmHealthDiagnosticInput>;
  logPaths?: string[];
}

interface EvidenceAnomalyRow {
  id: string;
  loop_id: typeof KSWARM_SERVICE_HEALTH_LOOP_ID;
  owner_kind: 'loop_run';
  owner_id: typeof KSWARM_SERVICE_HEALTH_OWNER_ID;
  kind: KSwarmHealthAnomaly['kind'];
  status: KSwarmHealthAnomalyStatus;
  first_seen_at: number;
  last_seen_at: number;
  last_resolved_at: number | null;
  seen_count: number;
  ignored_until: number | null;
  message: string;
  evidence_ids_json: string;
  metadata_json: string;
}

interface PendingHealthAnomaly {
  kind: KSwarmHealthAnomaly['kind'];
  message: string;
  metadata: Record<string, unknown>;
}

export class KSwarmServiceHealthScanner {
  private readonly db: DatabaseSync;
  private readonly probe: () => KSwarmHealthDiagnosticInput | Promise<KSwarmHealthDiagnosticInput>;
  private readonly logPaths: string[];

  constructor(dbPath: string, options: KSwarmServiceHealthScannerOptions) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.applySchema();
    this.probe = options.probe;
    this.logPaths = options.logPaths ?? [];
  }

  close(): void {
    this.db.close();
  }

  scan(input: KSwarmServiceHealthScanInput = {}): KSwarmServiceHealthScanResult | Promise<KSwarmServiceHealthScanResult> {
    const now = input.now ?? Date.now();
    let probeResult: KSwarmHealthDiagnosticInput | Promise<KSwarmHealthDiagnosticInput>;
    try {
      probeResult = this.probe();
    } catch (error) {
      return this.transaction(() => this.recordSourceUnavailable(input.loopRunId, now, error));
    }
    if (isPromiseLike(probeResult)) {
      return probeResult
        .then(result => this.transaction(() => this.recordFindings(input.loopRunId, now, classifyKSwarmHealth(result))))
        .catch(error => this.transaction(() => this.recordSourceUnavailable(input.loopRunId, now, error)));
    }
    return this.transaction(() => {
      try {
        const findings = classifyKSwarmHealth(probeResult);
        return this.recordFindings(input.loopRunId, now, findings);
      } catch (error) {
        return this.recordSourceUnavailable(input.loopRunId, now, error);
      }
    });
  }

  listAnomalies(filter: KSwarmHealthAnomalyFilter = {}): KSwarmHealthAnomaly[] {
    const clauses: string[] = ['loop_id = ?'];
    const params: SQLInputValue[] = [filter.loopId ?? KSWARM_SERVICE_HEALTH_LOOP_ID];
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const rows = typedRows<EvidenceAnomalyRow>(this.db.prepare(`
      select * from evidence_anomalies
      where ${clauses.join(' and ')}
      order by first_seen_at asc, owner_kind asc, owner_id asc, kind asc
    `).all(...params));
    return rows.map(row => this.anomalyRowToRecord(row));
  }

  private recordFindings(
    loopRunId: string | undefined,
    now: number,
    findings: KSwarmHealthFinding[]
  ): KSwarmServiceHealthScanResult {
    const activeKinds = new Set<KSwarmHealthAnomaly['kind']>();
    for (const healthFinding of findings) {
      activeKinds.add(healthFinding.kind);
      this.upsertAnomaly({
        kind: healthFinding.kind,
        message: healthFinding.summary,
        metadata: {
          ...healthFinding.metadata,
          severity: healthFinding.severity,
          suggestedActionKind: healthFinding.suggestedActionKind,
          suggestedActionSummary: healthFinding.suggestedActionSummary,
          loopRunId,
        },
      }, now);
    }
    const resolvedAnomalyCount = this.resolveInactiveAnomalies(activeKinds, now);
    const anomalies = this.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID });
    const highest = highestSeverityFinding(findings);
    const shouldBlock = highest !== undefined && (highest.severity === 'high' || highest.severity === 'medium');
    return this.resultFromAnomalies({
      loopRunId,
      anomalies,
      resolvedAnomalyCount,
      nextActionKind: shouldBlock ? 'inspect_kswarm_health' : 'none',
      nextActionSummary: shouldBlock ? highest.suggestedActionSummary : undefined,
    });
  }

  private recordSourceUnavailable(
    loopRunId: string | undefined,
    now: number,
    error: unknown
  ): KSwarmServiceHealthScanResult {
    this.upsertAnomaly({
      kind: 'source_unavailable',
      message: `KSwarm health source is unavailable: ${errorMessage(error)}`,
      metadata: {
        loopRunId,
        severity: 'medium',
        suggestedActionKind: 'inspect_kswarm_health_source',
        suggestedActionSummary: 'Inspect the KSwarm health scanner source and desktop service logs.',
        errorMessage: errorMessage(error),
      },
    }, now);
    const anomalies = this.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID });
    return this.resultFromAnomalies({
      loopRunId,
      anomalies,
      resolvedAnomalyCount: 0,
      nextActionKind: 'inspect_kswarm_health_source',
      nextActionSummary: 'Inspect the KSwarm health scanner source and desktop service logs.',
    });
  }

  private upsertAnomaly(input: PendingHealthAnomaly, now: number): KSwarmHealthAnomaly {
    const existing = this.getAnomalyByKind(input.kind);
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
      `).run(now, input.message, JSON.stringify([]), metadataJson, existing.id);
      const updated = this.getAnomalyById(existing.id);
      if (!updated) throw new Error('KSwarm health anomaly update did not persist.');
      return updated;
    }

    const id = randomUUID();
    this.db.prepare(`
      insert into evidence_anomalies (
        id, loop_id, owner_kind, owner_id, kind, status, first_seen_at, last_seen_at,
        last_resolved_at, seen_count, ignored_until, message, evidence_ids_json, metadata_json
      ) values (
        @id, @loopId, 'loop_run', @ownerId, @kind, 'open', @firstSeenAt, @lastSeenAt,
        null, 1, null, @message, @evidenceIdsJson, @metadataJson
      )
    `).run({
      id,
      loopId: KSWARM_SERVICE_HEALTH_LOOP_ID,
      ownerId: KSWARM_SERVICE_HEALTH_OWNER_ID,
      kind: input.kind,
      firstSeenAt: now,
      lastSeenAt: now,
      message: input.message,
      evidenceIdsJson: JSON.stringify([]),
      metadataJson,
    });
    const inserted = this.getAnomalyById(id);
    if (!inserted) throw new Error('KSwarm health anomaly insert did not persist.');
    return inserted;
  }

  private resolveInactiveAnomalies(activeKinds: Set<KSwarmHealthAnomaly['kind']>, now: number): number {
    const rows = typedRows<EvidenceAnomalyRow>(this.db.prepare(`
      select * from evidence_anomalies
      where loop_id = ?
        and status in ('open', 'ignored')
    `).all(KSWARM_SERVICE_HEALTH_LOOP_ID));

    let resolved = 0;
    for (const row of rows) {
      if (activeKinds.has(row.kind)) continue;
      const result = this.db.prepare(`
        update evidence_anomalies
        set status = 'resolved', last_resolved_at = ?, ignored_until = null
        where id = ? and status in ('open', 'ignored')
      `).run(now, row.id);
      resolved += Number(result.changes);
    }
    return resolved;
  }

  private resultFromAnomalies(input: {
    loopRunId?: string;
    anomalies: KSwarmHealthAnomaly[];
    resolvedAnomalyCount: number;
    nextActionKind: KSwarmHealthNextActionKind;
    nextActionSummary?: string;
  }): KSwarmServiceHealthScanResult {
    const openAnomalies = input.anomalies.filter(anomaly => anomaly.status === 'open');
    const openAnomalyCount = openAnomalies.length;
    const diagnosticKinds = openAnomalies.map(anomaly => anomaly.kind);
    const notificationDecision = decideNotification(openAnomalies);
    const findings = openAnomalies.map(anomaly => `${anomaly.kind}:${anomaly.ownerKind}:${anomaly.ownerId}`);
    const suggestedActions = unique(openAnomalies
      .map(anomaly => anomaly.metadata.suggestedActionSummary)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
    const summary = summaryForResult(openAnomalyCount, input.resolvedAnomalyCount, input.nextActionKind);
    return {
      loopId: KSWARM_SERVICE_HEALTH_LOOP_ID,
      loopRunId: input.loopRunId,
      openAnomalyCount,
      resolvedAnomalyCount: input.resolvedAnomalyCount,
      anomalies: input.anomalies,
      summaryEvidence: {
        kind: 'log_diagnostic',
        summary,
        metadata: stripUndefined({
          findings: findingsForResult(findings, input.resolvedAnomalyCount),
          loopRunId: input.loopRunId,
          openAnomalyCount,
          resolvedAnomalyCount: input.resolvedAnomalyCount,
          diagnosticKinds,
          logPaths: this.logPaths,
          suggestedActions,
          notificationDecision,
        }) as KSwarmServiceHealthScanResult['summaryEvidence']['metadata'],
      },
      nextActionKind: input.nextActionKind,
      nextActionSummary: input.nextActionSummary,
    };
  }

  private getAnomalyByKind(kind: KSwarmHealthAnomaly['kind']): KSwarmHealthAnomaly | undefined {
    const row = this.db.prepare(`
      select * from evidence_anomalies
      where loop_id = ? and owner_kind = 'loop_run' and owner_id = ? and kind = ?
    `).get(KSWARM_SERVICE_HEALTH_LOOP_ID, KSWARM_SERVICE_HEALTH_OWNER_ID, kind) as EvidenceAnomalyRow | undefined;
    return row ? this.anomalyRowToRecord(row) : undefined;
  }

  private getAnomalyById(id: string): KSwarmHealthAnomaly | undefined {
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

  private anomalyRowToRecord(row: EvidenceAnomalyRow): KSwarmHealthAnomaly {
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
}

function summaryForResult(
  openAnomalyCount: number,
  resolvedAnomalyCount: number,
  nextActionKind: KSwarmHealthNextActionKind
): string {
  if (nextActionKind === 'inspect_kswarm_health_source') {
    return 'KSwarm service health scanner could not read its source.';
  }
  if (openAnomalyCount > 0) {
    return `KSwarm service health scanner found ${openAnomalyCount} open anomaly${openAnomalyCount === 1 ? '' : 'ies'}.`;
  }
  if (resolvedAnomalyCount > 0) {
    return `KSwarm service health scanner resolved ${resolvedAnomalyCount} anomaly${resolvedAnomalyCount === 1 ? '' : 'ies'}.`;
  }
  return 'KSwarm service health scanner found no open anomalies.';
}

function findingsForResult(openFindings: string[], resolvedAnomalyCount: number): string[] {
  if (openFindings.length > 0) return openFindings;
  if (resolvedAnomalyCount > 0) return [`resolved:${resolvedAnomalyCount}`];
  return ['none'];
}

function parseJson<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined as T;
  }
}

function typedRows<T>(rows: unknown[]): T[] {
  return rows as T[];
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function decideNotification(openAnomalies: KSwarmHealthAnomaly[]): Record<string, unknown> | undefined {
  if (openAnomalies.length === 0) {
    return undefined;
  }
  const sorted = [...openAnomalies].sort((a, b) => notificationPriority(b) - notificationPriority(a));
  const anomaly = sorted[0];
  const dedupKey = `${anomaly.loopId}:${anomaly.kind}:${anomaly.ownerKind}:${anomaly.ownerId}`;
  const severity = typeof anomaly.metadata.severity === 'string' ? anomaly.metadata.severity : 'medium';
  if (severity === 'high' && anomaly.seenCount === 1) {
    return {
      shouldNotify: true,
      reason: 'new_high_severity',
      dedupKey,
      occurrenceCount: anomaly.seenCount,
      summary: anomaly.message,
    };
  }
  if (anomaly.kind === 'source_unavailable' && anomaly.seenCount === 2) {
    return {
      shouldNotify: true,
      reason: 'source_unavailable_repeated',
      dedupKey,
      occurrenceCount: anomaly.seenCount,
      summary: anomaly.message,
    };
  }
  return {
    shouldNotify: false,
    reason: 'deduped',
    dedupKey,
    occurrenceCount: anomaly.seenCount,
    summary: anomaly.message,
  };
}

function notificationPriority(anomaly: KSwarmHealthAnomaly): number {
  const severity = typeof anomaly.metadata.severity === 'string' ? anomaly.metadata.severity : 'medium';
  const severityRank = severity === 'high' ? 4 : severity === 'medium' ? 3 : severity === 'warning' ? 2 : 1;
  const repeatBoost = anomaly.kind === 'source_unavailable' && anomaly.seenCount >= 2 ? 1 : 0;
  return severityRank * 100 + repeatBoost + Math.min(anomaly.seenCount, 10);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function';
}
