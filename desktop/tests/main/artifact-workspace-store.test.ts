import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactWorkspaceStore } from '../../electron/artifact-workspace-store.js';
import { ArtifactWorkspaceError } from '../../shared/artifact-workspace-types.js';

describe('ArtifactWorkspaceStore', () => {
  let rootDir: string;
  let dbPath: string;
  let store: ArtifactWorkspaceStore;
  let ordinal: number;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-artifact-workspace-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    dbPath = join(rootDir, 'workspace.db');
    ordinal = 0;
    store = createStore();
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  function createStore() {
    return new ArtifactWorkspaceStore({
      dbPath,
      now: () => 1_700_000_000_000 + ordinal,
      createId: (prefix) => `${prefix}-${++ordinal}`,
    });
  }

  function createWorkspace() {
    return store.getOrCreateWorkspace({ conversationId: 'conversation-1', workspaceRootId: 'root-opaque' });
  }

  it('creates one conversation-scoped workspace and restores it after reopening', () => {
    const first = createWorkspace();
    const same = createWorkspace();
    expect(same.id).toBe(first.id);
    expect(first).toMatchObject({
      conversationId: 'conversation-1',
      workspaceRootId: 'root-opaque',
      schemaVersion: 1,
      structureRevision: 0,
    });

    store.close();
    store = createStore();
    expect(store.getWorkspaceByConversation('conversation-1')).toEqual(first);
  });

  it('tracks true per-window open and close sessions without treating refresh as a return visit', () => {
    const workspace = createWorkspace();
    const first = store.openViewSession({ workspaceId: workspace.id, viewKey: 'primary' });
    expect(first).toMatchObject({ opened: true, returnedAfter24h: false });
    expect(store.openViewSession({ workspaceId: workspace.id, viewKey: 'primary' }))
      .toMatchObject({ opened: false, returnedAfter24h: false, sessionId: first.sessionId });
    expect(store.closeViewSession({ workspaceId: workspace.id, viewKey: 'primary' })).toBe(true);

    ordinal += 24 * 60 * 60_000 - 100;
    expect(store.openViewSession({ workspaceId: workspace.id, viewKey: 'primary' }))
      .toMatchObject({ opened: true, returnedAfter24h: false });
    expect(store.closeViewSession({ workspaceId: workspace.id, viewKey: 'primary' })).toBe(true);
    ordinal += 24 * 60 * 60_000;
    expect(store.openViewSession({ workspaceId: workspace.id, viewKey: 'primary' }))
      .toMatchObject({ opened: true, returnedAfter24h: true });
  });

  it('enforces node discriminants and structure CAS', () => {
    const workspace = createWorkspace();
    const placeholder = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'placeholder',
        placeholderKind: 'html',
        owner: 'user',
        title: 'Report',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    });
    expect(placeholder.workspace.structureRevision).toBe(1);
    expect(placeholder.node).toMatchObject({
      kind: 'placeholder',
      placeholderState: 'draft',
      layoutRevision: 0,
    });

    expect(() => store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'note',
        owner: 'user',
        noteText: 'stale',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    })).toThrowWorkspaceCode('structure_revision_conflict');

    expect(() => store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 1,
      node: {
        kind: 'artifact',
        owner: 'agent',
        lineageId: 'missing-lineage',
        artifactVersionId: 'missing-version',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    })).toThrowWorkspaceCode('invalid_target');

    expect(() => store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 1,
      node: {
        kind: 'placeholder',
        placeholderKind: 'image',
        owner: 'agent',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    })).toThrowWorkspaceCode('permission_denied');
  });

  it('reserves a retry with one per-placeholder CAS and permanently cancels the superseded lease', () => {
    const workspace = createWorkspace();
    const placeholder = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'placeholder', placeholderKind: 'html', owner: 'user', title: 'Report',
        x: 0, y: 0, width: 320, height: 220, zIndex: 0,
      },
    }).node;
    const old = store.createGenerationRequest({ workspaceId: workspace.id, placeholderNodeId: placeholder.id });
    const lease = store.bindGenerationLease({
      generationRequestId: old.id,
      workspaceId: workspace.id,
      nodeId: placeholder.id,
      allowedAction: 'fulfill_placeholder',
      requestedKind: 'html',
      producingTaskId: 'task-old',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    store.updateGenerationState(old.id, 'needs_recovery', 'runtime_unavailable');
    const other = createStore();
    try {
      const retry = store.beginGenerationRetry({ oldRequestId: old.id, workspaceId: workspace.id });
      expect(retry).toMatchObject({ state: 'prepared', supersedesRequestId: old.id, placeholderNodeId: placeholder.id });
      expect(() => other.beginGenerationRetry({ oldRequestId: old.id, workspaceId: workspace.id }))
        .toThrowWorkspaceCode('generation_conflict');
      expect(store.getGenerationRequest(old.id)?.state).toBe('superseded');
      expect(store.getLease(lease.id)?.cancelledAt).toBeTruthy();
      expect(store.listGenerationRequests(workspace.id).filter((request) => request.state === 'prepared')).toHaveLength(1);
    } finally {
      other.close();
    }
  });

  it('commits quarantine receipt, staging and canonical claim atomically across connections', () => {
    const workspace = createWorkspace();
    const placeholder = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'placeholder', placeholderKind: 'html', owner: 'user', title: 'Report',
        x: 0, y: 0, width: 320, height: 220, zIndex: 0,
      },
    }).node;
    const request = store.createGenerationRequest({ workspaceId: workspace.id, placeholderNodeId: placeholder.id });
    const other = createStore();
    const staging = {
      source: 'generation' as const,
      producingTaskId: 'task-1',
      availability: 'unavailable' as const,
      owner: 'system_staging' as const,
      quarantineReason: 'invalid_artifact_ref' as const,
      keep: false,
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    try {
      const first = store.commitQuarantineArtifact({
        generationRequestId: request.id, producedArtifactId: 'artifact-1', projectionKind: 'narrow_tool', staging,
      });
      const replay = other.commitQuarantineArtifact({
        generationRequestId: request.id, producedArtifactId: 'artifact-1', projectionKind: 'task_event', staging,
      });
      expect(first.created).toBe(true);
      expect(replay).toMatchObject({ created: false, outcomeKind: 'staging', outcomeId: first.outcomeId });
      expect(store.listStagingFiles()).toHaveLength(1);
      expect(store.getArtifactClaim(request.id, 'artifact-1')).toEqual({ outcomeKind: 'staging', outcomeId: first.outcomeId });
      expect(store.recordProjectionReceipt({
        generationRequestId: request.id, producedArtifactId: 'artifact-1', projectionKind: 'narrow_tool',
      })).toBe(false);
      expect(store.recordProjectionReceipt({
        generationRequestId: request.id, producedArtifactId: 'artifact-1', projectionKind: 'task_event',
      })).toBe(false);
    } finally {
      other.close();
    }
  });

  it('rolls back quarantine staging and receipt when the claim insert fails', () => {
    const workspace = createWorkspace();
    const placeholder = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'placeholder', placeholderKind: 'html', owner: 'user', title: 'Report',
        x: 0, y: 0, width: 320, height: 220, zIndex: 0,
      },
    }).node;
    const request = store.createGenerationRequest({ workspaceId: workspace.id, placeholderNodeId: placeholder.id });
    (store as unknown as { db: { exec(sql: string): void } }).db.exec(`
      create trigger fail_artifact_claim before insert on artifact_workspace_artifact_claims
      begin select raise(abort, 'claim failure'); end;
    `);
    expect(() => store.commitQuarantineArtifact({
      generationRequestId: request.id,
      producedArtifactId: 'artifact-rollback',
      projectionKind: 'task_event',
      staging: {
        source: 'generation', producingTaskId: 'task-1', availability: 'unavailable',
        owner: 'system_staging', quarantineReason: 'invalid_artifact_ref', keep: false,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    })).toThrow('claim failure');
    expect(store.listStagingFiles()).toHaveLength(0);
    expect(store.getArtifactClaim(request.id, 'artifact-rollback')).toBeUndefined();
    expect(store.recordProjectionReceipt({
      generationRequestId: request.id, producedArtifactId: 'artifact-rollback', projectionKind: 'task_event',
    })).toBe(true);
  });

  it('uses an independent per-node layout CAS across two SQLite connections', () => {
    const workspace = createWorkspace();
    const created = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'note',
        owner: 'user',
        noteText: 'Move me',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    });
    const other = createStore();
    try {
      const winner = store.updateLayout({
        workspaceId: workspace.id,
        patches: [{
          nodeId: created.node.id,
          x: 10,
          y: 20,
          zIndex: 1,
          expectedLayoutRevision: 0,
        }],
      });
      expect(winner[0]).toMatchObject({ x: 10, y: 20, zIndex: 1, layoutRevision: 1 });

      expect(() => other.updateLayout({
        workspaceId: workspace.id,
        patches: [{
          nodeId: created.node.id,
          x: 30,
          y: 40,
          zIndex: 2,
          expectedLayoutRevision: 0,
        }],
      })).toThrowWorkspaceCode('layout_revision_conflict');
      expect(store.getWorkspace(workspace.id)?.structureRevision).toBe(1);
    } finally {
      other.close();
    }
  });

  it('keeps lineage versions immutable and exposes no version deletion mutation', () => {
    const workspace = createWorkspace();
    const base = store.createLineageWithVersion({
      workspaceId: workspace.id,
      sourceLocatorHash: 'a'.repeat(64),
      version: {
        fileRef: 'versions/base/report.md',
        storageKind: 'single_file',
        sourceKind: 'materialized_base',
        kind: 'markdown',
        mimeType: 'text/markdown',
        checksum: 'b'.repeat(64),
        byteSize: 12,
      },
    });
    const revision = store.appendVersion({
      lineageId: base.lineage.id,
      parentVersionId: base.version.id,
      version: {
        fileRef: 'versions/revision/report.md',
        storageKind: 'single_file',
        sourceKind: 'workspace_generation',
        sourceArtifactId: 'artifact-1',
        kind: 'markdown',
        mimeType: 'text/markdown',
        checksum: 'c'.repeat(64),
        producingTaskId: 'task-1',
        byteSize: 13,
      },
    });
    store.setPreferredVersion({
      workspaceId: workspace.id,
      lineageId: base.lineage.id,
      versionId: revision.id,
      expectedStructureRevision: 0,
    });

    expect((store as unknown as Record<string, unknown>).deleteVersion).toBeUndefined();
    expect(store.listVersions(base.lineage.id)).toHaveLength(2);
  });

  it('creates one immutable lease per generation request and derives placeholder state from request', () => {
    const workspace = createWorkspace();
    const placeholder = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'placeholder',
        placeholderKind: 'html',
        owner: 'user',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    }).node;
    const request = store.createGenerationRequest({
      workspaceId: workspace.id,
      placeholderNodeId: placeholder.id,
    });
    expect(store.getNode(placeholder.id)?.placeholderState).toBe('generating');

    const lease = store.bindGenerationLease({
      generationRequestId: request.id,
      workspaceId: workspace.id,
      nodeId: placeholder.id,
      allowedAction: 'fulfill_placeholder',
      requestedKind: 'html',
      producingTaskId: 'task-1',
      expiresAt: new Date(1_700_000_600_000).toISOString(),
    });
    expect(store.getGenerationRequest(request.id)).toMatchObject({
      state: 'running',
      producingTaskId: 'task-1',
    });
    expect(lease.producingTaskId).toBe('task-1');
    expect(() => store.bindGenerationLease({
      generationRequestId: request.id,
      workspaceId: workspace.id,
      nodeId: placeholder.id,
      allowedAction: 'fulfill_placeholder',
      requestedKind: 'html',
      producingTaskId: 'task-2',
      expiresAt: new Date(1_700_000_600_000).toISOString(),
    })).toThrowWorkspaceCode('invalid_target');

    store.updateGenerationState(request.id, 'needs_recovery', 'runtime_unavailable');
    expect(store.getNode(placeholder.id)?.placeholderState).toBe('needs_recovery');
  });

  it('validates staging rows and makes projection receipt and artifact claim independently idempotent', () => {
    const workspace = createWorkspace();
    const placeholder = store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: 0,
      node: {
        kind: 'placeholder', placeholderKind: 'image', owner: 'user',
        x: 0, y: 0, width: 320, height: 220, zIndex: 0,
      },
    }).node;
    const request = store.createGenerationRequest({ workspaceId: workspace.id, placeholderNodeId: placeholder.id });

    expect(() => store.createStagingFile({
      source: 'generation',
      availability: 'present',
      owner: 'system_staging',
      generationRequestId: request.id,
      producingTaskId: 'task-1',
      producedArtifactId: 'artifact-1',
      keep: false,
      expiresAt: new Date(1_700_100_000_000).toISOString(),
    })).toThrowWorkspaceCode('invalid_target');

    const unavailable = store.createStagingFile({
      source: 'generation',
      availability: 'unavailable',
      owner: 'system_staging',
      generationRequestId: request.id,
      producingTaskId: 'task-1',
      producedArtifactId: 'artifact-1',
      quarantineReason: 'invalid_artifact_ref',
      keep: false,
      expiresAt: new Date(1_700_100_000_000).toISOString(),
    });
    expect(unavailable.fileRef).toBeUndefined();

    expect(store.recordProjectionReceipt({
      generationRequestId: request.id,
      producedArtifactId: 'artifact-1',
      projectionKind: 'narrow_tool',
    })).toBe(true);
    expect(store.recordProjectionReceipt({
      generationRequestId: request.id,
      producedArtifactId: 'artifact-1',
      projectionKind: 'narrow_tool',
    })).toBe(false);
    expect(store.recordProjectionReceipt({
      generationRequestId: request.id,
      producedArtifactId: 'artifact-1',
      projectionKind: 'task_event',
    })).toBe(true);

    expect(store.claimArtifactOutcome({
      generationRequestId: request.id,
      producedArtifactId: 'artifact-1',
      outcomeKind: 'staging',
      outcomeId: unavailable.id,
    })).toBe(true);
    expect(store.claimArtifactOutcome({
      generationRequestId: request.id,
      producedArtifactId: 'artifact-1',
      outcomeKind: 'ready_version',
      outcomeId: 'version-loser',
    })).toBe(false);
  });

  it('persists primary and opaque view revisions independently and cleans only stale secondary views', () => {
    const workspace = createWorkspace();
    const primary = store.saveView({
      workspaceId: workspace.id,
      viewKey: 'primary',
      viewport: { x: 1, y: 2, zoom: 1.1 },
    });
    const secondary = store.saveView({
      workspaceId: workspace.id,
      viewKey: 'window-opaque',
      viewport: { x: 3, y: 4, zoom: 0.8 },
    });
    expect(primary.viewRevision).toBe(1);
    expect(secondary.viewRevision).toBe(1);
    expect(store.getView(workspace.id, 'primary')?.viewport.zoom).toBe(1.1);

    const removed = store.cleanupSecondaryViews({
      before: new Date(1_800_000_000_000).toISOString(),
      activeViewKeys: new Set(),
    });
    expect(removed).toBe(1);
    expect(store.getView(workspace.id, 'primary')).toBeDefined();
    expect(store.getView(workspace.id, 'window-opaque')).toBeUndefined();
  });

  it('deduplicates telemetry and returns privacy-safe Phase 0 aggregates', () => {
    const workspace = createWorkspace();
    const base = store.createLineageWithVersion({
      workspaceId: workspace.id,
      sourceLocatorHash: 'a'.repeat(64),
      version: {
        fileRef: 'versions/base/report.html', storageKind: 'single_file', sourceKind: 'materialized_base',
        sourceTaskId: 'task-base', sourceArtifactId: 'artifact-base', kind: 'html', mimeType: 'text/html',
        checksum: 'b'.repeat(64),
      },
    });
    const generated = store.appendVersion({
      lineageId: base.lineage.id,
      parentVersionId: base.version.id,
      version: {
        fileRef: 'versions/generated/report.html', storageKind: 'single_file', sourceKind: 'workspace_generation',
        sourceArtifactId: 'artifact-generated', kind: 'html', mimeType: 'text/html', checksum: 'c'.repeat(64),
        producingTaskId: 'task-generated',
      },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'workspace_opened',
      dedupeKey: 'session-1',
      metadata: { spatialEnabled: true },
    });
    expect(store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'eligible_artifact_opened',
      dedupeKey: 'conversation-1:artifact-1',
      metadata: { kind: 'html' },
    })).toBe(true);
    expect(store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'eligible_artifact_opened',
      dedupeKey: 'conversation-1:artifact-1',
      metadata: { kind: 'html' },
    })).toBe(false);
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      requestId: 'request-1',
      eventName: 'revision_requested',
      dedupeKey: 'request-1',
      metadata: { kind: 'html' },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'spatial_workspace_multi_artifact_reached',
      dedupeKey: workspace.id,
      metadata: {},
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'spatial_node_repositioned',
      dedupeKey: `${workspace.id}:node-1:drag-1`,
      metadata: { nodeId: 'node-1' },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'spatial_node_repositioned',
      dedupeKey: `${workspace.id}:node-2:drag-1`,
      metadata: { nodeId: 'node-2' },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'relation_created',
      dedupeKey: 'relation-1',
      metadata: { kind: 'part_of_collection' },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'spatial_workspace_returned',
      dedupeKey: `${workspace.id}:return-window-1`,
      metadata: {},
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      requestId: 'request-1',
      eventName: 'revision_ready',
      dedupeKey: 'request-1',
      metadata: { kind: 'html' },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'revision_compare_opened',
      dedupeKey: `${base.version.id}:${generated.id}`,
      metadata: { leftVersionId: base.version.id, rightVersionId: generated.id },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'revision_preferred',
      dedupeKey: generated.id,
      metadata: { versionId: generated.id },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      requestId: 'request-1',
      eventName: 'revision_branched',
      dedupeKey: generated.id,
      metadata: { versionId: generated.id },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'revision_downloaded',
      dedupeKey: generated.id,
      metadata: { versionId: generated.id },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      requestId: 'recovery-request-1',
      eventName: 'recovery_attempted',
      dedupeKey: 'recovery-request-1:attempt',
      metadata: { state: 'running' },
    });
    store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      requestId: 'recovery-request-1',
      eventName: 'recovery_succeeded',
      dedupeKey: 'recovery-request-1:success',
      metadata: { state: 'ready' },
    });
    const aggregate = store.getTelemetryAggregate();
    expect(aggregate).toMatchObject({
      eligibleConversationCount: 1,
      revisionRequestedConversationCount: 1,
      revisionReadyRequestCount: 1,
      revisionCompareRequestCount: 1,
      revisionPreferredRequestCount: 1,
      multiArtifactWorkspaceCount: 1,
      repositionedNodeCount: 2,
      returnedWorkspaceCount: 1,
      spatialBetaWorkspaceCount: 1,
      repositionedWorkspaceCount: 1,
      relationOrCollectionWorkspaceCount: 1,
      multiArtifactWorkspaceRate: 1,
      nodeRepositionRate: 1,
      relationOrCollectionRate: 1,
      workspaceReturnRate: 1,
      revisionStartRate: 1,
      revisionCompareRate: 1,
      revisionPreferRate: 1,
      revisionBranchRate: 1,
      revisionDownloadRate: 1,
      recoveryAttemptCount: 1,
      recoveryClosedAttemptCount: 1,
      recoverySuccessCount: 1,
      recoverySuccessRate: 1,
    });
    expect(aggregate.revisionStartWilsonLowerBound).toBeGreaterThan(0);
    expect(aggregate.revisionCompareWilsonLowerBound).toBeGreaterThan(0);
    expect(aggregate.revisionPreferWilsonLowerBound).toBeGreaterThan(0);
    expect(aggregate.relationOrCollectionWilsonLowerBound).toBeGreaterThan(0);
    expect(JSON.stringify(store.listEvents())).not.toContain('private-report');
  });
});

declare module 'vitest' {
  interface Assertion<T = unknown> {
    toThrowWorkspaceCode(code: ArtifactWorkspaceError['code']): T;
  }
}

expect.extend({
  toThrowWorkspaceCode(received: () => unknown, code: ArtifactWorkspaceError['code']) {
    try {
      received();
      return { pass: false, message: () => `expected function to throw ${code}` };
    } catch (error) {
      const pass = error instanceof ArtifactWorkspaceError && error.code === code;
      return {
        pass,
        message: () => `expected ${code}, received ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
