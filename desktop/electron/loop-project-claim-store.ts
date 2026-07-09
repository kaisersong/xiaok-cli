import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type LoopProjectClaimOwnerKind = 'loop_run' | 'kswarm_po' | 'user';

export interface LoopProjectClaim {
  id: string;
  projectId: string;
  ownerKind: LoopProjectClaimOwnerKind;
  ownerId: string;
  purpose: string;
  acquiredAt: number;
  renewedAt: number;
  expiresAt: number;
}

export interface AcquireProjectClaimInput {
  projectId: string;
  ownerKind: LoopProjectClaimOwnerKind;
  ownerId: string;
  purpose: string;
  now: number;
  ttlMs: number;
}

export type AcquireProjectClaimResult =
  | { status: 'acquired'; claim: LoopProjectClaim; renewed: boolean; replacedExpired: boolean }
  | { status: 'blocked'; reason: 'project_claim_active'; activeClaim: LoopProjectClaim };

export interface ReleaseProjectClaimInput {
  projectId: string;
  ownerKind: LoopProjectClaimOwnerKind;
  ownerId: string;
  now: number;
}

export type ReleaseProjectClaimResult =
  | { released: true }
  | { released: false; reason: 'not_found' }
  | { released: false; reason: 'not_owner'; activeClaim: LoopProjectClaim };

interface ProjectClaimRow {
  id: string;
  project_id: string;
  owner_kind: LoopProjectClaimOwnerKind;
  owner_id: string;
  purpose: string;
  acquired_at: number;
  renewed_at: number;
  expires_at: number;
}

interface ExpiredClaimRow {
  id: string;
}

export class LoopProjectClaimStore {
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

  acquireProjectClaim(input: AcquireProjectClaimInput): AcquireProjectClaimResult {
    validateClaimInput(input);
    return this.transaction(() => {
      const active = this.getActiveProjectClaim(input.projectId, input.now);
      if (active) {
        if (active.ownerKind !== input.ownerKind || active.ownerId !== input.ownerId) {
          return { status: 'blocked', reason: 'project_claim_active', activeClaim: active };
        }
        this.db.prepare(`
          update loop_project_claims
          set purpose = @purpose,
              renewed_at = @renewedAt,
              expires_at = @expiresAt
          where id = @id
        `).run({
          id: active.id,
          purpose: input.purpose,
          renewedAt: input.now,
          expiresAt: input.now + input.ttlMs,
        });
        return {
          status: 'acquired',
          renewed: true,
          replacedExpired: false,
          claim: this.getProjectClaimById(active.id)!,
        };
      }

      const replacedExpired = this.hasUnreleasedExpiredClaim(input.projectId, input.now);
      this.db.prepare(`
        update loop_project_claims
        set released_at = @releasedAt
        where project_id = @projectId
          and released_at is null
          and expires_at <= @now
      `).run({ projectId: input.projectId, now: input.now, releasedAt: input.now });

      const id = randomUUID();
      this.db.prepare(`
        insert into loop_project_claims (
          id, project_id, owner_kind, owner_id, purpose, acquired_at, renewed_at, expires_at, released_at
        ) values (
          @id, @projectId, @ownerKind, @ownerId, @purpose, @acquiredAt, @renewedAt, @expiresAt, null
        )
      `).run({
        id,
        projectId: input.projectId,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        purpose: input.purpose,
        acquiredAt: input.now,
        renewedAt: input.now,
        expiresAt: input.now + input.ttlMs,
      });

      return {
        status: 'acquired',
        renewed: false,
        replacedExpired,
        claim: this.getProjectClaimById(id)!,
      };
    });
  }

  releaseProjectClaim(input: ReleaseProjectClaimInput): ReleaseProjectClaimResult {
    validateProjectId(input.projectId);
    validateOwner(input.ownerKind, input.ownerId);
    validateTimestamp(input.now, 'now');
    return this.transaction(() => {
      const active = this.getActiveProjectClaim(input.projectId, input.now);
      if (!active) return { released: false, reason: 'not_found' };
      if (active.ownerKind !== input.ownerKind || active.ownerId !== input.ownerId) {
        return { released: false, reason: 'not_owner', activeClaim: active };
      }
      this.db.prepare(`
        update loop_project_claims
        set released_at = @releasedAt
        where id = @id
      `).run({ id: active.id, releasedAt: input.now });
      return { released: true };
    });
  }

  getActiveProjectClaim(projectId: string, now: number): LoopProjectClaim | undefined {
    validateProjectId(projectId);
    validateTimestamp(now, 'now');
    const row = this.db.prepare(`
      select id, project_id, owner_kind, owner_id, purpose, acquired_at, renewed_at, expires_at
      from loop_project_claims
      where project_id = ?
        and released_at is null
        and expires_at > ?
      order by expires_at desc, acquired_at desc
      limit 1
    `).get(projectId, now) as ProjectClaimRow | undefined;
    return row ? projectClaimRowToRecord(row) : undefined;
  }

  private getProjectClaimById(id: string): LoopProjectClaim | undefined {
    const row = this.db.prepare(`
      select id, project_id, owner_kind, owner_id, purpose, acquired_at, renewed_at, expires_at
      from loop_project_claims
      where id = ?
    `).get(id) as ProjectClaimRow | undefined;
    return row ? projectClaimRowToRecord(row) : undefined;
  }

  private hasUnreleasedExpiredClaim(projectId: string, now: number): boolean {
    const row = this.db.prepare(`
      select id from loop_project_claims
      where project_id = ?
        and released_at is null
        and expires_at <= ?
      limit 1
    `).get(projectId, now) as ExpiredClaimRow | undefined;
    return Boolean(row);
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists loop_project_claims (
        id text primary key,
        project_id text not null,
        owner_kind text not null,
        owner_id text not null,
        purpose text not null,
        acquired_at integer not null,
        renewed_at integer not null,
        expires_at integer not null,
        released_at integer
      );

      create index if not exists idx_loop_project_claims_active
      on loop_project_claims(project_id, released_at, expires_at);
    `);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
  }
}

function projectClaimRowToRecord(row: ProjectClaimRow): LoopProjectClaim {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    purpose: row.purpose,
    acquiredAt: row.acquired_at,
    renewedAt: row.renewed_at,
    expiresAt: row.expires_at,
  };
}

function validateClaimInput(input: AcquireProjectClaimInput): void {
  validateProjectId(input.projectId);
  validateOwner(input.ownerKind, input.ownerId);
  if (!input.purpose.trim()) throw new Error('Project claim purpose is required.');
  validateTimestamp(input.now, 'now');
  validateTimestamp(input.ttlMs, 'ttlMs');
}

function validateProjectId(projectId: string): void {
  if (!projectId.trim()) throw new Error('Project claim projectId is required.');
}

function validateOwner(ownerKind: LoopProjectClaimOwnerKind, ownerId: string): void {
  if (!ownerKind) throw new Error('Project claim ownerKind is required.');
  if (!ownerId.trim()) throw new Error('Project claim ownerId is required.');
}

function validateTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Project claim ${name} must be a non-negative finite number.`);
}
