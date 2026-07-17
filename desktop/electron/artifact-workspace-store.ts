import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  ArtifactLineage,
  ArtifactWorkspace,
  ArtifactWorkspaceEvent,
  ArtifactWorkspaceEventName,
  ArtifactWorkspaceGenerationState,
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspaceNode,
  ArtifactWorkspaceRelation,
  ArtifactWorkspaceStagingFile,
  ArtifactWorkspaceVersion,
  ArtifactWorkspaceView,
  WorkspaceGenerationLease,
  WorkspaceGenerationRequest,
} from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceError } from '../shared/artifact-workspace-types.js';

type Row = Record<string, unknown>;

const ACTIVE_REQUEST_STATES: ArtifactWorkspaceGenerationState[] = ['prepared', 'running', 'needs_recovery'];
const TERMINAL_OR_SUPERSEDED_STATES: ArtifactWorkspaceGenerationState[] = ['ready', 'failed', 'cancelled', 'superseded'];

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function booleanValue(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

function changed(result: { changes: number | bigint }): boolean {
  return Number(result.changes) > 0;
}

function rowToWorkspace(row: Row): ArtifactWorkspace {
  return {
    id: stringValue(row.id),
    conversationId: stringValue(row.conversation_id),
    workspaceRootId: stringValue(row.workspace_root_id),
    schemaVersion: 1,
    structureRevision: numberValue(row.structure_revision),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function rowToRelation(row: Row): ArtifactWorkspaceRelation {
  return {
    id: stringValue(row.id),
    workspaceId: stringValue(row.workspace_id),
    fromNodeId: stringValue(row.from_node_id),
    toNodeId: stringValue(row.to_node_id),
    kind: stringValue(row.kind) as ArtifactWorkspaceRelation['kind'],
    order: row.order_index == null ? undefined : numberValue(row.order_index),
    createdBy: stringValue(row.created_by) as ArtifactWorkspaceRelation['createdBy'],
    createdAt: stringValue(row.created_at),
  };
}

function rowToLineage(row: Row): ArtifactLineage {
  return {
    id: stringValue(row.id),
    workspaceId: stringValue(row.workspace_id),
    sourceLocatorHash: stringValue(row.source_locator_hash),
    preferredVersionId: optionalString(row.preferred_version_id),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function rowToVersion(row: Row): ArtifactWorkspaceVersion {
  return {
    id: stringValue(row.id),
    lineageId: stringValue(row.lineage_id),
    parentVersionId: optionalString(row.parent_version_id),
    fileRef: stringValue(row.file_ref),
    storageKind: stringValue(row.storage_kind) as ArtifactWorkspaceVersion['storageKind'],
    entryRef: optionalString(row.entry_ref),
    packageManifestRef: optionalString(row.package_manifest_ref),
    sourceKind: stringValue(row.source_kind) as ArtifactWorkspaceVersion['sourceKind'],
    sourceTaskId: optionalString(row.source_task_id),
    sourceArtifactId: optionalString(row.source_artifact_id),
    sourceEvidenceId: optionalString(row.source_evidence_id),
    externalTaskRef: optionalString(row.external_task_ref),
    kind: stringValue(row.kind),
    mimeType: optionalString(row.mime_type),
    byteSize: row.byte_size == null ? undefined : numberValue(row.byte_size),
    checksum: stringValue(row.checksum),
    producingTaskId: optionalString(row.producing_task_id),
    producingAgentId: optionalString(row.producing_agent_id),
    runtimeSource: optionalString(row.runtime_source),
    pluginSource: optionalString(row.plugin_source),
    status: stringValue(row.status) as ArtifactWorkspaceVersion['status'],
    createdAt: stringValue(row.created_at),
  };
}

function rowToRequest(row: Row): WorkspaceGenerationRequest {
  return {
    id: stringValue(row.id),
    workspaceId: stringValue(row.workspace_id),
    placeholderNodeId: stringValue(row.placeholder_node_id),
    sourceVersionId: optionalString(row.source_version_id),
    producingTaskId: optionalString(row.producing_task_id),
    externalTaskRef: optionalString(row.external_task_ref),
    state: stringValue(row.state) as WorkspaceGenerationRequest['state'],
    errorCode: optionalString(row.error_code) as WorkspaceGenerationRequest['errorCode'],
    supersedesRequestId: optionalString(row.supersedes_request_id),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}

function rowToLease(row: Row): WorkspaceGenerationLease {
  return {
    id: stringValue(row.id),
    generationRequestId: stringValue(row.generation_request_id),
    workspaceId: stringValue(row.workspace_id),
    nodeId: stringValue(row.node_id),
    sourceVersionId: optionalString(row.source_version_id),
    allowedAction: stringValue(row.allowed_action) as WorkspaceGenerationLease['allowedAction'],
    requestedKind: stringValue(row.requested_kind) as WorkspaceGenerationLease['requestedKind'],
    producingTaskId: stringValue(row.producing_task_id),
    producingAgentId: optionalString(row.producing_agent_id),
    expiresAt: stringValue(row.expires_at),
    consumedAt: optionalString(row.consumed_at),
    cancelledAt: optionalString(row.cancelled_at),
    createdAt: stringValue(row.created_at),
  };
}

function rowToStaging(row: Row): ArtifactWorkspaceStagingFile {
  return {
    id: stringValue(row.id),
    source: stringValue(row.source) as ArtifactWorkspaceStagingFile['source'],
    generationRequestId: optionalString(row.generation_request_id),
    producingTaskId: optionalString(row.producing_task_id),
    producedArtifactId: optionalString(row.produced_artifact_id),
    sourceLocatorHash: optionalString(row.source_locator_hash),
    availability: stringValue(row.availability) as ArtifactWorkspaceStagingFile['availability'],
    fileRef: optionalString(row.file_ref),
    owner: 'system_staging',
    quarantineReason: optionalString(row.quarantine_reason) as ArtifactWorkspaceStagingFile['quarantineReason'],
    keep: booleanValue(row.keep),
    createdAt: stringValue(row.created_at),
    expiresAt: stringValue(row.expires_at),
  };
}

function rowToView(row: Row): ArtifactWorkspaceView {
  return {
    workspaceId: stringValue(row.workspace_id),
    viewKey: stringValue(row.view_key),
    viewport: {
      x: numberValue(row.viewport_x),
      y: numberValue(row.viewport_y),
      zoom: numberValue(row.viewport_zoom),
    },
    viewRevision: numberValue(row.view_revision),
    updatedAt: stringValue(row.updated_at),
  };
}

function rowToEvent(row: Row): ArtifactWorkspaceEvent {
  const parsed = JSON.parse(stringValue(row.metadata_json) || '{}') as Record<string, string | number | boolean | null>;
  return {
    id: stringValue(row.id),
    workspaceId: stringValue(row.workspace_id),
    conversationId: stringValue(row.conversation_id),
    requestId: optionalString(row.request_id),
    eventName: stringValue(row.event_name) as ArtifactWorkspaceEventName,
    dedupeKey: optionalString(row.dedupe_key),
    metadata: parsed,
    createdAt: stringValue(row.created_at),
  };
}

export interface ArtifactWorkspaceStoreOptions {
  dbPath: string;
  now?: () => number;
  createId?: (prefix: string) => string;
}

export class ArtifactWorkspaceStore {
  private readonly db: DatabaseSync;
  private readonly nowFn: () => number;
  private readonly createIdFn: (prefix: string) => string;

  constructor(options: ArtifactWorkspaceStoreOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.db.exec('pragma synchronous = NORMAL');
    this.db.exec('pragma foreign_keys = ON');
    this.db.exec('pragma busy_timeout = 5000');
    this.nowFn = options.now ?? Date.now;
    this.createIdFn = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.applySchema();
  }

  close(): void {
    this.db.close();
  }

  getOrCreateWorkspace(input: { conversationId: string; workspaceRootId: string }): ArtifactWorkspace {
    if (!input.conversationId.trim() || !input.workspaceRootId.trim()) {
      throw new ArtifactWorkspaceError('invalid_target', 'workspace identity is required');
    }
    return this.transaction(() => {
      const existing = this.getWorkspaceByConversation(input.conversationId);
      if (existing) {
        if (existing.workspaceRootId !== input.workspaceRootId) {
          throw new ArtifactWorkspaceError('invalid_target', 'conversation workspace root changed');
        }
        return existing;
      }
      const timestamp = this.now();
      const id = this.createId('workspace');
      this.db.prepare(`
        insert into artifact_workspaces (
          id, conversation_id, workspace_root_id, schema_version, structure_revision, created_at, updated_at
        ) values (?, ?, ?, 1, 0, ?, ?)
      `).run(id, input.conversationId, input.workspaceRootId, timestamp, timestamp);
      return this.requireWorkspace(id);
    });
  }

  getWorkspace(id: string): ArtifactWorkspace | undefined {
    const row = this.db.prepare('select * from artifact_workspaces where id = ?').get(id) as Row | undefined;
    return row ? rowToWorkspace(row) : undefined;
  }

  getWorkspaceByConversation(conversationId: string): ArtifactWorkspace | undefined {
    const row = this.db.prepare('select * from artifact_workspaces where conversation_id = ?').get(conversationId) as Row | undefined;
    return row ? rowToWorkspace(row) : undefined;
  }

  listWorkspaces(): ArtifactWorkspace[] {
    return (this.db.prepare('select * from artifact_workspaces order by created_at, id').all() as Row[]).map(rowToWorkspace);
  }

  openViewSession(input: { workspaceId: string; viewKey: string }): {
    opened: boolean;
    returnedAfter24h: boolean;
    sessionId: string;
  } {
    return this.transaction(() => {
      this.requireWorkspace(input.workspaceId);
      const active = this.db.prepare(`
        select id from artifact_workspace_view_sessions
        where workspace_id = ? and view_key = ? and closed_at is null
        order by opened_at desc, rowid desc limit 1
      `).get(input.workspaceId, input.viewKey) as Row | undefined;
      if (active) {
        this.db.prepare('update artifact_workspace_view_sessions set last_seen_at = ? where id = ?')
          .run(this.now(), stringValue(active.id));
        return { opened: false, returnedAfter24h: false, sessionId: stringValue(active.id) };
      }
      const prior = this.db.prepare(`
        select closed_at from artifact_workspace_view_sessions
        where workspace_id = ? and view_key = ? and closed_at is not null
        order by closed_at desc, rowid desc limit 1
      `).get(input.workspaceId, input.viewKey) as Row | undefined;
      const timestamp = this.now();
      const sessionId = this.createId('view-session');
      this.db.prepare(`
        insert into artifact_workspace_view_sessions (
          id, workspace_id, view_key, opened_at, last_seen_at, closed_at
        ) values (?, ?, ?, ?, ?, null)
      `).run(sessionId, input.workspaceId, input.viewKey, timestamp, timestamp);
      const priorClosedAt = prior ? Date.parse(stringValue(prior.closed_at)) : Number.NaN;
      return {
        opened: true,
        returnedAfter24h: Number.isFinite(priorClosedAt) && this.nowFn() - priorClosedAt >= 24 * 60 * 60_000,
        sessionId,
      };
    });
  }

  closeViewSession(input: { workspaceId: string; viewKey: string }): boolean {
    const result = this.db.prepare(`
      update artifact_workspace_view_sessions set closed_at = ?, last_seen_at = ?
      where workspace_id = ? and view_key = ? and closed_at is null
    `).run(this.now(), this.now(), input.workspaceId, input.viewKey);
    return changed(result);
  }

  closeViewSessionsByKey(viewKey: string): number {
    const result = this.db.prepare(`
      update artifact_workspace_view_sessions set closed_at = ?, last_seen_at = ?
      where view_key = ? and closed_at is null
    `).run(this.now(), this.now(), viewKey);
    return Number(result.changes);
  }

  createNode(input: {
    workspaceId: string;
    expectedStructureRevision: number;
    node: Omit<ArtifactWorkspaceNode, 'id' | 'workspaceId' | 'layoutRevision' | 'createdAt' | 'updatedAt' | 'placeholderState'>;
  }): { workspace: ArtifactWorkspace; node: ArtifactWorkspaceNode } {
    this.validateNode(input.workspaceId, input.node);
    return this.transaction(() => {
      this.bumpStructure(input.workspaceId, input.expectedStructureRevision);
      const node = this.insertNode(input.workspaceId, input.node);
      return { workspace: this.requireWorkspace(input.workspaceId), node };
    });
  }

  reserveStructureRevision(workspaceId: string, expectedStructureRevision: number): ArtifactWorkspace {
    return this.transaction(() => {
      this.bumpStructure(workspaceId, expectedStructureRevision);
      return this.requireWorkspace(workspaceId);
    });
  }

  createMaterializedLineageWithNode(input: {
    workspaceId: string;
    sourceLocatorHash: string;
    version: Omit<ArtifactWorkspaceVersion, 'id' | 'lineageId' | 'createdAt' | 'status'> & { status?: 'ready' | 'missing' };
    node: Omit<ArtifactWorkspaceNode, 'id' | 'workspaceId' | 'layoutRevision' | 'createdAt' | 'updatedAt' | 'placeholderState' | 'lineageId' | 'artifactVersionId'>;
  }): { lineage: ArtifactLineage; version: ArtifactWorkspaceVersion; node?: ArtifactWorkspaceNode; created: boolean } {
    this.validateVersion(input.version);
    return this.transaction(() => {
      const existing = this.getLineageBySource(input.workspaceId, input.sourceLocatorHash);
      if (existing) {
        const version = this.listVersions(existing.id)[0];
        if (!version) throw new ArtifactWorkspaceError('artifact_missing', 'lineage has no base version');
        return {
          lineage: existing,
          version,
          node: this.listNodes(input.workspaceId).find(candidate => candidate.lineageId === existing.id),
          created: false,
        };
      }
      const timestamp = this.now();
      const lineageId = this.createId('lineage');
      this.db.prepare(`
        insert into artifact_lineages (id, workspace_id, source_locator_hash, preferred_version_id, created_at, updated_at)
        values (?, ?, ?, null, ?, ?)
      `).run(lineageId, input.workspaceId, input.sourceLocatorHash, timestamp, timestamp);
      const version = this.insertVersion(lineageId, input.version);
      this.db.prepare('update artifact_lineages set preferred_version_id = ?, updated_at = ? where id = ?')
        .run(version.id, this.now(), lineageId);
      const nodeInput = { ...input.node, lineageId, artifactVersionId: version.id };
      this.validateNode(input.workspaceId, nodeInput);
      const node = this.insertNode(input.workspaceId, nodeInput);
      return { lineage: this.requireLineage(lineageId), version, node, created: true };
    });
  }

  getNode(id: string): ArtifactWorkspaceNode | undefined {
    const row = this.db.prepare('select * from artifact_workspace_nodes where id = ?').get(id) as Row | undefined;
    return row ? this.rowToNode(row) : undefined;
  }

  listNodes(workspaceId: string, includeTombstoned = false): ArtifactWorkspaceNode[] {
    const rows = this.db.prepare(`
      select * from artifact_workspace_nodes
      where workspace_id = ? ${includeTombstoned ? '' : 'and tombstoned_at is null'}
      order by z_index asc, created_at asc, id asc
    `).all(workspaceId) as Row[];
    return rows.map((row) => this.rowToNode(row));
  }

  updateLayout(input: { workspaceId: string; patches: ArtifactWorkspaceLayoutPatch[] }): ArtifactWorkspaceNode[] {
    return this.transaction(() => input.patches.map((patch) => {
      const result = this.db.prepare(`
        update artifact_workspace_nodes
        set x = ?, y = ?, z_index = ?, layout_revision = layout_revision + 1, updated_at = ?
        where id = ? and workspace_id = ? and layout_revision = ? and tombstoned_at is null
      `).run(
        patch.x,
        patch.y,
        patch.zIndex,
        this.now(),
        patch.nodeId,
        input.workspaceId,
        patch.expectedLayoutRevision,
      );
      if (!changed(result)) {
        throw new ArtifactWorkspaceError(
          'layout_revision_conflict',
          'node layout revision conflict',
          this.getNode(patch.nodeId),
        );
      }
      return this.requireNode(patch.nodeId);
    }));
  }

  tombstoneNode(input: { workspaceId: string; nodeId: string; expectedStructureRevision: number }): ArtifactWorkspaceNode {
    return this.transaction(() => {
      this.bumpStructure(input.workspaceId, input.expectedStructureRevision);
      const result = this.db.prepare(`
        update artifact_workspace_nodes set tombstoned_at = ?, updated_at = ?
        where id = ? and workspace_id = ? and tombstoned_at is null
      `).run(this.now(), this.now(), input.nodeId, input.workspaceId);
      if (!changed(result)) throw new ArtifactWorkspaceError('invalid_target', 'node is missing');
      this.db.prepare(`
        delete from artifact_workspace_relations
        where workspace_id = ? and (from_node_id = ? or to_node_id = ?)
      `).run(input.workspaceId, input.nodeId, input.nodeId);
      return this.requireNode(input.nodeId);
    });
  }

  updateNote(input: {
    workspaceId: string;
    nodeId: string;
    noteText: string;
    expectedStructureRevision: number;
  }): ArtifactWorkspaceNode {
    return this.transaction(() => {
      const node = this.getNode(input.nodeId);
      if (!node || node.workspaceId !== input.workspaceId || node.kind !== 'note' || node.tombstonedAt) {
        throw new ArtifactWorkspaceError('invalid_target', 'note node is missing');
      }
      this.bumpStructure(input.workspaceId, input.expectedStructureRevision);
      this.db.prepare('update artifact_workspace_nodes set note_text = ?, updated_at = ? where id = ?')
        .run(input.noteText, this.now(), input.nodeId);
      return this.requireNode(input.nodeId);
    });
  }

  createLineageWithVersion(input: {
    workspaceId: string;
    sourceLocatorHash: string;
    version: Omit<ArtifactWorkspaceVersion, 'id' | 'lineageId' | 'createdAt' | 'status'> & { status?: 'ready' | 'missing' };
  }): { lineage: ArtifactLineage; version: ArtifactWorkspaceVersion; created: boolean } {
    this.validateVersion(input.version);
    return this.transaction(() => {
      const existing = this.getLineageBySource(input.workspaceId, input.sourceLocatorHash);
      if (existing) {
        const base = this.listVersions(existing.id)[0];
        if (!base) throw new ArtifactWorkspaceError('artifact_missing', 'lineage has no base version');
        return { lineage: existing, version: base, created: false };
      }
      const timestamp = this.now();
      const lineageId = this.createId('lineage');
      this.db.prepare(`
        insert into artifact_lineages (id, workspace_id, source_locator_hash, preferred_version_id, created_at, updated_at)
        values (?, ?, ?, null, ?, ?)
      `).run(lineageId, input.workspaceId, input.sourceLocatorHash, timestamp, timestamp);
      const version = this.insertVersion(lineageId, input.version);
      this.db.prepare('update artifact_lineages set preferred_version_id = ?, updated_at = ? where id = ?')
        .run(version.id, this.now(), lineageId);
      return { lineage: this.requireLineage(lineageId), version, created: true };
    });
  }

  getLineage(id: string): ArtifactLineage | undefined {
    const row = this.db.prepare('select * from artifact_lineages where id = ?').get(id) as Row | undefined;
    return row ? rowToLineage(row) : undefined;
  }

  getLineageBySource(workspaceId: string, sourceLocatorHash: string): ArtifactLineage | undefined {
    const row = this.db.prepare(`
      select * from artifact_lineages where workspace_id = ? and source_locator_hash = ?
    `).get(workspaceId, sourceLocatorHash) as Row | undefined;
    return row ? rowToLineage(row) : undefined;
  }

  listLineages(workspaceId: string): ArtifactLineage[] {
    return (this.db.prepare('select * from artifact_lineages where workspace_id = ? order by created_at, id').all(workspaceId) as Row[])
      .map(rowToLineage);
  }

  appendVersion(input: {
    lineageId: string;
    parentVersionId?: string;
    version: Omit<ArtifactWorkspaceVersion, 'id' | 'lineageId' | 'parentVersionId' | 'createdAt' | 'status'> & { status?: 'ready' | 'missing' };
  }): ArtifactWorkspaceVersion {
    const lineage = this.getLineage(input.lineageId);
    if (!lineage) throw new ArtifactWorkspaceError('invalid_target', 'lineage is missing');
    if (input.parentVersionId) {
      const parent = this.getVersion(input.parentVersionId);
      if (!parent || parent.lineageId !== input.lineageId) {
        throw new ArtifactWorkspaceError('invalid_target', 'parent version is outside the lineage');
      }
    }
    this.validateVersion({ ...input.version, parentVersionId: input.parentVersionId });
    return this.transaction(() => this.insertVersion(input.lineageId, {
      ...input.version,
      parentVersionId: input.parentVersionId,
    }));
  }

  getVersion(id: string): ArtifactWorkspaceVersion | undefined {
    const row = this.db.prepare('select * from artifact_workspace_versions where id = ?').get(id) as Row | undefined;
    return row ? rowToVersion(row) : undefined;
  }

  listVersions(lineageId: string): ArtifactWorkspaceVersion[] {
    return (this.db.prepare(`
      select * from artifact_workspace_versions where lineage_id = ? order by created_at asc, id asc
    `).all(lineageId) as Row[]).map(rowToVersion);
  }

  setPreferredVersion(input: {
    workspaceId: string;
    lineageId: string;
    versionId: string;
    expectedStructureRevision: number;
  }): ArtifactLineage {
    return this.transaction(() => {
      const lineage = this.getLineage(input.lineageId);
      const version = this.getVersion(input.versionId);
      if (!lineage || lineage.workspaceId !== input.workspaceId || !version || version.lineageId !== lineage.id) {
        throw new ArtifactWorkspaceError('invalid_target', 'preferred version is outside the lineage');
      }
      this.bumpStructure(input.workspaceId, input.expectedStructureRevision);
      this.db.prepare('update artifact_lineages set preferred_version_id = ?, updated_at = ? where id = ?')
        .run(input.versionId, this.now(), input.lineageId);
      return this.requireLineage(input.lineageId);
    });
  }

  createGenerationRequest(input: {
    workspaceId: string;
    placeholderNodeId: string;
    sourceVersionId?: string;
    externalTaskRef?: string;
    supersedesRequestId?: string;
  }): WorkspaceGenerationRequest {
    return this.transaction(() => {
      const node = this.getNode(input.placeholderNodeId);
      if (!node || node.workspaceId !== input.workspaceId || node.kind !== 'placeholder' || node.tombstonedAt) {
        throw new ArtifactWorkspaceError('invalid_target', 'generation target is not an active placeholder');
      }
      const active = this.db.prepare(`
        select 1 from workspace_generation_requests
        where placeholder_node_id = ? and state in ('prepared', 'running', 'needs_recovery') limit 1
      `).get(input.placeholderNodeId);
      if (active) throw new ArtifactWorkspaceError('generation_conflict', 'placeholder already has an active request');
      if (input.sourceVersionId) {
        const sourceVersion = this.getVersion(input.sourceVersionId);
        const sourceLineage = sourceVersion ? this.getLineage(sourceVersion.lineageId) : undefined;
        if (!sourceVersion || !sourceLineage || sourceLineage.workspaceId !== input.workspaceId) {
          throw new ArtifactWorkspaceError('invalid_target', 'source version is outside the workspace');
        }
      }
      const timestamp = this.now();
      const id = this.createId('generation');
      this.db.prepare(`
        insert into workspace_generation_requests (
          id, workspace_id, placeholder_node_id, source_version_id, producing_task_id,
          external_task_ref, state, error_code, supersedes_request_id, created_at, updated_at
        ) values (?, ?, ?, ?, null, ?, 'prepared', null, ?, ?, ?)
      `).run(
        id,
        input.workspaceId,
        input.placeholderNodeId,
        input.sourceVersionId ?? null,
        input.externalTaskRef ?? null,
        input.supersedesRequestId ?? null,
        timestamp,
        timestamp,
      );
      return this.requireGenerationRequest(id);
    });
  }

  beginGenerationRetry(input: {
    oldRequestId: string;
    workspaceId: string;
  }): WorkspaceGenerationRequest {
    return this.transaction(() => {
      const old = this.getGenerationRequest(input.oldRequestId);
      if (
        !old
        || old.workspaceId !== input.workspaceId
        || !['failed', 'cancelled', 'needs_recovery'].includes(old.state)
      ) {
        throw new ArtifactWorkspaceError('generation_conflict', 'generation cannot be retried');
      }
      const timestamp = this.now();
      const superseded = this.db.prepare(`
        update workspace_generation_requests
        set state = 'superseded', updated_at = ?
        where id = ? and workspace_id = ? and state in ('failed', 'cancelled', 'needs_recovery')
      `).run(timestamp, old.id, input.workspaceId);
      if (!changed(superseded)) {
        throw new ArtifactWorkspaceError('generation_conflict', 'generation retry lost its compare-and-swap');
      }
      this.db.prepare(`
        update workspace_generation_leases
        set cancelled_at = coalesce(cancelled_at, ?)
        where generation_request_id = ? and consumed_at is null and cancelled_at is null
      `).run(timestamp, old.id);
      const id = this.createId('generation');
      this.db.prepare(`
        insert into workspace_generation_requests (
          id, workspace_id, placeholder_node_id, source_version_id, producing_task_id,
          external_task_ref, state, error_code, supersedes_request_id, created_at, updated_at
        ) values (?, ?, ?, ?, null, null, 'prepared', null, ?, ?, ?)
      `).run(
        id,
        old.workspaceId,
        old.placeholderNodeId,
        old.sourceVersionId ?? null,
        old.id,
        timestamp,
        timestamp,
      );
      return this.requireGenerationRequest(id);
    });
  }

  getGenerationRequest(id: string): WorkspaceGenerationRequest | undefined {
    const row = this.db.prepare('select * from workspace_generation_requests where id = ?').get(id) as Row | undefined;
    return row ? rowToRequest(row) : undefined;
  }

  listGenerationRequests(workspaceId: string): WorkspaceGenerationRequest[] {
    return (this.db.prepare(`
      select * from workspace_generation_requests where workspace_id = ? order by created_at, id
    `).all(workspaceId) as Row[]).map(rowToRequest);
  }

  bindGenerationLease(input: {
    leaseId?: string;
    generationRequestId: string;
    workspaceId: string;
    nodeId: string;
    sourceVersionId?: string;
    allowedAction: WorkspaceGenerationLease['allowedAction'];
    requestedKind: WorkspaceGenerationLease['requestedKind'];
    producingTaskId: string;
    producingAgentId?: string;
    expiresAt: string;
  }): WorkspaceGenerationLease {
    return this.transaction(() => {
      const request = this.getGenerationRequest(input.generationRequestId);
      if (
        !request
        || request.state !== 'prepared'
        || request.workspaceId !== input.workspaceId
        || request.placeholderNodeId !== input.nodeId
        || request.sourceVersionId !== input.sourceVersionId
      ) {
        throw new ArtifactWorkspaceError('invalid_target', 'generation request cannot bind this lease');
      }
      if (this.getLeaseByRequest(request.id)) {
        throw new ArtifactWorkspaceError('invalid_target', 'generation request already has a lease');
      }
      const timestamp = this.now();
      const id = input.leaseId ?? this.createId('lease');
      this.db.prepare(`
        insert into workspace_generation_leases (
          id, generation_request_id, workspace_id, node_id, source_version_id, allowed_action,
          requested_kind, producing_task_id, producing_agent_id, expires_at, consumed_at,
          cancelled_at, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?)
      `).run(
        id,
        request.id,
        input.workspaceId,
        input.nodeId,
        input.sourceVersionId ?? null,
        input.allowedAction,
        input.requestedKind,
        input.producingTaskId,
        input.producingAgentId ?? null,
        input.expiresAt,
        timestamp,
      );
      this.db.prepare(`
        update workspace_generation_requests
        set producing_task_id = ?, state = 'running', updated_at = ? where id = ? and state = 'prepared'
      `).run(input.producingTaskId, timestamp, request.id);
      return this.requireLease(id);
    });
  }

  getLease(id: string): WorkspaceGenerationLease | undefined {
    const row = this.db.prepare('select * from workspace_generation_leases where id = ?').get(id) as Row | undefined;
    return row ? rowToLease(row) : undefined;
  }

  getLeaseByRequest(requestId: string): WorkspaceGenerationLease | undefined {
    const row = this.db.prepare('select * from workspace_generation_leases where generation_request_id = ?').get(requestId) as Row | undefined;
    return row ? rowToLease(row) : undefined;
  }

  updateGenerationState(
    requestId: string,
    state: ArtifactWorkspaceGenerationState,
    errorCode?: WorkspaceGenerationRequest['errorCode'],
  ): WorkspaceGenerationRequest {
    const request = this.getGenerationRequest(requestId);
    if (!request) throw new ArtifactWorkspaceError('invalid_target', 'generation request is missing');
    this.db.prepare('update workspace_generation_requests set state = ?, error_code = ?, updated_at = ? where id = ?')
      .run(state, errorCode ?? null, this.now(), requestId);
    return this.requireGenerationRequest(requestId);
  }

  cancelLease(leaseId: string): WorkspaceGenerationLease {
    const result = this.db.prepare(`
      update workspace_generation_leases set cancelled_at = ?
      where id = ? and consumed_at is null and cancelled_at is null
    `).run(this.now(), leaseId);
    if (!changed(result)) throw new ArtifactWorkspaceError('invalid_target', 'lease cannot be cancelled');
    return this.requireLease(leaseId);
  }

  consumeLease(leaseId: string): WorkspaceGenerationLease {
    const result = this.db.prepare(`
      update workspace_generation_leases set consumed_at = ?
      where id = ? and consumed_at is null and cancelled_at is null
    `).run(this.now(), leaseId);
    if (!changed(result)) throw new ArtifactWorkspaceError('invalid_target', 'lease cannot be consumed');
    return this.requireLease(leaseId);
  }

  extendLease(input: { leaseId: string; expiresAt: string }): WorkspaceGenerationLease {
    const lease = this.getLease(input.leaseId);
    if (!lease || lease.consumedAt || lease.cancelledAt || Date.parse(input.expiresAt) <= Date.parse(lease.expiresAt)) {
      throw new ArtifactWorkspaceError('invalid_target', 'lease cannot be extended');
    }
    this.db.prepare('update workspace_generation_leases set expires_at = ? where id = ?')
      .run(input.expiresAt, input.leaseId);
    return this.requireLease(input.leaseId);
  }

  commitGenerationArtifact(input: {
    generationRequestId: string;
    leaseId: string;
    producedArtifactId: string;
    projectionKind: 'narrow_tool' | 'task_event' | 'startup_reconcile';
    sourceLocatorHash: string;
    stagingId: string;
    version: Omit<ArtifactWorkspaceVersion, 'id' | 'lineageId' | 'createdAt' | 'status' | 'parentVersionId'>;
  }): { version: ArtifactWorkspaceVersion; node: ArtifactWorkspaceNode } {
    return this.transaction(() => {
      const existingClaim = this.getArtifactClaim(input.generationRequestId, input.producedArtifactId);
      if (existingClaim) {
        this.db.prepare(`
          insert or ignore into artifact_workspace_projection_receipts (
            generation_request_id, produced_artifact_id, projection_kind, created_at
          ) values (?, ?, ?, ?)
        `).run(input.generationRequestId, input.producedArtifactId, input.projectionKind, this.now());
        if (existingClaim.outcomeKind !== 'ready_version') {
          throw new ArtifactWorkspaceError('generation_conflict', 'artifact was already quarantined');
        }
        const version = this.getVersion(existingClaim.outcomeId);
        const request = this.getGenerationRequest(input.generationRequestId);
        const node = request ? this.getNode(request.placeholderNodeId) : undefined;
        if (!version || !node) throw new ArtifactWorkspaceError('artifact_missing', 'claimed artifact is incomplete');
        this.db.prepare('delete from artifact_workspace_staging_files where id = ?').run(input.stagingId);
        return { version, node };
      }
      const request = this.getGenerationRequest(input.generationRequestId);
      const lease = this.getLease(input.leaseId);
      if (
        !request || !lease
        || request.id !== lease.generationRequestId
        || request.state !== 'running'
        || lease.consumedAt || lease.cancelledAt
        || Date.parse(this.now()) >= Date.parse(lease.expiresAt)
      ) {
        throw new ArtifactWorkspaceError('generation_conflict', 'generation is not claimable');
      }
      const node = this.getNode(request.placeholderNodeId);
      if (!node || node.kind !== 'placeholder' || node.tombstonedAt) {
        throw new ArtifactWorkspaceError('generation_conflict', 'generation target changed');
      }

      let lineageId: string;
      let parentVersionId: string | undefined;
      if (lease.allowedAction === 'append_revision') {
        const parent = lease.sourceVersionId ? this.getVersion(lease.sourceVersionId) : undefined;
        if (!parent) throw new ArtifactWorkspaceError('invalid_target', 'revision source is missing');
        lineageId = parent.lineageId;
        parentVersionId = parent.id;
      } else {
        const timestamp = this.now();
        lineageId = this.createId('lineage');
        this.db.prepare(`
          insert into artifact_lineages (
            id, workspace_id, source_locator_hash, preferred_version_id, created_at, updated_at
          ) values (?, ?, ?, null, ?, ?)
        `).run(lineageId, request.workspaceId, input.sourceLocatorHash, timestamp, timestamp);
      }

      const version = this.insertVersion(lineageId, { ...input.version, parentVersionId });
      if (lease.allowedAction !== 'append_revision') {
        this.db.prepare('update artifact_lineages set preferred_version_id = ?, updated_at = ? where id = ?')
          .run(version.id, this.now(), lineageId);
      }
      this.db.prepare(`
        update artifact_workspace_nodes set
          kind = 'artifact', lineage_id = ?, artifact_version_id = ?, placeholder_kind = null,
          owner = 'agent', created_by_task_id = ?, updated_at = ?
        where id = ?
      `).run(lineageId, version.id, lease.producingTaskId, this.now(), node.id);
      this.db.prepare(`
        update artifact_workspaces set structure_revision = structure_revision + 1, updated_at = ? where id = ?
      `).run(this.now(), request.workspaceId);
      this.db.prepare(`
        update workspace_generation_requests set state = 'ready', error_code = null, updated_at = ? where id = ?
      `).run(this.now(), request.id);
      this.db.prepare('update workspace_generation_leases set consumed_at = ? where id = ?')
        .run(this.now(), lease.id);
      this.db.prepare(`
        insert into artifact_workspace_projection_receipts (
          generation_request_id, produced_artifact_id, projection_kind, created_at
        ) values (?, ?, ?, ?)
      `).run(request.id, input.producedArtifactId, input.projectionKind, this.now());
      this.db.prepare(`
        insert into artifact_workspace_artifact_claims (
          generation_request_id, produced_artifact_id, outcome_kind, outcome_id, created_at
        ) values (?, ?, 'ready_version', ?, ?)
      `).run(request.id, input.producedArtifactId, version.id, this.now());
      this.db.prepare('delete from artifact_workspace_staging_files where id = ?').run(input.stagingId);
      return { version, node: this.requireNode(node.id) };
    });
  }

  createStagingFile(input: Omit<ArtifactWorkspaceStagingFile, 'id' | 'createdAt'>): ArtifactWorkspaceStagingFile {
    this.validateStaging(input);
    const id = this.createId('staging');
    this.db.prepare(`
      insert into artifact_workspace_staging_files (
        id, source, generation_request_id, producing_task_id, produced_artifact_id,
        source_locator_hash, availability, file_ref, owner, quarantine_reason, keep,
        created_at, expires_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, 'system_staging', ?, ?, ?, ?)
    `).run(
      id,
      input.source,
      input.generationRequestId ?? null,
      input.producingTaskId ?? null,
      input.producedArtifactId ?? null,
      input.sourceLocatorHash ?? null,
      input.availability,
      input.fileRef ?? null,
      input.quarantineReason ?? null,
      input.keep ? 1 : 0,
      this.now(),
      input.expiresAt,
    );
    return this.requireStaging(id);
  }

  commitQuarantineArtifact(input: {
    generationRequestId: string;
    producedArtifactId: string;
    projectionKind: 'narrow_tool' | 'task_event' | 'startup_reconcile';
    staging: Omit<ArtifactWorkspaceStagingFile, 'id' | 'createdAt' | 'generationRequestId' | 'producedArtifactId'>;
  }): {
    created: boolean;
    outcomeKind: 'ready_version' | 'staging';
    outcomeId: string;
    staging?: ArtifactWorkspaceStagingFile;
  } {
    const stagingInput = {
      ...input.staging,
      generationRequestId: input.generationRequestId,
      producedArtifactId: input.producedArtifactId,
    };
    this.validateStaging(stagingInput);
    return this.transaction(() => {
      this.db.prepare(`
        insert or ignore into artifact_workspace_projection_receipts (
          generation_request_id, produced_artifact_id, projection_kind, created_at
        ) values (?, ?, ?, ?)
      `).run(input.generationRequestId, input.producedArtifactId, input.projectionKind, this.now());
      const existing = this.getArtifactClaim(input.generationRequestId, input.producedArtifactId);
      if (existing) {
        return { created: false, ...existing };
      }
      const id = this.createId('staging');
      this.db.prepare(`
        insert into artifact_workspace_staging_files (
          id, source, generation_request_id, producing_task_id, produced_artifact_id,
          source_locator_hash, availability, file_ref, owner, quarantine_reason, keep,
          created_at, expires_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'system_staging', ?, ?, ?, ?)
      `).run(
        id,
        stagingInput.source,
        stagingInput.generationRequestId ?? null,
        stagingInput.producingTaskId ?? null,
        stagingInput.producedArtifactId ?? null,
        stagingInput.sourceLocatorHash ?? null,
        stagingInput.availability,
        stagingInput.fileRef ?? null,
        stagingInput.quarantineReason ?? null,
        stagingInput.keep ? 1 : 0,
        this.now(),
        stagingInput.expiresAt,
      );
      this.db.prepare(`
        insert into artifact_workspace_artifact_claims (
          generation_request_id, produced_artifact_id, outcome_kind, outcome_id, created_at
        ) values (?, ?, 'staging', ?, ?)
      `).run(input.generationRequestId, input.producedArtifactId, id, this.now());
      return {
        created: true,
        outcomeKind: 'staging' as const,
        outcomeId: id,
        staging: this.requireStaging(id),
      };
    });
  }

  getStagingFile(id: string): ArtifactWorkspaceStagingFile | undefined {
    const row = this.db.prepare('select * from artifact_workspace_staging_files where id = ?').get(id) as Row | undefined;
    return row ? rowToStaging(row) : undefined;
  }

  listStagingFiles(): ArtifactWorkspaceStagingFile[] {
    return (this.db.prepare('select * from artifact_workspace_staging_files order by created_at, id').all() as Row[])
      .map(rowToStaging);
  }

  deleteStagingFile(id: string): void {
    this.db.prepare('delete from artifact_workspace_staging_files where id = ?').run(id);
  }

  updateStagingFile(input: {
    id: string;
    fileRef?: string;
    availability?: ArtifactWorkspaceStagingFile['availability'];
    quarantineReason?: ArtifactWorkspaceStagingFile['quarantineReason'];
  }): ArtifactWorkspaceStagingFile {
    const current = this.getStagingFile(input.id);
    if (!current) throw new ArtifactWorkspaceError('invalid_target', 'staging row is missing');
    const next = {
      ...current,
      fileRef: input.fileRef ?? current.fileRef,
      availability: input.availability ?? current.availability,
      quarantineReason: input.quarantineReason ?? current.quarantineReason,
    };
    this.validateStaging(next);
    this.db.prepare(`
      update artifact_workspace_staging_files
      set file_ref = ?, availability = ?, quarantine_reason = ? where id = ?
    `).run(next.fileRef ?? null, next.availability, next.quarantineReason ?? null, input.id);
    return this.requireStaging(input.id);
  }

  recordProjectionReceipt(input: {
    generationRequestId: string;
    producedArtifactId: string;
    projectionKind: 'narrow_tool' | 'task_event' | 'startup_reconcile';
  }): boolean {
    const result = this.db.prepare(`
      insert or ignore into artifact_workspace_projection_receipts (
        generation_request_id, produced_artifact_id, projection_kind, created_at
      ) values (?, ?, ?, ?)
    `).run(input.generationRequestId, input.producedArtifactId, input.projectionKind, this.now());
    return changed(result);
  }

  claimArtifactOutcome(input: {
    generationRequestId: string;
    producedArtifactId: string;
    outcomeKind: 'ready_version' | 'staging';
    outcomeId: string;
  }): boolean {
    const result = this.db.prepare(`
      insert or ignore into artifact_workspace_artifact_claims (
        generation_request_id, produced_artifact_id, outcome_kind, outcome_id, created_at
      ) values (?, ?, ?, ?, ?)
    `).run(input.generationRequestId, input.producedArtifactId, input.outcomeKind, input.outcomeId, this.now());
    return changed(result);
  }

  getArtifactClaim(generationRequestId: string, producedArtifactId: string): {
    outcomeKind: 'ready_version' | 'staging';
    outcomeId: string;
  } | undefined {
    const row = this.db.prepare(`
      select outcome_kind, outcome_id from artifact_workspace_artifact_claims
      where generation_request_id = ? and produced_artifact_id = ?
    `).get(generationRequestId, producedArtifactId) as Row | undefined;
    return row ? {
      outcomeKind: stringValue(row.outcome_kind) as 'ready_version' | 'staging',
      outcomeId: stringValue(row.outcome_id),
    } : undefined;
  }

  saveTaskCursor(taskId: string, eventIndex: number): void {
    this.db.prepare(`
      insert into artifact_workspace_task_cursors (task_id, event_index, updated_at)
      values (?, ?, ?)
      on conflict(task_id) do update set
        event_index = max(artifact_workspace_task_cursors.event_index, excluded.event_index),
        updated_at = excluded.updated_at
    `).run(taskId, eventIndex, this.now());
  }

  getTaskCursor(taskId: string): number {
    const row = this.db.prepare('select event_index from artifact_workspace_task_cursors where task_id = ?').get(taskId) as Row | undefined;
    return row ? numberValue(row.event_index) : -1;
  }

  saveView(input: {
    workspaceId: string;
    viewKey: string;
    viewport: ArtifactWorkspaceView['viewport'];
  }): ArtifactWorkspaceView {
    this.requireWorkspace(input.workspaceId);
    if (!input.viewKey.trim()) throw new ArtifactWorkspaceError('invalid_target', 'view key is required');
    this.db.prepare(`
      insert into artifact_workspace_views (
        workspace_id, view_key, viewport_x, viewport_y, viewport_zoom, view_revision, updated_at
      ) values (?, ?, ?, ?, ?, 1, ?)
      on conflict(workspace_id, view_key) do update set
        viewport_x = excluded.viewport_x,
        viewport_y = excluded.viewport_y,
        viewport_zoom = excluded.viewport_zoom,
        view_revision = artifact_workspace_views.view_revision + 1,
        updated_at = excluded.updated_at
    `).run(input.workspaceId, input.viewKey, input.viewport.x, input.viewport.y, input.viewport.zoom, this.now());
    return this.requireView(input.workspaceId, input.viewKey);
  }

  getView(workspaceId: string, viewKey: string): ArtifactWorkspaceView | undefined {
    const row = this.db.prepare(`
      select * from artifact_workspace_views where workspace_id = ? and view_key = ?
    `).get(workspaceId, viewKey) as Row | undefined;
    return row ? rowToView(row) : undefined;
  }

  cleanupSecondaryViews(input: { before: string; activeViewKeys: Set<string> }): number {
    const rows = this.db.prepare(`
      select workspace_id, view_key from artifact_workspace_views
      where view_key <> 'primary' and updated_at < ?
    `).all(input.before) as Row[];
    let removed = 0;
    this.transaction(() => {
      for (const row of rows) {
        const viewKey = stringValue(row.view_key);
        if (input.activeViewKeys.has(viewKey)) continue;
        removed += Number(this.db.prepare(`
          delete from artifact_workspace_views where workspace_id = ? and view_key = ?
        `).run(stringValue(row.workspace_id), viewKey).changes);
      }
    });
    return removed;
  }

  createRelation(input: Omit<ArtifactWorkspaceRelation, 'id' | 'createdAt'> & { expectedStructureRevision: number }): ArtifactWorkspaceRelation {
    return this.transaction(() => {
      const from = this.getNode(input.fromNodeId);
      const to = this.getNode(input.toNodeId);
      if (!from || !to || from.workspaceId !== input.workspaceId || to.workspaceId !== input.workspaceId) {
        throw new ArtifactWorkspaceError('invalid_target', 'relation endpoints must be in one workspace');
      }
      this.bumpStructure(input.workspaceId, input.expectedStructureRevision);
      const id = this.createId('relation');
      this.db.prepare(`
        insert into artifact_workspace_relations (
          id, workspace_id, from_node_id, to_node_id, kind, order_index, created_by, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.workspaceId,
        input.fromNodeId,
        input.toNodeId,
        input.kind,
        input.order ?? null,
        input.createdBy,
        this.now(),
      );
      const row = this.db.prepare('select * from artifact_workspace_relations where id = ?').get(id) as Row;
      return rowToRelation(row);
    });
  }

  removeRelation(input: {
    workspaceId: string;
    fromNodeId: string;
    toNodeId: string;
    kind: ArtifactWorkspaceRelation['kind'];
    expectedStructureRevision: number;
  }): boolean {
    return this.transaction(() => {
      this.bumpStructure(input.workspaceId, input.expectedStructureRevision);
      const result = this.db.prepare(`
        delete from artifact_workspace_relations
        where workspace_id = ? and from_node_id = ? and to_node_id = ? and kind = ?
      `).run(input.workspaceId, input.fromNodeId, input.toNodeId, input.kind);
      if (!changed(result)) throw new ArtifactWorkspaceError('invalid_target', 'relation is missing');
      return true;
    });
  }

  listRelations(workspaceId: string): ArtifactWorkspaceRelation[] {
    return (this.db.prepare(`
      select * from artifact_workspace_relations where workspace_id = ? order by created_at, id
    `).all(workspaceId) as Row[]).map(rowToRelation);
  }

  recordEvent(input: {
    workspaceId: string;
    conversationId: string;
    requestId?: string;
    eventName: ArtifactWorkspaceEventName;
    dedupeKey?: string;
    metadata: Record<string, string | number | boolean | null>;
  }): boolean {
    const workspace = this.requireWorkspace(input.workspaceId);
    if (workspace.conversationId !== input.conversationId) {
      throw new ArtifactWorkspaceError('invalid_target', 'event conversation does not own workspace');
    }
    const id = this.createId('event');
    const result = this.db.prepare(`
      insert or ignore into artifact_workspace_events (
        id, workspace_id, conversation_id, request_id, event_name, dedupe_key, metadata_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.conversationId,
      input.requestId ?? null,
      input.eventName,
      input.dedupeKey ?? null,
      JSON.stringify(input.metadata),
      this.now(),
    );
    return changed(result);
  }

  listEvents(): ArtifactWorkspaceEvent[] {
    return (this.db.prepare('select * from artifact_workspace_events order by created_at, id').all() as Row[])
      .map(rowToEvent);
  }

  recordAudit(input: {
    actorId?: string;
    actorKind: 'user' | 'agent' | 'scheduler' | 'system_reconcile';
    requestSource?: 'user' | 'agent' | 'scheduler';
    workspaceId?: string;
    nodeId?: string;
    versionId?: string;
    expectedRevision?: number;
    actualRevision?: number;
    producingTaskId?: string;
    producingAgentId?: string;
    pluginSource?: string;
    action: string;
    result: 'success' | 'denied' | 'failed' | 'quarantined';
    errorCode?: string;
  }): void {
    this.db.prepare(`
      insert into artifact_workspace_audit_log (
        id, actor_id, actor_kind, request_source, workspace_id, node_id, version_id,
        expected_revision, actual_revision, producing_task_id, producing_agent_id,
        plugin_source, action, result, error_code, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.createId('audit'), input.actorId ?? null, input.actorKind, input.requestSource ?? null,
      input.workspaceId ?? null, input.nodeId ?? null, input.versionId ?? null,
      input.expectedRevision ?? null, input.actualRevision ?? null, input.producingTaskId ?? null,
      input.producingAgentId ?? null, input.pluginSource ?? null, input.action, input.result,
      input.errorCode ?? null, this.now(),
    );
  }

  listAudit(): Array<Record<string, unknown>> {
    return this.db.prepare('select * from artifact_workspace_audit_log order by created_at, rowid').all() as Array<Record<string, unknown>>;
  }

  getTelemetryAggregate(): {
    eligibleConversationCount: number;
    revisionRequestedConversationCount: number;
    revisionReadyRequestCount: number;
    revisionCompareRequestCount: number;
    revisionPreferredRequestCount: number;
    multiArtifactWorkspaceCount: number;
    repositionedNodeCount: number;
    returnedWorkspaceCount: number;
    spatialBetaWorkspaceCount: number;
    repositionedWorkspaceCount: number;
    relationOrCollectionWorkspaceCount: number;
    multiArtifactWorkspaceRate: number;
    nodeRepositionRate: number;
    relationOrCollectionRate: number;
    relationOrCollectionWilsonLowerBound: number;
    workspaceReturnRate: number;
    revisionStartRate: number;
    revisionStartWilsonLowerBound: number;
    revisionCompareRate: number;
    revisionCompareWilsonLowerBound: number;
    revisionPreferRate: number;
    revisionPreferWilsonLowerBound: number;
    revisionBranchRate: number;
    revisionDownloadRate: number;
    recoveryAttemptCount: number;
    recoveryClosedAttemptCount: number;
    recoverySuccessCount: number;
    recoverySuccessRate: number;
  } {
    const scalar = (sql: string) => {
      const row = this.db.prepare(sql).get() as { count: number };
      return Number(row.count);
    };
    const events = this.listEvents();
    const distinct = (values: Array<string | undefined>) => new Set(values.filter((value): value is string => Boolean(value))).size;
    const identityFor = (event: ArtifactWorkspaceEvent, metadataKeys: string[]) => {
      if (event.requestId) return event.requestId;
      for (const key of metadataKeys) {
        const value = event.metadata[key];
        if (typeof value === 'string' && value) return value;
      }
      if (event.dedupeKey) return event.dedupeKey;
      return undefined;
    };
    const rate = (successes: number, total: number) => total > 0 ? successes / total : 0;
    const wilsonLower = (successes: number, total: number) => {
      if (total <= 0) return 0;
      const z = 1.959963984540054;
      const observed = successes / total;
      const denominator = 1 + (z * z) / total;
      const centre = observed + (z * z) / (2 * total);
      const margin = z * Math.sqrt((observed * (1 - observed) + (z * z) / (4 * total)) / total);
      return Math.max(0, (centre - margin) / denominator);
    };
    const eligibleConversationCount = scalar(`select count(distinct conversation_id) as count from artifact_workspace_events where event_name = 'eligible_artifact_opened'`);
    const revisionRequestedConversationCount = scalar(`select count(distinct conversation_id) as count from artifact_workspace_events where event_name = 'revision_requested'`);
    const generatedVersionIdentity = (event: ArtifactWorkspaceEvent, metadataKey: string): string | undefined => {
      const candidate = typeof event.metadata[metadataKey] === 'string'
        ? String(event.metadata[metadataKey])
        : event.dedupeKey;
      return candidate && this.getVersion(candidate)?.sourceKind === 'workspace_generation' ? candidate : undefined;
    };
    const revisionReadyRequestCount = distinct(events.filter(event => event.eventName === 'revision_ready').map(event => identityFor(event, [])));
    const revisionCompareRequestCount = distinct(events
      .filter(event => event.eventName === 'revision_compare_opened')
      .map(event => generatedVersionIdentity(event, 'rightVersionId')));
    const revisionPreferredRequestCount = distinct(events
      .filter(event => event.eventName === 'revision_preferred')
      .map(event => generatedVersionIdentity(event, 'versionId')));
    const revisionBranchedRequestCount = distinct(events
      .filter(event => event.eventName === 'revision_branched')
      .map(event => generatedVersionIdentity(event, 'versionId')));
    const revisionDownloadedRequestCount = distinct(events
      .filter(event => event.eventName === 'revision_downloaded')
      .map(event => generatedVersionIdentity(event, 'versionId')));
    const recoveryAttempts = events.filter(event => event.eventName === 'recovery_attempted' && event.requestId);
    const recoverySuccessEvents = events.filter(event => event.eventName === 'recovery_succeeded' && event.requestId);
    let recoverySuccessCount = 0;
    let recoveryClosedAttemptCount = 0;
    for (const attempt of recoveryAttempts) {
      const attemptAt = Date.parse(attempt.createdAt);
      const success = recoverySuccessEvents.find(event => (
        event.requestId === attempt.requestId
        && Date.parse(event.createdAt) >= attemptAt
        && Date.parse(event.createdAt) - attemptAt <= 30_000
      ));
      if (success) {
        recoverySuccessCount++;
        recoveryClosedAttemptCount++;
      } else if (this.nowFn() - attemptAt >= 30_000) {
        recoveryClosedAttemptCount++;
      }
    }
    const spatialBetaWorkspaceIds = new Set(events
      .filter(event => event.eventName === 'workspace_opened' && event.metadata.spatialEnabled === true)
      .map(event => event.workspaceId));
    const multiArtifactWorkspaceIds = new Set(events
      .filter(event => event.eventName === 'spatial_workspace_multi_artifact_reached')
      .map(event => event.workspaceId));
    const repositionedNodesByWorkspace = new Map<string, Set<string>>();
    for (const event of events.filter(candidate => candidate.eventName === 'spatial_node_repositioned')) {
      const nodeId = typeof event.metadata.nodeId === 'string' ? event.metadata.nodeId : undefined;
      if (!nodeId) continue;
      const nodes = repositionedNodesByWorkspace.get(event.workspaceId) ?? new Set<string>();
      nodes.add(nodeId);
      repositionedNodesByWorkspace.set(event.workspaceId, nodes);
    }
    const repositionedWorkspaceCount = [...repositionedNodesByWorkspace.values()].filter(nodes => nodes.size >= 2).length;
    const relationOrCollectionWorkspaceIds = new Set(events
      .filter(event => event.eventName === 'relation_created')
      .map(event => event.workspaceId));
    const returnedWorkspaceIds = new Set(events
      .filter(event => event.eventName === 'spatial_workspace_returned')
      .map(event => event.workspaceId));
    const spatialBetaWorkspaceCount = spatialBetaWorkspaceIds.size;
    return {
      eligibleConversationCount,
      revisionRequestedConversationCount,
      revisionReadyRequestCount,
      revisionCompareRequestCount,
      revisionPreferredRequestCount,
      multiArtifactWorkspaceCount: multiArtifactWorkspaceIds.size,
      repositionedNodeCount: distinct([...repositionedNodesByWorkspace.values()].flatMap(nodes => [...nodes])),
      returnedWorkspaceCount: returnedWorkspaceIds.size,
      spatialBetaWorkspaceCount,
      repositionedWorkspaceCount,
      relationOrCollectionWorkspaceCount: relationOrCollectionWorkspaceIds.size,
      multiArtifactWorkspaceRate: rate(multiArtifactWorkspaceIds.size, spatialBetaWorkspaceCount),
      nodeRepositionRate: rate(repositionedWorkspaceCount, spatialBetaWorkspaceCount),
      relationOrCollectionRate: rate(relationOrCollectionWorkspaceIds.size, spatialBetaWorkspaceCount),
      relationOrCollectionWilsonLowerBound: wilsonLower(relationOrCollectionWorkspaceIds.size, spatialBetaWorkspaceCount),
      workspaceReturnRate: rate(returnedWorkspaceIds.size, spatialBetaWorkspaceCount),
      revisionStartRate: rate(revisionRequestedConversationCount, eligibleConversationCount),
      revisionStartWilsonLowerBound: wilsonLower(revisionRequestedConversationCount, eligibleConversationCount),
      revisionCompareRate: rate(revisionCompareRequestCount, revisionReadyRequestCount),
      revisionCompareWilsonLowerBound: wilsonLower(revisionCompareRequestCount, revisionReadyRequestCount),
      revisionPreferRate: rate(revisionPreferredRequestCount, revisionReadyRequestCount),
      revisionPreferWilsonLowerBound: wilsonLower(revisionPreferredRequestCount, revisionReadyRequestCount),
      revisionBranchRate: rate(revisionBranchedRequestCount, revisionReadyRequestCount),
      revisionDownloadRate: rate(revisionDownloadedRequestCount, revisionReadyRequestCount),
      recoveryAttemptCount: recoveryAttempts.length,
      recoveryClosedAttemptCount,
      recoverySuccessCount,
      recoverySuccessRate: rate(recoverySuccessCount, recoveryClosedAttemptCount),
    };
  }

  private insertNode(
    workspaceId: string,
    node: Omit<ArtifactWorkspaceNode, 'id' | 'workspaceId' | 'layoutRevision' | 'createdAt' | 'updatedAt' | 'placeholderState'>,
  ): ArtifactWorkspaceNode {
    const timestamp = this.now();
    const id = this.createId('node');
    this.db.prepare(`
      insert into artifact_workspace_nodes (
        id, workspace_id, kind, lineage_id, artifact_version_id, placeholder_kind,
        title, note_text, owner, created_by_task_id, x, y, width, height, z_index,
        layout_revision, tombstoned_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      workspaceId,
      node.kind,
      node.lineageId ?? null,
      node.artifactVersionId ?? null,
      node.placeholderKind ?? null,
      node.title ?? null,
      node.noteText ?? null,
      node.owner,
      node.createdByTaskId ?? null,
      node.x,
      node.y,
      node.width,
      node.height,
      node.zIndex,
      node.tombstonedAt ?? null,
      timestamp,
      timestamp,
    );
    return this.requireNode(id);
  }

  private rowToNode(row: Row): ArtifactWorkspaceNode {
    const kind = stringValue(row.kind) as ArtifactWorkspaceNode['kind'];
    let placeholderState: ArtifactWorkspaceNode['placeholderState'];
    if (kind === 'placeholder') {
      const requestRow = this.db.prepare(`
        select state from workspace_generation_requests
        where placeholder_node_id = ? and state <> 'superseded'
        order by created_at desc, id desc limit 1
      `).get(stringValue(row.id)) as Row | undefined;
      const state = requestRow ? stringValue(requestRow.state) as ArtifactWorkspaceGenerationState : undefined;
      if (!state) placeholderState = 'draft';
      else if (state === 'prepared' || state === 'running') placeholderState = 'generating';
      else if (state === 'failed' || state === 'cancelled' || state === 'needs_recovery') placeholderState = state;
    }
    return {
      id: stringValue(row.id),
      workspaceId: stringValue(row.workspace_id),
      kind,
      lineageId: optionalString(row.lineage_id),
      artifactVersionId: optionalString(row.artifact_version_id),
      placeholderKind: optionalString(row.placeholder_kind) as ArtifactWorkspaceNode['placeholderKind'],
      placeholderState,
      title: optionalString(row.title),
      noteText: optionalString(row.note_text),
      owner: stringValue(row.owner) as ArtifactWorkspaceNode['owner'],
      createdByTaskId: optionalString(row.created_by_task_id),
      x: numberValue(row.x),
      y: numberValue(row.y),
      width: numberValue(row.width),
      height: numberValue(row.height),
      zIndex: numberValue(row.z_index),
      layoutRevision: numberValue(row.layout_revision),
      tombstonedAt: optionalString(row.tombstoned_at),
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at),
    };
  }

  private insertVersion(
    lineageId: string,
    input: Omit<ArtifactWorkspaceVersion, 'id' | 'lineageId' | 'createdAt' | 'status'> & { status?: 'ready' | 'missing' },
  ): ArtifactWorkspaceVersion {
    this.validateVersion(input);
    const id = this.createId('version');
    this.db.prepare(`
      insert into artifact_workspace_versions (
        id, lineage_id, parent_version_id, file_ref, storage_kind, entry_ref,
        package_manifest_ref, source_kind, source_task_id, source_artifact_id,
        source_evidence_id, external_task_ref, kind, mime_type, byte_size, checksum,
        producing_task_id, producing_agent_id, runtime_source, plugin_source, status, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      lineageId,
      input.parentVersionId ?? null,
      input.fileRef,
      input.storageKind,
      input.entryRef ?? null,
      input.packageManifestRef ?? null,
      input.sourceKind,
      input.sourceTaskId ?? null,
      input.sourceArtifactId ?? null,
      input.sourceEvidenceId ?? null,
      input.externalTaskRef ?? null,
      input.kind,
      input.mimeType ?? null,
      input.byteSize ?? null,
      input.checksum,
      input.producingTaskId ?? null,
      input.producingAgentId ?? null,
      input.runtimeSource ?? null,
      input.pluginSource ?? null,
      input.status ?? 'ready',
      this.now(),
    );
    return this.requireVersion(id);
  }

  private validateVersion(input: Partial<ArtifactWorkspaceVersion> & Pick<ArtifactWorkspaceVersion, 'fileRef' | 'storageKind' | 'sourceKind' | 'kind' | 'checksum'>): void {
    if (!input.fileRef || !input.kind || !/^[a-f0-9]{64}$/i.test(input.checksum)) {
      throw new ArtifactWorkspaceError('invalid_target', 'version identity and checksum are required');
    }
    if (input.storageKind === 'sealed_package' && (!input.entryRef || !input.packageManifestRef)) {
      throw new ArtifactWorkspaceError('invalid_target', 'sealed package needs entry and manifest refs');
    }
    if (input.storageKind === 'single_file' && (input.entryRef || input.packageManifestRef)) {
      throw new ArtifactWorkspaceError('invalid_target', 'single file cannot carry package refs');
    }
    if (input.sourceKind === 'workspace_generation' && !input.producingTaskId) {
      throw new ArtifactWorkspaceError('invalid_target', 'generated version needs producing task');
    }
    if (input.sourceKind === 'materialized_base' && input.producingTaskId) {
      throw new ArtifactWorkspaceError('invalid_target', 'materialized base cannot claim a producing task');
    }
  }

  private validateNode(
    workspaceId: string,
    node: Omit<ArtifactWorkspaceNode, 'id' | 'workspaceId' | 'layoutRevision' | 'createdAt' | 'updatedAt' | 'placeholderState'>,
  ): void {
    this.requireWorkspace(workspaceId);
    if (![node.x, node.y, node.width, node.height, node.zIndex].every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
      throw new ArtifactWorkspaceError('invalid_target', 'node geometry is invalid');
    }
    if (node.kind === 'placeholder') {
      if (node.owner !== 'user') throw new ArtifactWorkspaceError('permission_denied', 'agent cannot create draft placeholders');
      if (!node.placeholderKind || node.lineageId || node.artifactVersionId || node.noteText) {
        throw new ArtifactWorkspaceError('invalid_target', 'placeholder identity is invalid');
      }
      return;
    }
    if (node.kind === 'artifact') {
      const lineage = node.lineageId ? this.getLineage(node.lineageId) : undefined;
      const version = node.artifactVersionId ? this.getVersion(node.artifactVersionId) : undefined;
      if (!lineage || lineage.workspaceId !== workspaceId || !version || version.lineageId !== lineage.id) {
        throw new ArtifactWorkspaceError('invalid_target', 'artifact node identity is invalid');
      }
      if (node.owner === 'agent' && !node.createdByTaskId) {
        throw new ArtifactWorkspaceError('invalid_target', 'agent artifact needs creating task');
      }
      if (node.placeholderKind || node.noteText) {
        throw new ArtifactWorkspaceError('invalid_target', 'artifact node carries incompatible fields');
      }
      return;
    }
    if (node.owner !== 'user') throw new ArtifactWorkspaceError('permission_denied', 'agent cannot create this node kind');
    if (node.kind === 'collection') {
      if (!node.title?.trim() || node.lineageId || node.artifactVersionId || node.placeholderKind || node.noteText) {
        throw new ArtifactWorkspaceError('invalid_target', 'collection identity is invalid');
      }
      return;
    }
    if (node.kind === 'note') {
      if (node.lineageId || node.artifactVersionId || node.placeholderKind || node.title) {
        throw new ArtifactWorkspaceError('invalid_target', 'note identity is invalid');
      }
      if ((node.noteText?.length ?? 0) > 20_000) {
        throw new ArtifactWorkspaceError('invalid_target', 'note is too long');
      }
    }
  }

  private validateStaging(input: Omit<ArtifactWorkspaceStagingFile, 'id' | 'createdAt'>): void {
    if (input.owner !== 'system_staging') {
      throw new ArtifactWorkspaceError('invalid_target', 'staging owner is fixed');
    }
    if (input.source === 'generation') {
      if (!input.generationRequestId || !input.producingTaskId || !input.producedArtifactId || input.sourceLocatorHash) {
        throw new ArtifactWorkspaceError('invalid_target', 'generation staging identity is incomplete');
      }
    } else if (!input.sourceLocatorHash || input.generationRequestId || input.producingTaskId || input.producedArtifactId) {
      throw new ArtifactWorkspaceError('invalid_target', 'materialize staging identity is incomplete');
    }
    if (input.availability === 'present' && !input.fileRef) {
      throw new ArtifactWorkspaceError('invalid_target', 'present staging needs a file ref');
    }
    if (input.availability === 'unavailable' && (input.fileRef || input.quarantineReason !== 'invalid_artifact_ref')) {
      throw new ArtifactWorkspaceError('invalid_target', 'only invalid refs may be unavailable');
    }
  }

  private bumpStructure(workspaceId: string, expectedRevision: number): void {
    const result = this.db.prepare(`
      update artifact_workspaces set structure_revision = structure_revision + 1, updated_at = ?
      where id = ? and structure_revision = ?
    `).run(this.now(), workspaceId, expectedRevision);
    if (!changed(result)) {
      throw new ArtifactWorkspaceError(
        'structure_revision_conflict',
        'workspace structure revision conflict',
        this.getWorkspace(workspaceId),
      );
    }
  }

  private requireWorkspace(id: string): ArtifactWorkspace {
    const workspace = this.getWorkspace(id);
    if (!workspace) throw new ArtifactWorkspaceError('workspace_not_found', 'workspace is missing');
    return workspace;
  }

  private requireNode(id: string): ArtifactWorkspaceNode {
    const node = this.getNode(id);
    if (!node) throw new ArtifactWorkspaceError('invalid_target', 'node is missing');
    return node;
  }

  private requireLineage(id: string): ArtifactLineage {
    const lineage = this.getLineage(id);
    if (!lineage) throw new ArtifactWorkspaceError('invalid_target', 'lineage is missing');
    return lineage;
  }

  private requireVersion(id: string): ArtifactWorkspaceVersion {
    const version = this.getVersion(id);
    if (!version) throw new ArtifactWorkspaceError('artifact_not_found', 'version is missing');
    return version;
  }

  private requireGenerationRequest(id: string): WorkspaceGenerationRequest {
    const request = this.getGenerationRequest(id);
    if (!request) throw new ArtifactWorkspaceError('invalid_target', 'generation request is missing');
    return request;
  }

  private requireLease(id: string): WorkspaceGenerationLease {
    const lease = this.getLease(id);
    if (!lease) throw new ArtifactWorkspaceError('invalid_target', 'lease is missing');
    return lease;
  }

  private requireStaging(id: string): ArtifactWorkspaceStagingFile {
    const staging = this.getStagingFile(id);
    if (!staging) throw new ArtifactWorkspaceError('invalid_target', 'staging row is missing');
    return staging;
  }

  private requireView(workspaceId: string, viewKey: string): ArtifactWorkspaceView {
    const view = this.getView(workspaceId, viewKey);
    if (!view) throw new ArtifactWorkspaceError('invalid_target', 'view is missing');
    return view;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try { this.db.exec('rollback'); } catch { /* rollback failure does not replace the cause */ }
      throw error;
    }
  }

  private createId(prefix: string): string {
    return this.createIdFn(prefix);
  }

  private now(): string {
    return new Date(this.nowFn()).toISOString();
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists artifact_workspace_meta (
        schema_version integer primary key check(schema_version = 1)
      );
      insert or ignore into artifact_workspace_meta(schema_version) values (1);

      create table if not exists artifact_workspaces (
        id text primary key,
        conversation_id text not null unique,
        workspace_root_id text not null,
        schema_version integer not null check(schema_version = 1),
        structure_revision integer not null default 0,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists artifact_workspace_nodes (
        id text primary key,
        workspace_id text not null references artifact_workspaces(id),
        kind text not null check(kind in ('artifact', 'placeholder', 'collection', 'note')),
        lineage_id text,
        artifact_version_id text,
        placeholder_kind text,
        title text,
        note_text text,
        owner text not null check(owner in ('user', 'agent')),
        created_by_task_id text,
        x real not null,
        y real not null,
        width real not null,
        height real not null,
        z_index integer not null,
        layout_revision integer not null default 0,
        tombstoned_at text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists artifact_workspace_relations (
        id text primary key,
        workspace_id text not null references artifact_workspaces(id),
        from_node_id text not null references artifact_workspace_nodes(id),
        to_node_id text not null references artifact_workspace_nodes(id),
        kind text not null check(kind in ('derived_from', 'references', 'part_of_collection')),
        order_index integer,
        created_by text not null check(created_by in ('user', 'agent', 'system')),
        created_at text not null
      );

      create table if not exists artifact_lineages (
        id text primary key,
        workspace_id text not null references artifact_workspaces(id),
        source_locator_hash text not null,
        preferred_version_id text,
        created_at text not null,
        updated_at text not null,
        unique(workspace_id, source_locator_hash)
      );

      create table if not exists artifact_workspace_versions (
        id text primary key,
        lineage_id text not null references artifact_lineages(id),
        parent_version_id text references artifact_workspace_versions(id),
        file_ref text not null,
        storage_kind text not null check(storage_kind in ('single_file', 'sealed_package')),
        entry_ref text,
        package_manifest_ref text,
        source_kind text not null check(source_kind in ('materialized_base', 'workspace_generation')),
        source_task_id text,
        source_artifact_id text,
        source_evidence_id text,
        external_task_ref text,
        kind text not null,
        mime_type text,
        byte_size integer,
        checksum text not null,
        producing_task_id text,
        producing_agent_id text,
        runtime_source text,
        plugin_source text,
        status text not null check(status in ('ready', 'missing')),
        created_at text not null
      );

      create table if not exists workspace_generation_requests (
        id text primary key,
        workspace_id text not null references artifact_workspaces(id),
        placeholder_node_id text not null references artifact_workspace_nodes(id),
        source_version_id text references artifact_workspace_versions(id),
        producing_task_id text,
        external_task_ref text,
        state text not null check(state in ('prepared', 'running', 'ready', 'failed', 'cancelled', 'needs_recovery', 'superseded')),
        error_code text,
        supersedes_request_id text references workspace_generation_requests(id),
        created_at text not null,
        updated_at text not null
      );
      create unique index if not exists uq_workspace_active_generation
        on workspace_generation_requests(placeholder_node_id)
        where state in ('prepared', 'running', 'needs_recovery');

      create table if not exists workspace_generation_leases (
        id text primary key,
        generation_request_id text not null unique references workspace_generation_requests(id),
        workspace_id text not null references artifact_workspaces(id),
        node_id text not null references artifact_workspace_nodes(id),
        source_version_id text references artifact_workspace_versions(id),
        allowed_action text not null check(allowed_action in ('fulfill_placeholder', 'append_revision', 'append_collection_item')),
        requested_kind text not null check(requested_kind in ('image', 'html', 'markdown', 'slides')),
        producing_task_id text not null,
        producing_agent_id text,
        expires_at text not null,
        consumed_at text,
        cancelled_at text,
        created_at text not null
      );

      create table if not exists artifact_workspace_projection_receipts (
        generation_request_id text not null,
        produced_artifact_id text not null,
        projection_kind text not null check(projection_kind in ('narrow_tool', 'task_event', 'startup_reconcile')),
        created_at text not null,
        primary key(generation_request_id, produced_artifact_id, projection_kind)
      );

      create table if not exists artifact_workspace_artifact_claims (
        generation_request_id text not null,
        produced_artifact_id text not null,
        outcome_kind text not null check(outcome_kind in ('ready_version', 'staging')),
        outcome_id text not null,
        created_at text not null,
        primary key(generation_request_id, produced_artifact_id)
      );

      create table if not exists artifact_workspace_staging_files (
        id text primary key,
        source text not null check(source in ('materialize', 'generation')),
        generation_request_id text,
        producing_task_id text,
        produced_artifact_id text,
        source_locator_hash text,
        availability text not null check(availability in ('present', 'unavailable')),
        file_ref text,
        owner text not null check(owner = 'system_staging'),
        quarantine_reason text,
        keep integer not null default 0 check(keep in (0, 1)),
        created_at text not null,
        expires_at text not null
      );

      create table if not exists artifact_workspace_views (
        workspace_id text not null references artifact_workspaces(id),
        view_key text not null,
        viewport_x real not null,
        viewport_y real not null,
        viewport_zoom real not null,
        view_revision integer not null,
        updated_at text not null,
        primary key(workspace_id, view_key)
      );

      create table if not exists artifact_workspace_view_sessions (
        id text primary key,
        workspace_id text not null references artifact_workspaces(id),
        view_key text not null,
        opened_at text not null,
        last_seen_at text not null,
        closed_at text
      );
      create unique index if not exists uq_artifact_workspace_active_view_session
        on artifact_workspace_view_sessions(workspace_id, view_key)
        where closed_at is null;

      create table if not exists artifact_workspace_events (
        id text primary key,
        workspace_id text not null references artifact_workspaces(id),
        conversation_id text not null,
        request_id text,
        event_name text not null,
        dedupe_key text,
        metadata_json text not null,
        created_at text not null
      );
      create unique index if not exists uq_workspace_event_dedupe
        on artifact_workspace_events(workspace_id, event_name, dedupe_key)
        where dedupe_key is not null;

      create table if not exists artifact_workspace_task_cursors (
        task_id text primary key,
        event_index integer not null,
        updated_at text not null
      );

      create table if not exists artifact_workspace_audit_log (
        id text primary key,
        actor_id text,
        actor_kind text not null check(actor_kind in ('user', 'agent', 'scheduler', 'system_reconcile')),
        request_source text check(request_source in ('user', 'agent', 'scheduler')),
        workspace_id text references artifact_workspaces(id),
        node_id text,
        version_id text,
        expected_revision integer,
        actual_revision integer,
        producing_task_id text,
        producing_agent_id text,
        plugin_source text,
        action text not null,
        result text not null check(result in ('success', 'denied', 'failed', 'quarantined')),
        error_code text,
        created_at text not null
      );
    `);
  }
}

export const ARTIFACT_WORKSPACE_ACTIVE_REQUEST_STATES = [...ACTIVE_REQUEST_STATES] as const;
export const ARTIFACT_WORKSPACE_TERMINAL_REQUEST_STATES = [...TERMINAL_OR_SUPERSEDED_STATES] as const;
