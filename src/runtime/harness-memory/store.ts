import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HarnessMemoryEvidence, HarnessMemoryRecord, HarnessMemoryScope } from './types.js';

interface HarnessMemoryDocument {
  schemaVersion: 1;
  records: HarnessMemoryRecord[];
}

export class JsonHarnessMemoryStore {
  constructor(private readonly filePath: string, private readonly now: () => Date = () => new Date()) {}

  createCandidate(input: {
    category: string;
    summary: string;
    scope: HarnessMemoryScope;
    evidence: HarnessMemoryEvidence[];
    expiresAt?: string;
  }): HarnessMemoryRecord {
    const now = this.now().toISOString();
    const record: HarnessMemoryRecord = {
      id: `hm_${this.now().getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      category: input.category,
      summary: input.summary,
      scope: input.scope,
      status: 'candidate',
      evidence: input.evidence,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
    const doc = this.load();
    doc.records.push(record);
    this.persist(doc);
    return record;
  }

  listActive(scope: HarnessMemoryScope): HarnessMemoryRecord[] {
    const nowMs = this.now().getTime();
    return this.load().records.filter((record) => {
      if (record.status !== 'active') return false;
      if (record.expiresAt && Date.parse(record.expiresAt) <= nowMs) return false;
      return scopeMatches(record.scope, scope);
    });
  }

  promote(id: string, input: {
    promotedBy: 'human' | 'eval' | 'diagnoser';
    reason: string;
    evidence: HarnessMemoryEvidence[];
  }): HarnessMemoryRecord {
    if (input.evidence.length === 0 || input.evidence.some((item) => item.evidenceIds.length === 0)) {
      throw new Error('promotion evidence is required');
    }
    const doc = this.load();
    const index = doc.records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`harness memory not found: ${id}`);
    const next: HarnessMemoryRecord = {
      ...doc.records[index],
      status: 'active',
      evidence: mergeEvidence(doc.records[index].evidence, input.evidence),
      promotedBy: input.promotedBy,
      promotionReason: input.reason,
      updatedAt: this.now().toISOString(),
    };
    doc.records[index] = next;
    this.persist(doc);
    return next;
  }

  expire(id: string, reason: string): HarnessMemoryRecord {
    const doc = this.load();
    const index = doc.records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error(`harness memory not found: ${id}`);
    const next: HarnessMemoryRecord = {
      ...doc.records[index],
      status: 'expired',
      expiredReason: reason,
      updatedAt: this.now().toISOString(),
    };
    doc.records[index] = next;
    this.persist(doc);
    return next;
  }

  private load(): HarnessMemoryDocument {
    if (!existsSync(this.filePath)) return { schemaVersion: 1, records: [] };
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<HarnessMemoryDocument>;
    return { schemaVersion: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  }

  private persist(doc: HarnessMemoryDocument): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    let lockFd: number | null = null;
    try {
      lockFd = openSync(lockPath, 'wx');
      const tmpPath = `${this.filePath}.tmp`;
      const content = `${JSON.stringify(doc, null, 2)}\n`;
      const fd = openSync(tmpPath, 'w');
      try {
        writeFileSync(fd, content, 'utf8');
        try { fsyncSync(fd); } catch {}
      } finally {
        closeSync(fd);
      }
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      throw new Error(`harness memory write failed: ${(error as Error).message}`);
    } finally {
      if (lockFd !== null) closeSync(lockFd);
      try { unlinkSync(lockPath); } catch {}
    }
  }
}

function scopeMatches(recordScope: HarnessMemoryScope, requested: HarnessMemoryScope): boolean {
  if (recordScope.repo && recordScope.repo !== requested.repo) return false;
  if (recordScope.projectId && recordScope.projectId !== requested.projectId) return false;
  if (recordScope.runtime && recordScope.runtime !== requested.runtime) return false;
  return true;
}

function mergeEvidence(a: HarnessMemoryEvidence[], b: HarnessMemoryEvidence[]): HarnessMemoryEvidence[] {
  const map = new Map<string, HarnessMemoryEvidence>();
  for (const item of [...a, ...b]) {
    map.set(`${item.traceBundlePath}:${item.evidenceIds.join(',')}`, item);
  }
  return [...map.values()];
}
