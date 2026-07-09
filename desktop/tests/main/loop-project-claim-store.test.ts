import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LoopProjectClaimStore } from '../../electron/loop-project-claim-store.js';

describe('LoopProjectClaimStore', () => {
  let rootDir: string;
  let store: LoopProjectClaimStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-loop-project-claims-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new LoopProjectClaimStore(join(rootDir, 'claims.sqlite'));
  });

  afterEach(() => {
    try {
      store.close();
    } catch { /* already closed */ }
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('blocks a second owner from mutating the same project while a claim is active', () => {
    const first = store.acquireProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'loop_run',
      ownerId: 'loop-run-1',
      purpose: 'workflow_loop',
      now: 1_000,
      ttlMs: 60_000,
    });

    expect(first).toMatchObject({
      status: 'acquired',
      renewed: false,
      replacedExpired: false,
      claim: {
        projectId: 'proj-1',
        ownerKind: 'loop_run',
        ownerId: 'loop-run-1',
        purpose: 'workflow_loop',
        acquiredAt: 1_000,
        expiresAt: 61_000,
      },
    });

    expect(store.acquireProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'kswarm_po',
      ownerId: 'po-run-1',
      purpose: 'project_planning',
      now: 2_000,
      ttlMs: 60_000,
    })).toEqual({
      status: 'blocked',
      reason: 'project_claim_active',
      activeClaim: expect.objectContaining({
        projectId: 'proj-1',
        ownerKind: 'loop_run',
        ownerId: 'loop-run-1',
      }),
    });
  });

  it('renews the same owner and replaces expired claims', () => {
    store.acquireProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'loop_run',
      ownerId: 'loop-run-1',
      purpose: 'workflow_loop',
      now: 1_000,
      ttlMs: 1_000,
    });

    expect(store.acquireProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'loop_run',
      ownerId: 'loop-run-1',
      purpose: 'workflow_loop',
      now: 1_500,
      ttlMs: 2_000,
    })).toMatchObject({
      status: 'acquired',
      renewed: true,
      replacedExpired: false,
      claim: {
        ownerId: 'loop-run-1',
        expiresAt: 3_500,
      },
    });

    expect(store.acquireProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'kswarm_po',
      ownerId: 'po-run-1',
      purpose: 'project_planning',
      now: 4_000,
      ttlMs: 5_000,
    })).toMatchObject({
      status: 'acquired',
      renewed: false,
      replacedExpired: true,
      claim: {
        ownerKind: 'kswarm_po',
        ownerId: 'po-run-1',
        expiresAt: 9_000,
      },
    });
  });

  it('only lets the owning actor release a project claim', () => {
    store.acquireProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'loop_run',
      ownerId: 'loop-run-1',
      purpose: 'workflow_loop',
      now: 1_000,
      ttlMs: 60_000,
    });

    expect(store.releaseProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'kswarm_po',
      ownerId: 'po-run-1',
      now: 2_000,
    })).toEqual({
      released: false,
      reason: 'not_owner',
      activeClaim: expect.objectContaining({
        ownerKind: 'loop_run',
        ownerId: 'loop-run-1',
      }),
    });

    expect(store.getActiveProjectClaim('proj-1', 2_000)).toMatchObject({
      ownerId: 'loop-run-1',
    });

    expect(store.releaseProjectClaim({
      projectId: 'proj-1',
      ownerKind: 'loop_run',
      ownerId: 'loop-run-1',
      now: 3_000,
    })).toEqual({ released: true });

    expect(store.getActiveProjectClaim('proj-1', 3_000)).toBeUndefined();
  });
});
