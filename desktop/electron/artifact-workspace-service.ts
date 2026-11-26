import { createLocalSourceWriterLifetime } from '../../src/runtime/verification/local-source-writer-lifetime.js';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import type {
  ArtifactGenerationTarget,
  ArtifactWorkspaceExecutionScope,
  DesktopTaskEvent,
  TaskSnapshot,
} from '../../src/runtime/task-host/types.js';
import type {
  ArtifactLineage,
  ArtifactWorkspaceEventName,
  ArtifactWorkspaceFeatureAccess,
  ArtifactWorkspaceLayoutPatch,
  ArtifactWorkspaceNode,
  ArtifactWorkspacePreview,
  ArtifactWorkspaceQuarantineReason,
  ArtifactWorkspaceRelation,
  ArtifactWorkspaceRequestSource,
  ArtifactWorkspaceRequestedKind,
  ArtifactWorkspaceSnapshot,
  ArtifactWorkspaceVersion,
  ArtifactWorkspaceView,
  WorkspaceGenerationRequest,
} from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceError } from '../shared/artifact-workspace-types.js';
import {
  ArtifactWorkspaceFileError,
  ArtifactWorkspaceFileManager,
  type FinalizedWorkspaceArtifact,
} from './artifact-workspace-files.js';
import { ArtifactWorkspaceStore } from './artifact-workspace-store.js';
import {
  ARTIFACT_WORKSPACE_NOTE_LIMIT,
  ARTIFACT_WORKSPACE_LEASE_GRACE_MS,
  ARTIFACT_WORKSPACE_LEASE_DURATION_MS,
  ARTIFACT_WORKSPACE_STAGING_RETENTION_MS,
} from './artifact-workspace-constants.js';
import type {
  ArtifactWorkspaceFeatureFlags,
  PreparedTaskHost,
  ArtifactWorkspaceServiceOptions,
  ArtifactWorkspaceClaimResult,
  ArtifactWorkspaceChange,
} from './artifact-workspace-service-types.js';
import {
  ArtifactWorkspaceRecoveryTimeout,
  withRecoveryTimeout,
  snapshotReportsPluginUnavailable,
  buildGenerationPrompt,
  copyVersionForGeneration,
  maybeExtendLease,
} from './artifact-workspace-generation.js';
import {
  normalizeKind,
  artifactMatchesRequestedKind,
  mimeForPath,
  pluginSourceFromCreator,
  artifactContentMatchesKind,
  proveMaterializedArtifactKind,
  mapFileError,
  isEligibleKind,
  findArtifact,
  resolveAllowedSource,
  ingestArtifactSource,
} from './artifact-workspace-source.js';
import { toVersionView, readVersionPreview } from './artifact-workspace-version-view.js';
import { cleanup, reconcileStagingRegistry } from './artifact-workspace-maintenance.js';

export {
  ARTIFACT_WORKSPACE_NOTE_LIMIT,
  ARTIFACT_WORKSPACE_LEASE_GRACE_MS,
  ARTIFACT_WORKSPACE_LEASE_DURATION_MS,
  ARTIFACT_WORKSPACE_LEASE_EXTENSION_MS,
  ARTIFACT_WORKSPACE_LEASE_MAX_TOTAL_EXTENSION_MS,
  ARTIFACT_WORKSPACE_STAGING_RETENTION_MS,
  ARTIFACT_WORKSPACE_SECONDARY_VIEW_RETENTION_MS,
  ARTIFACT_WORKSPACE_RECOVERY_TIMEOUT_MS,
} from './artifact-workspace-constants.js';
export type {
  ArtifactWorkspaceFeatureFlags,
  ArtifactWorkspaceServiceOptions,
  ArtifactWorkspaceClaimResult,
  ArtifactWorkspaceChange,
} from './artifact-workspace-service-types.js';

interface WorkspaceIdentityInput {
  conversationId: string;
  workspaceRootId: string;
}

interface UserMutationInput extends WorkspaceIdentityInput {
  requestSource: ArtifactWorkspaceRequestSource;
}

interface PublicMutationAuditInput {
  conversationId?: unknown;
  workspaceRootId?: unknown;
  nodeId?: unknown;
  placeholderNodeId?: unknown;
  collectionNodeId?: unknown;
  memberNodeId?: unknown;
  versionId?: unknown;
  generationRequestId?: unknown;
  expectedStructureRevision?: unknown;
  expectedViewRevision?: unknown;
  patches?: unknown;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function addMs(timestamp: number, milliseconds: number): string {
  return new Date(timestamp + milliseconds).toISOString();
}

function ensureFiniteGeometry(input: { x?: number; y?: number }): { x: number; y: number } {
  const x = input.x ?? 0;
  const y = input.y ?? 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new ArtifactWorkspaceError('invalid_target', 'node position is invalid');
  }
  return { x, y };
}

type ServiceWriter = { ingress: ReturnType<typeof createLocalSourceWriterLifetime>; recoveryTails: ReturnType<typeof createLocalSourceWriterLifetime>; closing?: Promise<void> };
const serviceWriters = new WeakMap<object, ServiceWriter>();
function serviceWriter(instance: object): ServiceWriter {
  const writer = serviceWriters.get(instance);
  if (!writer) throw Error('artifact_service_source_owner');
  return writer;
}

export class ArtifactWorkspaceService {
  private readonly store: ArtifactWorkspaceStore;
  private readonly snapshotStore: FileTaskSnapshotStore;
  private readonly taskHost: PreparedTaskHost;
  private readonly fileManager: ArtifactWorkspaceFileManager;
  private readonly workspaceRoot: string;
  private readonly allowedRoots: string[];
  private readonly generationRoot: string;
  private readonly flags: ArtifactWorkspaceFeatureFlags;
  private readonly nowFn: () => number;
  private readonly createIdFn: (prefix: string) => string;
  private readonly changeListeners = new Set<(change: ArtifactWorkspaceChange) => void>();

  constructor(options: ArtifactWorkspaceServiceOptions) {
    this.store = options.store;
    this.snapshotStore = options.snapshotStore;
    this.taskHost = options.taskHost;
    this.fileManager = options.fileManager;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.allowedRoots = (options.allowedRoots ?? [options.workspaceRoot]).map((root) => resolve(root));
    this.generationRoot = resolve(options.generationRoot ?? options.workspaceRoot);
    mkdirSync(this.generationRoot, { recursive: true });
    this.flags = {
      artifactWorkspaceRevisionUi: options.featureFlags?.artifactWorkspaceRevisionUi ?? false,
      artifactSpatialWorkspace: options.featureFlags?.artifactSpatialWorkspace ?? false,
    };
    this.nowFn = options.now ?? Date.now;
    this.createIdFn = options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
    serviceWriters.set(this, { ingress: createLocalSourceWriterLifetime('artifact_service_source'), recoveryTails: createLocalSourceWriterLifetime('artifact_service_recovery') });
  }

  /** Local service calls only; TaskHost execution and event queues have their own owners. */
  sealAndDrainInstanceMutations(): Promise<void> {
    const writer = serviceWriter(this);
    if (writer.closing) return writer.closing;
    const ingress = writer.ingress.close();
    writer.closing = (async () => {
      const errors: unknown[] = [];
      try { await ingress; } catch (error) { errors.push(error); }
      try { await writer.recoveryTails.close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'artifact_service_close_unconfirmed');
    })();
    return writer.closing;
  }

  subscribeChanges(listener: (change: ArtifactWorkspaceChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  notifyIdentityChanged(input: WorkspaceIdentityInput): void {
    return serviceWriter(this).ingress.runSync(() => this.#notifyIdentityChanged(input));
  }

  #notifyIdentityChanged(input: WorkspaceIdentityInput): void {
    this.notifyChanged(this.workspace(input));
  }

  async getArtifactWorkspaceSnapshot(input: WorkspaceIdentityInput & { viewKey: string }): Promise<ArtifactWorkspaceSnapshot> {
    return serviceWriter(this).ingress.runAsync(() => this.#getArtifactWorkspaceSnapshot(input));
  }

  async #getArtifactWorkspaceSnapshot(input: WorkspaceIdentityInput & { viewKey: string }): Promise<ArtifactWorkspaceSnapshot> {
    const workspace = this.workspace(input);
    this.recordWorkspaceOpenMetrics(workspace.id, workspace.conversationId, input.viewKey);
    const lineages = this.store.listLineages(workspace.id);
    const versions = lineages.flatMap((lineage) => this.store.listVersions(lineage.id));
    const access: ArtifactWorkspaceFeatureAccess = {
      revision: this.flags.artifactWorkspaceRevisionUi ? 'write' : lineages.length > 0 ? 'read_only' : 'hidden',
      spatial: this.flags.artifactSpatialWorkspace ? 'enabled' : 'hidden',
    };
    return {
      workspace,
      access,
      nodes: this.store.listNodes(workspace.id),
      relations: this.store.listRelations(workspace.id),
      lineages,
      versions: versions.map((version) => toVersionView(this.fileManager, version, lineages)),
      generationRequests: this.store.listGenerationRequests(workspace.id),
      staging: this.store.listStagingFiles().filter((entry) => {
        const request = entry.generationRequestId ? this.store.getGenerationRequest(entry.generationRequestId) : undefined;
        return request?.workspaceId === workspace.id;
      }),
      view: this.store.getView(workspace.id, input.viewKey),
    };
  }

  closeArtifactWorkspace(input: WorkspaceIdentityInput & { viewKey: string }): boolean {
    return serviceWriter(this).ingress.runSync(() => this.#closeArtifactWorkspace(input));
  }

  #closeArtifactWorkspace(input: WorkspaceIdentityInput & { viewKey: string }): boolean {
    const workspace = this.workspace(input);
    return this.store.closeViewSession({ workspaceId: workspace.id, viewKey: input.viewKey });
  }

  closeArtifactWorkspaceViewKey(viewKey: string): number {
    return serviceWriter(this).ingress.runSync(() => this.#closeArtifactWorkspaceViewKey(viewKey));
  }

  #closeArtifactWorkspaceViewKey(viewKey: string): number {
    return this.store.closeViewSessionsByKey(viewKey);
  }

  async recordEligibleArtifactOpened(input: WorkspaceIdentityInput & { sourceTaskId: string; artifactId: string }): Promise<boolean> {
    return serviceWriter(this).ingress.runAsync(() => this.#recordEligibleArtifactOpened(input));
  }

  async #recordEligibleArtifactOpened(input: WorkspaceIdentityInput & { sourceTaskId: string; artifactId: string }): Promise<boolean> {
    if (!this.flags.artifactWorkspaceRevisionUi) return false;
    const workspace = this.workspace(input);
    const snapshot = await this.snapshotStore.recoverTask(input.sourceTaskId);
    const artifact = snapshot ? findArtifact(snapshot, input.artifactId) : undefined;
    if (!artifact?.filePath) return false;
    const kind = normalizeKind(artifact.kind, artifact.mimeType, artifact.filePath);
    if (!isEligibleKind(kind)) return false;
    let identity: ReturnType<typeof resolveAllowedSource>;
    try {
      identity = resolveAllowedSource(this.fileManager, this.allowedRoots, artifact.filePath);
    } catch {
      return false;
    }
    if (!proveMaterializedArtifactKind(kind, { ...artifact, filePath: identity.realPath })) return false;
    return this.store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: 'eligible_artifact_opened',
      dedupeKey: `${workspace.conversationId}:${identity.sourceLocatorHash}`,
      metadata: { kind },
    });
  }

  async materializeArtifact(input: UserMutationInput & {
    sourceTaskId: string;
    artifactId: string;
    expectedStructureRevision: number;
  }): Promise<{ lineage: ArtifactLineage; version: ArtifactWorkspaceVersion; node: ArtifactWorkspaceNode }> {
    return serviceWriter(this).ingress.runAsync(() => this.#materializeArtifact(input));
  }

  async #materializeArtifact(input: UserMutationInput & {
    sourceTaskId: string;
    artifactId: string;
    expectedStructureRevision: number;
  }): Promise<{ lineage: ArtifactLineage; version: ArtifactWorkspaceVersion; node: ArtifactWorkspaceNode }> {
    this.assertUser(input);
    this.assertRevisionWrite();
    const workspace = this.workspace(input);
    const snapshot = await this.snapshotStore.recoverTask(input.sourceTaskId);
    const artifact = snapshot ? findArtifact(snapshot, input.artifactId) : undefined;
    if (!artifact?.filePath) throw new ArtifactWorkspaceError('artifact_not_found', 'task artifact is missing');
    const kind = normalizeKind(artifact.kind, artifact.mimeType, artifact.filePath);
    if (!isEligibleKind(kind)) throw new ArtifactWorkspaceError('artifact_kind_mismatch', 'artifact cannot be revised');
    let identity: ReturnType<typeof resolveAllowedSource>;
    try {
      identity = resolveAllowedSource(this.fileManager, this.allowedRoots, artifact.filePath);
    } catch (error) {
      return mapFileError(error);
    }
    const kindProof = proveMaterializedArtifactKind(kind, { ...artifact, filePath: identity.realPath });
    if (!kindProof) {
      throw new ArtifactWorkspaceError('artifact_kind_mismatch', 'artifact metadata and bytes do not prove its kind');
    }
    const stagingToken = this.createId('materialized');
    let staged;
    try {
      staged = ingestArtifactSource(this.fileManager, this.generationRoot, {
        sourcePath: identity.realPath,
        allowedRoot: identity.allowedRoot,
        stagingId: stagingToken,
        kind,
        mimeType: mimeForPath(identity.realPath, kindProof.mimeType),
      });
    } catch (error) {
      return mapFileError(error);
    }
    const staging = this.store.createStagingFile({
      source: 'materialize',
      sourceLocatorHash: identity.sourceLocatorHash,
      availability: 'present',
      fileRef: staged.stagingRef,
      owner: 'system_staging',
      keep: false,
      expiresAt: addMs(this.now(), ARTIFACT_WORKSPACE_STAGING_RETENTION_MS),
    });
    const existing = this.store.getLineageBySource(workspace.id, identity.sourceLocatorHash);
    if (existing) {
      const versions = this.store.listVersions(existing.id);
      const identical = versions.find((candidate) => candidate.checksum === staged.checksum);
      const node = this.store.listNodes(workspace.id).find((candidate) => candidate.lineageId === existing.id);
      if (!node) throw new ArtifactWorkspaceError('artifact_missing', 'materialized lineage has no workspace node');
      if (identical) {
        this.store.updateStagingFile({ id: staging.id, quarantineReason: 'materialize_loser' });
        this.auditUserMutation(workspace.id, 'materialize_artifact', 'success', {
          nodeId: node.id, versionId: identical.id,
        });
        return { lineage: existing, version: identical, node };
      }
      let finalized: FinalizedWorkspaceArtifact;
      try {
        this.store.reserveStructureRevision(workspace.id, input.expectedStructureRevision);
        finalized = this.fileManager.finalize(staged);
        this.store.updateStagingFile({ id: staging.id, fileRef: finalized.fileRef, quarantineReason: 'commit_recovery' });
        const version = this.store.appendVersion({
          lineageId: existing.id,
          version: {
            fileRef: finalized.fileRef,
            storageKind: finalized.storageKind,
            entryRef: finalized.entryRef,
            packageManifestRef: finalized.packageManifestRef,
            sourceKind: 'materialized_base',
            sourceTaskId: input.sourceTaskId,
            sourceArtifactId: input.artifactId,
            kind,
            mimeType: finalized.mimeType,
            byteSize: finalized.byteSize,
            checksum: finalized.checksum,
            pluginSource: pluginSourceFromCreator(artifact.creator),
          },
        });
        this.store.deleteStagingFile(staging.id);
        this.auditUserMutation(workspace.id, 'materialize_artifact', 'success', {
          nodeId: node.id, versionId: version.id, expectedRevision: input.expectedStructureRevision,
        });
        return { lineage: existing, version, node };
      } catch (error) {
        return mapFileError(error);
      }
    }
    let finalized: FinalizedWorkspaceArtifact;
    try {
      this.store.reserveStructureRevision(workspace.id, input.expectedStructureRevision);
      finalized = this.fileManager.finalize(staged);
      this.store.updateStagingFile({ id: staging.id, fileRef: finalized.fileRef, quarantineReason: 'commit_recovery' });
    } catch (error) {
      return mapFileError(error);
    }
    const created = this.store.createMaterializedLineageWithNode({
      workspaceId: workspace.id,
      sourceLocatorHash: identity.sourceLocatorHash,
      version: {
        fileRef: finalized.fileRef,
        storageKind: finalized.storageKind,
        entryRef: finalized.entryRef,
        packageManifestRef: finalized.packageManifestRef,
        sourceKind: 'materialized_base',
        sourceTaskId: input.sourceTaskId,
        sourceArtifactId: input.artifactId,
        kind,
        mimeType: finalized.mimeType,
        byteSize: finalized.byteSize,
        checksum: finalized.checksum,
        pluginSource: pluginSourceFromCreator(artifact.creator),
      },
      node: {
        kind: 'artifact',
        title: artifact.label,
        owner: 'user',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        zIndex: 0,
      },
    });
    if (!created.created) {
      this.store.updateStagingFile({
        id: staging.id,
        fileRef: finalized.fileRef,
        quarantineReason: 'materialize_loser',
      });
      const existingNode = created.node ?? this.store.listNodes(workspace.id)
        .find((candidate) => candidate.lineageId === created.lineage.id);
      if (existingNode) return { lineage: created.lineage, version: created.version, node: existingNode };
      throw new ArtifactWorkspaceError('artifact_missing', 'materialized lineage has no workspace node');
    }
    const node = created.node;
    if (!node) throw new ArtifactWorkspaceError('artifact_missing', 'materialized node commit failed');
    if (created.created) this.store.deleteStagingFile(staging.id);
    this.auditUserMutation(workspace.id, 'materialize_artifact', 'success', {
      nodeId: node.id, versionId: created.version.id, expectedRevision: input.expectedStructureRevision,
    });
    this.maybeRecordMultiArtifact(workspace.id);
    return { ...created, node };
  }

  async createArtifactPlaceholder(input: UserMutationInput & {
    requestedKind: ArtifactWorkspaceRequestedKind;
    title?: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    return serviceWriter(this).ingress.runAsync(() => this.#createArtifactPlaceholder(input));
  }

  async #createArtifactPlaceholder(input: UserMutationInput & {
    requestedKind: ArtifactWorkspaceRequestedKind;
    title?: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    this.assertUser(input);
    this.assertRevisionWrite();
    const workspace = this.workspace(input);
    const position = ensureFiniteGeometry(input);
    const node = this.store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: input.expectedStructureRevision,
      node: {
        kind: 'placeholder',
        placeholderKind: input.requestedKind,
        title: input.title?.trim() || undefined,
        owner: 'user',
        ...position,
        width: 320,
        height: 180,
        zIndex: 0,
      },
    }).node;
    this.recordWorkspaceEvent(workspace.id, input.conversationId, 'placeholder_created', undefined, node.id, {
      requestedKind: input.requestedKind,
    });
    this.auditUserMutation(workspace.id, 'create_placeholder', 'success', {
      nodeId: node.id, expectedRevision: input.expectedStructureRevision,
    });
    this.maybeRecordMultiArtifact(workspace.id);
    return node;
  }

  async createArtifactWorkspaceCollection(input: UserMutationInput & {
    title: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    return serviceWriter(this).ingress.runAsync(() => this.#createArtifactWorkspaceCollection(input));
  }

  async #createArtifactWorkspaceCollection(input: UserMutationInput & {
    title: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    this.assertUser(input);
    this.assertSpatialWrite();
    const title = input.title.trim();
    if (!title) throw new ArtifactWorkspaceError('invalid_target', 'collection title is required');
    const workspace = this.workspace(input);
    const node = this.store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: input.expectedStructureRevision,
      node: {
        kind: 'collection', title, owner: 'user', ...ensureFiniteGeometry(input),
        width: 360, height: 260, zIndex: 0,
      },
    }).node;
    this.auditUserMutation(workspace.id, 'create_collection', 'success', {
      nodeId: node.id, expectedRevision: input.expectedStructureRevision,
    });
    return node;
  }

  async createArtifactWorkspaceNote(input: UserMutationInput & {
    noteText: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    return serviceWriter(this).ingress.runAsync(() => this.#createArtifactWorkspaceNote(input));
  }

  async #createArtifactWorkspaceNote(input: UserMutationInput & {
    noteText: string;
    x?: number;
    y?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    this.assertUser(input);
    this.assertSpatialWrite();
    this.assertNote(input.noteText);
    const workspace = this.workspace(input);
    const node = this.store.createNode({
      workspaceId: workspace.id,
      expectedStructureRevision: input.expectedStructureRevision,
      node: {
        kind: 'note', noteText: input.noteText, owner: 'user', ...ensureFiniteGeometry(input),
        width: 280, height: 180, zIndex: 0,
      },
    }).node;
    this.auditUserMutation(workspace.id, 'create_note', 'success', {
      nodeId: node.id, expectedRevision: input.expectedStructureRevision,
    });
    return node;
  }

  async updateArtifactWorkspaceNote(input: UserMutationInput & {
    nodeId: string;
    noteText: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    return serviceWriter(this).ingress.runAsync(() => this.#updateArtifactWorkspaceNote(input));
  }

  async #updateArtifactWorkspaceNote(input: UserMutationInput & {
    nodeId: string;
    noteText: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    this.assertUser(input);
    this.assertSpatialWrite();
    this.assertNote(input.noteText);
    const workspace = this.workspace(input);
    const node = this.store.updateNote({
      workspaceId: workspace.id,
      nodeId: input.nodeId,
      noteText: input.noteText,
      expectedStructureRevision: input.expectedStructureRevision,
    });
    this.auditUserMutation(workspace.id, 'update_note', 'success', {
      nodeId: node.id, expectedRevision: input.expectedStructureRevision,
    });
    return node;
  }

  async createArtifactWorkspaceRelation(input: UserMutationInput & {
    fromNodeId: string;
    toNodeId: string;
    kind: ArtifactWorkspaceRelation['kind'];
    order?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceRelation> {
    return serviceWriter(this).ingress.runAsync(() => this.#createArtifactWorkspaceRelation(input));
  }

  async #createArtifactWorkspaceRelation(input: UserMutationInput & {
    fromNodeId: string;
    toNodeId: string;
    kind: ArtifactWorkspaceRelation['kind'];
    order?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceRelation> {
    this.assertUser(input);
    this.assertSpatialWrite();
    const workspace = this.workspace(input);
    const relation = this.store.createRelation({
      workspaceId: workspace.id,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      kind: input.kind,
      order: input.order,
      createdBy: 'user',
      expectedStructureRevision: input.expectedStructureRevision,
    });
    this.recordWorkspaceEvent(workspace.id, workspace.conversationId, 'relation_created', undefined, relation.id, { kind: relation.kind });
    this.auditUserMutation(workspace.id, 'create_relation', 'success', {
      nodeId: relation.fromNodeId, expectedRevision: input.expectedStructureRevision,
    });
    return relation;
  }

  async setArtifactCollectionMembership(input: UserMutationInput & {
    collectionNodeId: string;
    memberNodeId: string;
    included: boolean;
    order?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceRelation | { removed: true }> {
    return serviceWriter(this).ingress.runAsync(() => this.#setArtifactCollectionMembership(input));
  }

  async #setArtifactCollectionMembership(input: UserMutationInput & {
    collectionNodeId: string;
    memberNodeId: string;
    included: boolean;
    order?: number;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceRelation | { removed: true }> {
    this.assertUser(input);
    this.assertSpatialWrite();
    const workspace = this.workspace(input);
    const collection = this.store.getNode(input.collectionNodeId);
    const member = this.store.getNode(input.memberNodeId);
    if (!collection || collection.kind !== 'collection' || !member || collection.workspaceId !== workspace.id || member.workspaceId !== workspace.id) {
      throw new ArtifactWorkspaceError('invalid_target', 'collection membership target is invalid');
    }
    if (input.included) {
      const relation = this.store.createRelation({
        workspaceId: workspace.id,
        fromNodeId: member.id,
        toNodeId: collection.id,
        kind: 'part_of_collection',
        order: input.order,
        createdBy: 'user',
        expectedStructureRevision: input.expectedStructureRevision,
      });
      this.recordWorkspaceEvent(
        workspace.id,
        workspace.conversationId,
        'relation_created',
        undefined,
        relation.id,
        { kind: relation.kind },
      );
      this.auditUserMutation(workspace.id, 'add_collection_member', 'success', {
        nodeId: member.id, expectedRevision: input.expectedStructureRevision,
      });
      return relation;
    }
    this.store.removeRelation({
      workspaceId: workspace.id,
      fromNodeId: member.id,
      toNodeId: collection.id,
      kind: 'part_of_collection',
      expectedStructureRevision: input.expectedStructureRevision,
    });
    this.auditUserMutation(workspace.id, 'remove_collection_member', 'success', {
      nodeId: member.id, expectedRevision: input.expectedStructureRevision,
    });
    return { removed: true };
  }

  async removeArtifactWorkspaceNode(input: UserMutationInput & {
    nodeId: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    return serviceWriter(this).ingress.runAsync(() => this.#removeArtifactWorkspaceNode(input));
  }

  async #removeArtifactWorkspaceNode(input: UserMutationInput & {
    nodeId: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactWorkspaceNode> {
    this.assertUser(input);
    const workspace = this.workspace(input);
    const node = this.store.getNode(input.nodeId);
    if (!this.flags.artifactSpatialWorkspace && !(this.flags.artifactWorkspaceRevisionUi && node?.kind === 'placeholder')) {
      throw new ArtifactWorkspaceError('feature_disabled', 'artifact spatial workspace is disabled');
    }
    const activeRequest = this.store.listGenerationRequests(workspace.id).find((request) => (
      request.placeholderNodeId === input.nodeId
      && ['prepared', 'running', 'needs_recovery'].includes(request.state)
    ));
    if (activeRequest) {
      this.auditUserMutation(workspace.id, 'remove_node', 'denied', {
        nodeId: input.nodeId,
        expectedRevision: input.expectedStructureRevision,
        errorCode: 'generation_conflict',
      });
      throw new ArtifactWorkspaceError(
        'generation_conflict',
        'cancel the active generation before removing its placeholder',
      );
    }
    const removed = this.store.tombstoneNode({
      workspaceId: workspace.id,
      nodeId: input.nodeId,
      expectedStructureRevision: input.expectedStructureRevision,
    });
    this.auditUserMutation(workspace.id, 'remove_node', 'success', {
      nodeId: removed.id, expectedRevision: input.expectedStructureRevision,
    });
    return removed;
  }

  async updateArtifactWorkspaceLayout(input: UserMutationInput & { patches: ArtifactWorkspaceLayoutPatch[] }): Promise<ArtifactWorkspaceNode[]> {
    return serviceWriter(this).ingress.runAsync(() => this.#updateArtifactWorkspaceLayout(input));
  }

  async #updateArtifactWorkspaceLayout(input: UserMutationInput & { patches: ArtifactWorkspaceLayoutPatch[] }): Promise<ArtifactWorkspaceNode[]> {
    this.assertUser(input);
    this.assertSpatialWrite();
    const workspace = this.workspace(input);
    const nodes = this.store.updateLayout({ workspaceId: workspace.id, patches: input.patches });
    for (const patch of input.patches) {
      const node = nodes.find(candidate => candidate.id === patch.nodeId);
      this.auditUserMutation(workspace.id, 'update_layout', 'success', {
        nodeId: patch.nodeId,
        expectedRevision: patch.expectedLayoutRevision,
        actualRevision: node?.layoutRevision,
      });
      if (this.flags.artifactSpatialWorkspace && node) {
        this.recordWorkspaceEvent(
          workspace.id,
          workspace.conversationId,
          'spatial_node_repositioned',
          undefined,
          `${node.id}:${node.layoutRevision}`,
          { nodeId: node.id },
        );
      }
    }
    return nodes;
  }

  async saveArtifactWorkspaceViewport(input: UserMutationInput & {
    viewKey: string;
    viewport: ArtifactWorkspaceView['viewport'];
    expectedViewRevision?: number;
  }): Promise<ArtifactWorkspaceView> {
    return serviceWriter(this).ingress.runAsync(() => this.#saveArtifactWorkspaceViewport(input));
  }

  async #saveArtifactWorkspaceViewport(input: UserMutationInput & {
    viewKey: string;
    viewport: ArtifactWorkspaceView['viewport'];
    expectedViewRevision?: number;
  }): Promise<ArtifactWorkspaceView> {
    this.assertUser(input);
    this.assertSpatialWrite();
    const workspace = this.workspace(input);
    const current = this.store.getView(workspace.id, input.viewKey);
    if (input.expectedViewRevision !== undefined && (current?.viewRevision ?? 0) !== input.expectedViewRevision) {
      throw new ArtifactWorkspaceError('layout_revision_conflict', 'view revision conflict', current);
    }
    const view = this.store.saveView({ workspaceId: workspace.id, viewKey: input.viewKey, viewport: input.viewport });
    this.auditUserMutation(workspace.id, 'save_viewport', 'success', {
      expectedRevision: input.expectedViewRevision, actualRevision: view.viewRevision,
    });
    return view;
  }

  async preferArtifactVersion(input: UserMutationInput & {
    lineageId: string;
    versionId: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactLineage> {
    return serviceWriter(this).ingress.runAsync(() => this.#preferArtifactVersion(input));
  }

  async #preferArtifactVersion(input: UserMutationInput & {
    lineageId: string;
    versionId: string;
    expectedStructureRevision: number;
  }): Promise<ArtifactLineage> {
    this.assertUser(input);
    this.assertRevisionWrite();
    const workspace = this.workspace(input);
    const lineage = this.store.setPreferredVersion({
      workspaceId: workspace.id,
      lineageId: input.lineageId,
      versionId: input.versionId,
      expectedStructureRevision: input.expectedStructureRevision,
    });
    this.recordWorkspaceEvent(workspace.id, input.conversationId, 'revision_preferred', undefined, input.versionId, {});
    this.auditUserMutation(workspace.id, 'prefer_version', 'success', {
      versionId: input.versionId, expectedRevision: input.expectedStructureRevision,
    });
    return lineage;
  }

  async submitArtifactGeneration(input: UserMutationInput & {
    placeholderNodeId?: string;
    prompt: string;
    sourceVersionId?: string;
    supersedesRequestId?: string;
    selectedArtifact?: { sourceTaskId?: string; artifactId: string; kind?: string; mimeType?: string; title?: string };
    requestedKind?: ArtifactWorkspaceRequestedKind;
    expectedStructureRevision?: number;
    preparedGenerationRequestId?: string;
  }): Promise<WorkspaceGenerationRequest> {
    return serviceWriter(this).ingress.runAsync(() => this.#submitArtifactGeneration(input));
  }

  async #submitArtifactGeneration(input: UserMutationInput & {
    placeholderNodeId?: string;
    prompt: string;
    sourceVersionId?: string;
    supersedesRequestId?: string;
    selectedArtifact?: { sourceTaskId?: string; artifactId: string; kind?: string; mimeType?: string; title?: string };
    requestedKind?: ArtifactWorkspaceRequestedKind;
    expectedStructureRevision?: number;
    preparedGenerationRequestId?: string;
  }): Promise<WorkspaceGenerationRequest> {
    this.assertUser(input);
    this.assertRevisionWrite();
    const prompt = input.prompt.trim();
    if (!prompt) throw new ArtifactWorkspaceError('invalid_target', 'generation prompt is required');
    const workspace = this.workspace(input);
    let placeholderNodeId = input.placeholderNodeId;
    let sourceVersionId = input.sourceVersionId;
    if (!placeholderNodeId) {
      const selected = input.selectedArtifact;
      let baseVersion: ArtifactWorkspaceVersion;
      let baseNode: ArtifactWorkspaceNode | undefined;
      if (sourceVersionId) {
        baseVersion = this.requireOwnedVersion(workspace.id, sourceVersionId);
        baseNode = this.store.listNodes(workspace.id).find((candidate) => (
          candidate.artifactVersionId === baseVersion.id || candidate.lineageId === baseVersion.lineageId
        ));
      } else {
        if (!selected?.sourceTaskId || !selected.artifactId) {
          throw new ArtifactWorkspaceError('invalid_target', 'generation needs a placeholder, source version or selected artifact');
        }
        const base = await this.#materializeArtifact({
          conversationId: input.conversationId,
          workspaceRootId: input.workspaceRootId,
          sourceTaskId: selected.sourceTaskId,
          artifactId: selected.artifactId,
          expectedStructureRevision: input.expectedStructureRevision ?? workspace.structureRevision,
          requestSource: 'user',
        });
        baseVersion = base.version;
        baseNode = base.node;
        sourceVersionId = base.version.id;
      }
      const requestedKind = input.requestedKind
        ?? normalizeKind(selected?.kind ?? baseVersion.kind, selected?.mimeType ?? baseVersion.mimeType, baseVersion.kind);
      if (!isEligibleKind(requestedKind)) {
        throw new ArtifactWorkspaceError('artifact_kind_mismatch', 'selected artifact cannot be revised');
      }
      const duplicate = this.store.listGenerationRequests(workspace.id).find((candidate) => (
        candidate.sourceVersionId === baseVersion.id
        && ['prepared', 'running', 'needs_recovery'].includes(candidate.state)
      ));
      if (duplicate) throw new ArtifactWorkspaceError('generation_conflict', 'this source already has an active revision request');
      const latestWorkspace = this.store.getWorkspace(workspace.id) ?? workspace;
      const placeholder = await this.#createArtifactPlaceholder({
        conversationId: input.conversationId,
        workspaceRootId: input.workspaceRootId,
        requestedKind,
        title: selected?.title ? `${selected.title} revision` : undefined,
        x: baseNode ? baseNode.x + baseNode.width + 48 : 0,
        y: baseNode?.y ?? 0,
        expectedStructureRevision: latestWorkspace.structureRevision,
        requestSource: 'user',
      });
      placeholderNodeId = placeholder.id;
      sourceVersionId = baseVersion.id;
    }
    const node = this.store.getNode(placeholderNodeId);
    if (!node || node.workspaceId !== workspace.id || node.kind !== 'placeholder' || !node.placeholderKind) {
      throw new ArtifactWorkspaceError('invalid_target', 'generation target is not a placeholder');
    }
    const sourceVersion = sourceVersionId ? this.requireOwnedVersion(workspace.id, sourceVersionId) : undefined;
    if (sourceVersion && sourceVersion.kind !== node.placeholderKind) {
      throw new ArtifactWorkspaceError('artifact_kind_mismatch', 'revision target kind differs from its source version');
    }
    const preparedRequest = input.preparedGenerationRequestId
      ? this.store.getGenerationRequest(input.preparedGenerationRequestId)
      : undefined;
    if (input.preparedGenerationRequestId && (
      !preparedRequest
      || preparedRequest.state !== 'prepared'
      || preparedRequest.workspaceId !== workspace.id
      || preparedRequest.placeholderNodeId !== node.id
      || preparedRequest.sourceVersionId !== sourceVersionId
    )) {
      throw new ArtifactWorkspaceError('generation_conflict', 'prepared generation request no longer owns the target');
    }
    const request = preparedRequest ?? this.store.createGenerationRequest({
      workspaceId: workspace.id,
      placeholderNodeId: node.id,
      sourceVersionId,
      supersedesRequestId: input.supersedesRequestId,
    });
    const allowedAction = sourceVersionId
      ? 'append_revision'
      : this.store.listRelations(workspace.id).some(relation => (
          relation.fromNodeId === node.id && relation.kind === 'part_of_collection'
        ))
        ? 'append_collection_item'
        : 'fulfill_placeholder';
    const leaseId = this.createId('lease');
    mkdirSync(this.generationTaskRoot(leaseId), { recursive: true });
    let sourceCopyPath: string | undefined;
    if (sourceVersion) {
      try {
        sourceCopyPath = copyVersionForGeneration(this.fileManager, sourceVersion, this.generationTaskRoot(leaseId));
      } catch (error) {
        this.store.updateGenerationState(request.id, 'failed', 'artifact_missing');
        throw new ArtifactWorkspaceError('artifact_missing', error instanceof Error ? error.message : 'revision source is missing');
      }
    }
    const target: ArtifactGenerationTarget = {
      workspaceId: workspace.id,
      nodeId: node.id,
      placeholderId: node.id,
      sourceArtifactVersionId: sourceVersionId,
      generationRequestId: request.id,
      leaseId,
      expectedStructureRevision: (this.store.getWorkspace(workspace.id) ?? workspace).structureRevision,
      requestedKind: node.placeholderKind,
      width: node.width,
      height: node.height,
      referenceVersionIds: sourceVersionId ? [sourceVersionId] : [],
    };
    const executionScope: ArtifactWorkspaceExecutionScope = {
      kind: 'artifact_workspace_generation',
      generationRequestId: request.id,
      leaseId,
      target,
    };
    let prepared: Awaited<ReturnType<PreparedTaskHost['prepareTask']>>;
    try {
      prepared = await this.taskHost.prepareTask({
        prompt: buildGenerationPrompt(prompt, node.placeholderKind, leaseId, this.generationTaskRoot(leaseId), allowedAction, sourceCopyPath, target),
        materials: [],
        executionScope,
        watchdogMs: ARTIFACT_WORKSPACE_LEASE_DURATION_MS - ARTIFACT_WORKSPACE_LEASE_GRACE_MS,
      });
    } catch (error) {
      this.store.updateGenerationState(request.id, 'failed', 'runtime_unavailable');
      throw new ArtifactWorkspaceError('runtime_unavailable', error instanceof Error ? error.message : 'task preparation failed');
    }
    try {
      this.store.bindGenerationLease({
        leaseId,
        generationRequestId: request.id,
        workspaceId: workspace.id,
        nodeId: node.id,
        sourceVersionId,
        allowedAction,
        requestedKind: node.placeholderKind,
        producingTaskId: prepared.taskId,
        expiresAt: addMs(this.now(), ARTIFACT_WORKSPACE_LEASE_DURATION_MS),
      });
    } catch (error) {
      await this.taskHost.cancelTask(prepared.taskId, 'artifact_workspace_bind_failed').catch(() => undefined);
      this.store.updateGenerationState(request.id, 'needs_recovery', 'runtime_unavailable');
      throw error;
    }
    try {
      await this.taskHost.startTask(prepared.taskId);
    } catch (error) {
      const lease = this.store.getLease(leaseId);
      if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(leaseId);
      this.store.updateGenerationState(request.id, 'failed', 'runtime_unavailable');
      await this.taskHost.cancelTask(prepared.taskId, 'artifact_workspace_start_failed').catch(() => undefined);
      throw new ArtifactWorkspaceError('runtime_unavailable', error instanceof Error ? error.message : 'task start failed');
    }
    this.recordWorkspaceEvent(workspace.id, input.conversationId, 'generation_submitted', request.id, request.id, {
      requestedKind: node.placeholderKind,
    });
    if (sourceVersionId) {
      this.recordWorkspaceEvent(workspace.id, input.conversationId, 'revision_requested', request.id, request.id, {
        requestedKind: node.placeholderKind,
      });
      this.recordWorkspaceEvent(workspace.id, input.conversationId, 'revision_branched', request.id, sourceVersionId, {
        versionId: sourceVersionId,
      });
    }
    this.auditUserMutation(workspace.id, 'submit_generation', 'success', {
      nodeId: node.id, producingTaskId: prepared.taskId,
    });
    return this.store.getGenerationRequest(request.id) ?? request;
  }

  async cancelArtifactGeneration(input: {
    generationRequestId: string;
    requestSource: ArtifactWorkspaceRequestSource;
    conversationId: string;
    workspaceRootId: string;
  }): Promise<WorkspaceGenerationRequest> {
    return serviceWriter(this).ingress.runAsync(() => this.#cancelArtifactGeneration(input));
  }

  async #cancelArtifactGeneration(input: {
    generationRequestId: string;
    requestSource: ArtifactWorkspaceRequestSource;
    conversationId: string;
    workspaceRootId: string;
  }): Promise<WorkspaceGenerationRequest> {
    this.assertUser(input);
    const request = this.store.getGenerationRequest(input.generationRequestId);
    const workspace = this.workspace({ conversationId: input.conversationId, workspaceRootId: input.workspaceRootId });
    if (request?.workspaceId !== workspace.id) throw new ArtifactWorkspaceError('permission_denied', 'generation is outside this workspace');
    if (!request || !['prepared', 'running', 'needs_recovery'].includes(request.state)) {
      throw new ArtifactWorkspaceError('invalid_target', 'generation cannot be cancelled');
    }
    const lease = this.store.getLeaseByRequest(request.id);
    if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
    const cancelled = this.store.updateGenerationState(request.id, 'cancelled');
    if (request.producingTaskId) await this.taskHost.cancelTask(request.producingTaskId, 'artifact_workspace_user_cancelled').catch(() => undefined);
    this.recordWorkspaceEvent(workspace.id, workspace.conversationId, 'generation_cancelled', request.id, request.id, {});
    this.auditUserMutation(workspace.id, 'cancel_generation', 'success', {
      nodeId: request.placeholderNodeId, producingTaskId: request.producingTaskId,
    });
    return cancelled;
  }

  async retryArtifactGeneration(input: UserMutationInput & {
    generationRequestId: string;
    prompt?: string;
  }): Promise<WorkspaceGenerationRequest> {
    return serviceWriter(this).ingress.runAsync(() => this.#retryArtifactGeneration(input));
  }

  async #retryArtifactGeneration(input: UserMutationInput & {
    generationRequestId: string;
    prompt?: string;
  }): Promise<WorkspaceGenerationRequest> {
    this.assertUser(input);
    const old = this.store.getGenerationRequest(input.generationRequestId);
    const workspace = this.workspace(input);
    if (!old || old.workspaceId !== workspace.id || !['failed', 'cancelled', 'needs_recovery'].includes(old.state)) {
      throw new ArtifactWorkspaceError('generation_conflict', 'generation cannot be retried');
    }
    const prepared = this.store.beginGenerationRetry({ oldRequestId: old.id, workspaceId: workspace.id });
    const request = await this.#submitArtifactGeneration({
      ...input,
      prompt: input.prompt?.trim() || '请重试上一次产物生成任务，保持原目标不变。',
      placeholderNodeId: old.placeholderNodeId,
      sourceVersionId: old.sourceVersionId,
      supersedesRequestId: old.id,
      preparedGenerationRequestId: prepared.id,
    });
    this.recordWorkspaceEvent(workspace.id, workspace.conversationId, 'generation_retried', request.id, request.id, {});
    this.auditUserMutation(workspace.id, 'retry_generation', 'success', {
      nodeId: request.placeholderNodeId, producingTaskId: request.producingTaskId,
    });
    return request;
  }

  async claimProducedArtifact(input: {
    leaseId: string;
    producedArtifactId: string;
    taskId: string;
    executionScope?: ArtifactWorkspaceExecutionScope;
    expectedAction?: 'fulfill_placeholder' | 'append_revision' | 'append_collection_item';
    projectionKind: 'narrow_tool' | 'task_event' | 'startup_reconcile';
  }): Promise<ArtifactWorkspaceClaimResult> {
    return serviceWriter(this).ingress.runAsync(() => this.#claimProducedArtifact(input));
  }

  async #claimProducedArtifact(input: {
    leaseId: string;
    producedArtifactId: string;
    taskId: string;
    executionScope?: ArtifactWorkspaceExecutionScope;
    expectedAction?: 'fulfill_placeholder' | 'append_revision' | 'append_collection_item';
    projectionKind: 'narrow_tool' | 'task_event' | 'startup_reconcile';
  }): Promise<ArtifactWorkspaceClaimResult> {
    const scope = input.executionScope;
    if (!scope || scope.kind !== 'artifact_workspace_generation' || scope.leaseId !== input.leaseId) {
      const deniedLease = this.store.getLease(input.leaseId);
      this.store.recordAudit({
        actorKind: 'agent', requestSource: 'agent', workspaceId: deniedLease?.workspaceId,
        nodeId: deniedLease?.nodeId, producingTaskId: input.taskId,
        action: input.expectedAction ?? 'claim_artifact', result: 'denied', errorCode: 'permission_denied',
      });
      throw new ArtifactWorkspaceError('permission_denied', 'artifact workspace execution scope is missing');
    }
    const lease = this.store.getLease(input.leaseId);
    const request = this.store.getGenerationRequest(scope.generationRequestId);
    if (!lease || !request || lease.generationRequestId !== request.id || lease.producingTaskId !== input.taskId) {
      this.store.recordAudit({
        actorKind: 'agent', requestSource: 'agent', workspaceId: lease?.workspaceId,
        nodeId: lease?.nodeId, producingTaskId: input.taskId,
        action: input.expectedAction ?? 'claim_artifact', result: 'denied', errorCode: 'permission_denied',
      });
      throw new ArtifactWorkspaceError('permission_denied', 'task does not own this generation lease');
    }
    if (input.expectedAction && lease.allowedAction !== input.expectedAction) {
      this.store.recordAudit({
        actorKind: 'agent', requestSource: 'agent', workspaceId: lease.workspaceId,
        nodeId: lease.nodeId, producingTaskId: input.taskId,
        action: input.expectedAction, result: 'denied', errorCode: 'permission_denied',
      });
      throw new ArtifactWorkspaceError('permission_denied', 'tool action does not match this generation lease');
    }
    const existing = this.store.getArtifactClaim(request.id, input.producedArtifactId);
    if (existing) {
      this.store.recordProjectionReceipt({
        generationRequestId: request.id,
        producedArtifactId: input.producedArtifactId,
        projectionKind: input.projectionKind,
      });
      const staging = existing.outcomeKind === 'staging' ? this.store.getStagingFile(existing.outcomeId) : undefined;
      return {
        outcomeKind: existing.outcomeKind,
        versionId: existing.outcomeKind === 'ready_version' ? existing.outcomeId : undefined,
        stagingId: staging?.id,
        quarantineReason: staging?.quarantineReason,
      };
    }
    const snapshot = await this.snapshotStore.recoverTask(input.taskId);
    const artifact = snapshot ? findArtifact(snapshot, input.producedArtifactId) : undefined;
    if (
      !snapshot
      || !artifact?.filePath
      || snapshot.executionScope?.kind !== 'artifact_workspace_generation'
      || snapshot.executionScope.leaseId !== lease.id
    ) {
      throw new ArtifactWorkspaceError('invalid_target', 'artifact is not recorded by the bound task');
    }
    const kind = normalizeKind(artifact.kind, artifact.mimeType, artifact.filePath);
    let quarantineReason: ArtifactWorkspaceQuarantineReason | undefined;
    if (lease.cancelledAt || request.state === 'cancelled') quarantineReason = 'cancelled_late_result';
    else if (lease.consumedAt || request.state !== 'running') quarantineReason = 'target_conflict';
    else if (this.now() >= Date.parse(lease.expiresAt)) quarantineReason = 'expired_lease';
    else if (
      kind !== lease.requestedKind
      || !artifactMatchesRequestedKind(lease.requestedKind, artifact)
      || !artifactContentMatchesKind(lease.requestedKind, artifact.filePath, artifact.mimeType)
    ) quarantineReason = 'kind_mismatch';

    const stagingToken = this.createId('generated');
    let staged;
    try {
      staged = ingestArtifactSource(this.fileManager, this.generationRoot, {
        sourcePath: artifact.filePath,
        allowedRoot: this.generationTaskRoot(lease.id),
        stagingId: stagingToken,
        kind,
        mimeType: mimeForPath(artifact.filePath, artifact.mimeType),
      });
    } catch (error) {
      const outcome = this.store.commitQuarantineArtifact({
        generationRequestId: request.id,
        producedArtifactId: input.producedArtifactId,
        projectionKind: input.projectionKind,
        staging: {
          source: 'generation', producingTaskId: input.taskId, availability: 'unavailable',
          owner: 'system_staging', quarantineReason: 'invalid_artifact_ref', keep: false,
          expiresAt: addMs(this.now(), ARTIFACT_WORKSPACE_STAGING_RETENTION_MS),
        },
      });
      this.store.recordAudit({
        actorKind: 'agent', requestSource: 'agent', workspaceId: lease.workspaceId,
        nodeId: lease.nodeId, producingTaskId: input.taskId, action: lease.allowedAction,
        result: 'quarantined', errorCode: 'invalid_artifact_ref',
      });
      if (error instanceof ArtifactWorkspaceFileError) {
        const canonical = outcome.outcomeKind === 'staging' ? this.store.getStagingFile(outcome.outcomeId) : undefined;
        return outcome.outcomeKind === 'ready_version'
          ? { outcomeKind: 'ready_version', versionId: outcome.outcomeId }
          : { outcomeKind: 'staging', stagingId: outcome.outcomeId, quarantineReason: canonical?.quarantineReason };
      }
      throw error;
    }
    if (quarantineReason) {
      const outcome = this.store.commitQuarantineArtifact({
        generationRequestId: request.id,
        producedArtifactId: input.producedArtifactId,
        projectionKind: input.projectionKind,
        staging: {
          source: 'generation', producingTaskId: input.taskId, availability: 'present', fileRef: staged.stagingRef,
          owner: 'system_staging', quarantineReason, keep: false,
          expiresAt: addMs(this.now(), ARTIFACT_WORKSPACE_STAGING_RETENTION_MS),
        },
      });
      if (!outcome.created) {
        this.fileManager.removeManagedRef(staged.stagingRef);
      }
      this.store.recordAudit({
        actorKind: 'agent', requestSource: 'agent', workspaceId: lease.workspaceId,
        nodeId: lease.nodeId, producingTaskId: input.taskId, action: lease.allowedAction,
        result: 'quarantined', errorCode: quarantineReason,
      });
      if (outcome.outcomeKind === 'ready_version') return { outcomeKind: 'ready_version', versionId: outcome.outcomeId };
      const canonical = this.store.getStagingFile(outcome.outcomeId);
      return { outcomeKind: 'staging', stagingId: outcome.outcomeId, quarantineReason: canonical?.quarantineReason };
    }
    const staging = this.store.createStagingFile({
      source: 'generation', generationRequestId: request.id, producingTaskId: input.taskId,
      producedArtifactId: input.producedArtifactId, availability: 'present', fileRef: staged.stagingRef,
      owner: 'system_staging', keep: false,
      expiresAt: addMs(this.now(), ARTIFACT_WORKSPACE_STAGING_RETENTION_MS),
    });
    let finalized: FinalizedWorkspaceArtifact;
    try {
      finalized = this.fileManager.finalize(staged);
    } catch (error) {
      if (this.store.getGenerationRequest(request.id)?.state === 'running') {
        this.store.updateGenerationState(request.id, 'needs_recovery', 'artifact_missing');
      }
      throw error;
    }
    let committed;
    try {
      committed = this.store.commitGenerationArtifact({
        generationRequestId: request.id,
        leaseId: lease.id,
        producedArtifactId: input.producedArtifactId,
        projectionKind: input.projectionKind,
        sourceLocatorHash: sha256(`generation:${request.id}:${input.producedArtifactId}`),
        stagingId: staging.id,
        version: {
          fileRef: finalized.fileRef,
          storageKind: finalized.storageKind,
          entryRef: finalized.entryRef,
          packageManifestRef: finalized.packageManifestRef,
          sourceKind: 'workspace_generation',
          sourceArtifactId: input.producedArtifactId,
          kind,
          mimeType: finalized.mimeType,
          byteSize: finalized.byteSize,
          checksum: finalized.checksum,
          producingTaskId: input.taskId,
          runtimeSource: 'desktop-agent-runtime',
          pluginSource: pluginSourceFromCreator(artifact.creator),
        },
      });
      if (committed.version.fileRef !== finalized.fileRef) {
        this.fileManager.removeManagedRef(finalized.fileRef);
      }
    } catch (error) {
      this.store.updateStagingFile({
        id: staging.id,
        fileRef: finalized.fileRef,
        availability: 'present',
        quarantineReason: 'commit_recovery',
      });
      if (this.store.getGenerationRequest(request.id)?.state === 'running') {
        this.store.updateGenerationState(request.id, 'needs_recovery', 'artifact_missing');
      }
      throw error;
    }
    const workspace = this.store.getWorkspace(request.workspaceId);
    if (workspace) {
      if (request.sourceVersionId) {
        this.recordWorkspaceEvent(workspace.id, workspace.conversationId, 'revision_ready', request.id, request.id, { kind });
      }
      this.maybeRecordMultiArtifact(workspace.id);
      this.notifyChanged(workspace);
    }
    this.store.recordAudit({
      actorKind: 'agent', requestSource: 'agent', workspaceId: lease.workspaceId,
      nodeId: lease.nodeId, versionId: committed.version.id, producingTaskId: input.taskId,
      pluginSource: pluginSourceFromCreator(artifact.creator),
      action: lease.allowedAction, result: 'success',
    });
    return { outcomeKind: 'ready_version', versionId: committed.version.id };
  }

  async handlePersistedTaskEvent(input: {
    taskId: string;
    eventIndex: number;
    event: DesktopTaskEvent;
    snapshot: TaskSnapshot;
  }): Promise<void> {
    return serviceWriter(this).ingress.runAsync(() => this.#handlePersistedTaskEvent(input));
  }

  async #handlePersistedTaskEvent(input: {
    taskId: string;
    eventIndex: number;
    event: DesktopTaskEvent;
    snapshot: TaskSnapshot;
  }): Promise<void> {
    const scope = input.snapshot.executionScope;
    if (!scope || scope.kind !== 'artifact_workspace_generation') return;
    const cursor = this.store.getTaskCursor(input.taskId);
    if (input.eventIndex <= cursor) return;
    maybeExtendLease(this.store, () => this.now(), scope, input.snapshot);
    const terminal = ['completed', 'failed', 'cancelled'].includes(input.snapshot.status);
    const firstDeferredArtifactIndex = input.snapshot.events.findIndex((event, index) => (
      index > cursor && event.type === 'artifact_recorded'
    ));
    if (!terminal && firstDeferredArtifactIndex >= 0 && input.eventIndex >= firstDeferredArtifactIndex) return;
    if (terminal && (input.snapshot.status === 'failed' || input.snapshot.status === 'cancelled')) {
      const request = this.store.getGenerationRequest(scope.generationRequestId);
      const lease = this.store.getLease(scope.leaseId);
      if (request?.state === 'running') {
        if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
        this.store.updateGenerationState(request.id, input.snapshot.status, input.snapshot.status === 'failed' ? 'runtime_unavailable' : undefined);
      }
    }
    const firstEventIndex = terminal ? cursor + 1 : input.eventIndex;
    for (let eventIndex = firstEventIndex; eventIndex <= input.eventIndex; eventIndex++) {
      const event = input.snapshot.events[eventIndex] ?? input.event;
      if (event.type === 'artifact_recorded') {
        await this.#claimProducedArtifact({
          leaseId: scope.leaseId,
          producedArtifactId: event.artifactId,
          taskId: input.taskId,
          executionScope: scope,
          projectionKind: 'task_event',
        });
      } else if (event.type === 'error') {
        const request = this.store.getGenerationRequest(scope.generationRequestId);
        const lease = this.store.getLease(scope.leaseId);
        if (request && request.state === 'running') {
          const errorCode = snapshotReportsPluginUnavailable(input.snapshot) ? 'plugin_unavailable' : 'runtime_unavailable';
          if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
          this.store.updateGenerationState(request.id, 'failed', errorCode);
          const workspace = this.store.getWorkspace(request.workspaceId);
          if (workspace) {
            this.recordWorkspaceEvent(workspace.id, workspace.conversationId, 'revision_failed', request.id, request.id, {
              errorCode,
            });
            this.notifyChanged(workspace);
          }
          this.store.recordAudit({
            actorKind: 'agent', requestSource: 'agent', workspaceId: request.workspaceId,
            nodeId: request.placeholderNodeId, producingTaskId: input.taskId,
            action: 'generation_task_failed', result: 'failed', errorCode,
          });
        }
      } else if (event.type === 'task_cancelled') {
        const request = this.store.getGenerationRequest(scope.generationRequestId);
        const lease = this.store.getLease(scope.leaseId);
        if (request && request.state === 'running') {
          if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
          this.store.updateGenerationState(request.id, 'cancelled');
          this.store.recordAudit({
            actorKind: 'agent', requestSource: 'agent', workspaceId: request.workspaceId,
            nodeId: request.placeholderNodeId, producingTaskId: input.taskId,
            action: 'generation_task_cancelled', result: 'success',
          });
          const workspace = this.store.getWorkspace(request.workspaceId);
          if (workspace) this.notifyChanged(workspace);
        }
      }
      this.store.saveTaskCursor(input.taskId, eventIndex);
    }
    if (input.snapshot.status === 'completed' && !input.snapshot.events.some(event => event.type === 'artifact_recorded')) {
      const request = this.store.getGenerationRequest(scope.generationRequestId);
      const lease = this.store.getLease(scope.leaseId);
      if (request && request.state === 'running') {
        const errorCode = snapshotReportsPluginUnavailable(input.snapshot) ? 'plugin_unavailable' : 'artifact_missing';
        if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
        this.store.updateGenerationState(request.id, 'failed', errorCode);
        this.store.recordAudit({
          actorKind: 'agent', requestSource: 'agent', workspaceId: request.workspaceId,
          nodeId: request.placeholderNodeId, producingTaskId: input.taskId,
          action: 'generation_task_completed', result: 'failed', errorCode,
        });
        const workspace = this.store.getWorkspace(request.workspaceId);
        if (workspace) this.notifyChanged(workspace);
      }
    }
  }

  async reconcileStartup(): Promise<void> {
    return serviceWriter(this).ingress.runAsync(() => this.#reconcileStartup());
  }

  async #reconcileStartup(): Promise<void> {
    try {
      reconcileStagingRegistry(this.store, this.fileManager);
    } catch (error) {
      console.warn('[artifact-workspace] staging reconciliation failed:', error instanceof Error ? error.message : String(error));
    }
    for (const workspace of this.store.listWorkspaces()) {
      const workspaceId = workspace.id;
      for (const request of this.store.listGenerationRequests(workspaceId)) {
        if (['ready', 'failed', 'cancelled', 'superseded'].includes(request.state)) continue;
        const attemptKey = `${request.id}:${this.now()}`;
        try {
          this.recordWorkspaceEvent(
            workspace.id,
            workspace.conversationId,
            'recovery_attempted',
            request.id,
            `${attemptKey}:attempt`,
            { actorKind: 'system_reconcile', state: request.state },
          );
          await this.reconcileGenerationRequest(workspace, request, attemptKey);
        } catch (error) {
          try {
            this.recordRecoveryFailure(
              workspace,
              request,
              attemptKey,
              'runtime_unavailable',
              error instanceof ArtifactWorkspaceRecoveryTimeout ? 'timeout' : 'exception',
            );
          } catch (recordError) {
            console.warn(
              '[artifact-workspace] request reconciliation failed:',
              request.id,
              recordError instanceof Error ? recordError.message : String(recordError),
            );
          }
        }
      }
    }
  }

  private async reconcileGenerationRequest(
    workspace: { id: string; conversationId: string },
    request: WorkspaceGenerationRequest,
    attemptKey: string,
  ): Promise<void> {
    if (request.state === 'prepared' || !request.producingTaskId) {
      this.recordRecoveryFailure(workspace, request, attemptKey, 'runtime_unavailable', 'task_unbound');
      return;
    }
    const snapshot = await withRecoveryTimeout(serviceWriter(this).recoveryTails.runAsync(() => this.snapshotStore.recoverTask(request.producingTaskId!)));
    if (!snapshot) {
      this.recordRecoveryFailure(workspace, request, attemptKey, 'runtime_unavailable', 'snapshot_missing');
      return;
    }
    const beforeReplay = this.store.getGenerationRequest(request.id);
    if (snapshot.status === 'cancelled' && beforeReplay?.state === 'running') {
      const lease = this.store.getLeaseByRequest(request.id);
      if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
      this.store.updateGenerationState(request.id, 'cancelled');
    } else if (snapshot.status === 'failed' && beforeReplay?.state === 'running') {
      const lease = this.store.getLeaseByRequest(request.id);
      if (lease && !lease.cancelledAt && !lease.consumedAt) this.store.cancelLease(lease.id);
      this.store.updateGenerationState(request.id, 'failed', 'runtime_unavailable');
    }
    const cursor = this.store.getTaskCursor(request.producingTaskId);
    for (let index = cursor + 1; index < snapshot.events.length; index++) {
      await this.#handlePersistedTaskEvent({ taskId: request.producingTaskId, eventIndex: index, event: snapshot.events[index], snapshot });
    }
    const current = this.store.getGenerationRequest(request.id);
    if (snapshot.status === 'completed' && current?.state === 'running') {
      this.store.updateGenerationState(
        request.id,
        'failed',
        snapshotReportsPluginUnavailable(snapshot) ? 'plugin_unavailable' : 'artifact_missing',
      );
    } else if (snapshot.status === 'completed' && current?.state === 'needs_recovery') {
      this.store.updateGenerationState(request.id, 'failed', 'generation_conflict');
    } else if (snapshot.status === 'cancelled' && current?.state === 'running') {
      this.store.updateGenerationState(request.id, 'cancelled');
    } else if (snapshot.status === 'failed' && current?.state === 'running') {
      this.store.updateGenerationState(request.id, 'failed', 'runtime_unavailable');
    } else if (current?.state === 'running') {
      // In-process tasks are not automatically resumed after a main-process restart.
      this.store.updateGenerationState(request.id, 'needs_recovery', 'runtime_unavailable');
    }
    const reconciled = this.store.getGenerationRequest(request.id);
    if (reconciled && ['ready', 'failed', 'cancelled', 'superseded'].includes(reconciled.state)) {
      this.store.recordAudit({
        actorKind: 'system_reconcile', workspaceId: workspace.id,
        nodeId: request.placeholderNodeId, producingTaskId: request.producingTaskId,
        action: 'reconcile_generation', result: 'success', errorCode: reconciled.errorCode,
      });
      this.recordWorkspaceEvent(
        workspace.id,
        workspace.conversationId,
        'recovery_succeeded',
        request.id,
        `${attemptKey}:succeeded:${reconciled.state}`,
        { actorKind: 'system_reconcile', state: reconciled.state },
      );
      return;
    }
    this.recordRecoveryFailure(workspace, request, attemptKey, 'runtime_unavailable', 'nonterminal');
  }

  private recordRecoveryFailure(
    workspace: { id: string; conversationId: string },
    request: WorkspaceGenerationRequest,
    attemptKey: string,
    errorCode: 'runtime_unavailable',
    reason: 'task_unbound' | 'snapshot_missing' | 'nonterminal' | 'timeout' | 'exception',
  ): void {
    const current = this.store.getGenerationRequest(request.id);
    if (current && ['prepared', 'running', 'needs_recovery'].includes(current.state)) {
      this.store.updateGenerationState(request.id, 'needs_recovery', errorCode);
    }
    const reconciled = this.store.getGenerationRequest(request.id);
    this.store.recordAudit({
      actorKind: 'system_reconcile', workspaceId: workspace.id,
      nodeId: request.placeholderNodeId, producingTaskId: request.producingTaskId,
      action: 'reconcile_generation', result: 'failed', errorCode,
    });
    this.recordWorkspaceEvent(
      workspace.id,
      workspace.conversationId,
      'recovery_failed',
      request.id,
      `${attemptKey}:failed:${reason}`,
      { actorKind: 'system_reconcile', state: reconciled?.state ?? request.state, errorCode, reason },
    );
  }

  async readArtifactWorkspaceVersionPreview(input: WorkspaceIdentityInput & { versionId: string }): Promise<ArtifactWorkspacePreview> {
    return serviceWriter(this).ingress.runAsync(() => this.#readArtifactWorkspaceVersionPreview(input));
  }

  async #readArtifactWorkspaceVersionPreview(input: WorkspaceIdentityInput & { versionId: string }): Promise<ArtifactWorkspacePreview> {
    const workspace = this.workspace(input);
    const version = this.requireOwnedVersion(workspace.id, input.versionId);
    return readVersionPreview(this.fileManager, version);
  }

  async exportArtifactWorkspaceVersion(input: WorkspaceIdentityInput & { versionId: string; destinationPath?: string }): Promise<{ fileName: string; sourcePath: string; destinationPath?: string }> {
    return serviceWriter(this).ingress.runAsync(() => this.#exportArtifactWorkspaceVersion(input));
  }

  async #exportArtifactWorkspaceVersion(input: WorkspaceIdentityInput & { versionId: string; destinationPath?: string }): Promise<{ fileName: string; sourcePath: string; destinationPath?: string }> {
    const workspace = this.workspace(input);
    const version = this.requireOwnedVersion(workspace.id, input.versionId);
    const sourcePath = this.fileManager.resolveManagedRef(version.fileRef);
    if (!this.fileManager.verifyManagedArtifact(version, 'stat')) throw new ArtifactWorkspaceError('artifact_missing', 'artifact bytes are missing');
    const entryName = basename(version.entryRef ?? version.fileRef);
    const fileName = version.storageKind === 'sealed_package'
      ? `${entryName.replace(/\.[^.]+$/, '') || 'artifact'}-package`
      : entryName;
    if (input.destinationPath) {
      mkdirSync(dirname(input.destinationPath), { recursive: true });
      if (version.storageKind === 'sealed_package') {
        rmSync(input.destinationPath, { recursive: true, force: true, maxRetries: 3 });
        cpSync(sourcePath, input.destinationPath, { recursive: true, errorOnExist: true });
      } else {
        copyFileSync(sourcePath, input.destinationPath);
      }
      this.recordWorkspaceEvent(workspace.id, workspace.conversationId, 'revision_downloaded', undefined, version.id, { kind: version.kind });
    }
    return { fileName, sourcePath, destinationPath: input.destinationPath };
  }

  recordArtifactWorkspaceEvent(input: UserMutationInput & {
    eventName: ArtifactWorkspaceEventName;
    requestId?: string;
    dedupeKey?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): boolean {
    return serviceWriter(this).ingress.runSync(() => this.#recordArtifactWorkspaceEvent(input));
  }

  #recordArtifactWorkspaceEvent(input: UserMutationInput & {
    eventName: ArtifactWorkspaceEventName;
    requestId?: string;
    dedupeKey?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): boolean {
    this.assertUser(input);
    const workspace = this.workspace(input);
    const userEvents = new Set<ArtifactWorkspaceEventName>(['revision_compare_opened', 'revision_branched']);
    if (!userEvents.has(input.eventName)) {
      throw new ArtifactWorkspaceError('permission_denied', 'renderer cannot record this workspace event');
    }
    const metadata: Record<string, string | number | boolean | null> = {};
    let dedupeKey: string | undefined;
    if (input.eventName === 'revision_compare_opened') {
      const leftVersionId = typeof input.metadata?.leftVersionId === 'string' ? input.metadata.leftVersionId : '';
      const rightVersionId = typeof input.metadata?.rightVersionId === 'string' ? input.metadata.rightVersionId : '';
      this.requireOwnedVersion(workspace.id, leftVersionId);
      this.requireOwnedVersion(workspace.id, rightVersionId);
      metadata.leftVersionId = leftVersionId;
      metadata.rightVersionId = rightVersionId;
      dedupeKey = `${leftVersionId}:${rightVersionId}`;
    } else if (input.eventName === 'revision_branched') {
      const versionId = typeof input.metadata?.versionId === 'string' ? input.metadata.versionId : '';
      this.requireOwnedVersion(workspace.id, versionId);
      metadata.versionId = versionId;
      dedupeKey = versionId;
    } else {
      dedupeKey = workspace.id;
    }
    return this.store.recordEvent({
      workspaceId: workspace.id,
      conversationId: workspace.conversationId,
      eventName: input.eventName,
      dedupeKey,
      metadata,
    });
  }

  cleanup(input: { activeViewKeys?: Set<string> } = {}): { stagingRows: number; secondaryViews: number } {
    return serviceWriter(this).ingress.runSync(() => cleanup(this.store, this.flags, this.fileManager, () => this.now(), input));
  }

  /**
   * Records a failed public mutation at the service boundary. The explicit
   * metadata allowlist prevents prompts, note bodies and file contents from
   * entering the durable audit log.
   */
  recordPublicMutationFailure(input: PublicMutationAuditInput, action: string, error: unknown): void {
    return serviceWriter(this).ingress.runSync(() => this.#recordPublicMutationFailure(input, action, error));
  }

  #recordPublicMutationFailure(input: PublicMutationAuditInput, action: string, error: unknown): void {
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : undefined;
    const workspaceRootId = typeof input.workspaceRootId === 'string' ? input.workspaceRootId : undefined;
    const candidateWorkspace = conversationId ? this.store.getWorkspaceByConversation(conversationId) : undefined;
    const workspace = candidateWorkspace && candidateWorkspace.workspaceRootId === workspaceRootId
      ? candidateWorkspace
      : undefined;
    const generationRequest = typeof input.generationRequestId === 'string'
      ? this.store.getGenerationRequest(input.generationRequestId)
      : undefined;
    const patch = Array.isArray(input.patches) && input.patches.length > 0 && typeof input.patches[0] === 'object'
      ? input.patches[0] as Record<string, unknown>
      : undefined;
    const firstString = (...values: unknown[]): string | undefined => values.find((value): value is string => (
      typeof value === 'string' && value.length > 0
    ));
    const firstNumber = (...values: unknown[]): number | undefined => values.find((value): value is number => (
      typeof value === 'number' && Number.isFinite(value)
    ));
    const errorCode = error instanceof ArtifactWorkspaceError ? error.code : 'runtime_unavailable';
    this.store.recordAudit({
      actorKind: 'user',
      requestSource: 'user',
      workspaceId: workspace?.id,
      nodeId: firstString(
        input.nodeId,
        input.placeholderNodeId,
        input.memberNodeId,
        input.collectionNodeId,
        patch?.nodeId,
        generationRequest?.placeholderNodeId,
      ),
      versionId: firstString(input.versionId, generationRequest?.sourceVersionId),
      expectedRevision: firstNumber(
        input.expectedStructureRevision,
        input.expectedViewRevision,
        patch?.expectedLayoutRevision,
      ),
      actualRevision: workspace?.structureRevision,
      producingTaskId: generationRequest?.producingTaskId,
      action,
      result: errorCode === 'permission_denied' ? 'denied' : 'failed',
      errorCode,
    });
  }

  private workspace(input: WorkspaceIdentityInput) {
    if (!input.conversationId.trim() || !input.workspaceRootId.trim()) {
      throw new ArtifactWorkspaceError('invalid_target', 'workspace identity is required');
    }
    return this.store.getOrCreateWorkspace(input);
  }

  private assertUser(input: { requestSource: ArtifactWorkspaceRequestSource; conversationId?: string; workspaceRootId?: string }): void {
    if (input.requestSource === 'user') return;
    if (input.conversationId && input.workspaceRootId) {
      const workspace = this.store.getWorkspaceByConversation(input.conversationId);
      if (workspace?.workspaceRootId === input.workspaceRootId) {
        this.store.recordAudit({
          actorKind: input.requestSource,
          requestSource: input.requestSource,
          workspaceId: workspace.id,
          action: 'general_mutation',
          result: 'denied',
          errorCode: 'permission_denied',
        });
        this.recordWorkspaceEvent(
          workspace.id,
          workspace.conversationId,
          'workspace_permission_denied',
          undefined,
          undefined,
          { actorKind: input.requestSource, operation: 'general_mutation' },
        );
      }
    }
    throw new ArtifactWorkspaceError('permission_denied', 'general workspace mutation is user-only');
  }

  private assertRevisionWrite(): void {
    if (!this.flags.artifactWorkspaceRevisionUi) throw new ArtifactWorkspaceError('feature_disabled', 'artifact revision UI is disabled');
  }

  private assertSpatialWrite(): void {
    if (!this.flags.artifactSpatialWorkspace) throw new ArtifactWorkspaceError('feature_disabled', 'artifact spatial workspace is disabled');
  }

  private assertNote(noteText: string): void {
    if (noteText.length > ARTIFACT_WORKSPACE_NOTE_LIMIT) throw new ArtifactWorkspaceError('artifact_too_large', 'note exceeds limit');
  }

  private requireOwnedVersion(workspaceId: string, versionId: string): ArtifactWorkspaceVersion {
    const version = this.store.getVersion(versionId);
    const lineage = version ? this.store.getLineage(version.lineageId) : undefined;
    if (!version || !lineage || lineage.workspaceId !== workspaceId) {
      throw new ArtifactWorkspaceError('artifact_not_found', 'artifact version is not in this workspace');
    }
    return version;
  }

  private recordWorkspaceEvent(
    workspaceId: string,
    conversationId: string,
    eventName: ArtifactWorkspaceEventName,
    requestId: string | undefined,
    dedupeKey: string | undefined,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.store.recordEvent({ workspaceId, conversationId, requestId, eventName, dedupeKey, metadata: this.redactMetadata(metadata) });
  }

  private auditUserMutation(
    workspaceId: string,
    action: string,
    result: 'success' | 'denied' | 'failed' | 'quarantined',
    detail: {
      nodeId?: string;
      versionId?: string;
      expectedRevision?: number;
      actualRevision?: number;
      producingTaskId?: string;
      pluginSource?: string;
      errorCode?: string;
    } = {},
  ): void {
    this.store.recordAudit({
      actorKind: 'user',
      requestSource: 'user',
      workspaceId,
      action,
      result,
      ...detail,
    });
  }

  private maybeRecordMultiArtifact(workspaceId: string): void {
    if (!this.flags.artifactSpatialWorkspace) return;
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) return;
    const artifactCount = this.store.listNodes(workspaceId)
      .filter((node) => node.kind === 'artifact' || node.kind === 'placeholder').length;
    if (artifactCount < 2) return;
    this.recordWorkspaceEvent(
      workspace.id,
      workspace.conversationId,
      'spatial_workspace_multi_artifact_reached',
      undefined,
      workspace.id,
      { artifactCount },
    );
  }

  private recordWorkspaceOpenMetrics(workspaceId: string, conversationId: string, viewKey: string): void {
    const session = this.store.openViewSession({ workspaceId, viewKey });
    if (!session.opened) return;
    const returnWindow = Math.floor(this.now() / (24 * 60 * 60_000));
    this.recordWorkspaceEvent(
      workspaceId,
      conversationId,
      'workspace_opened',
      undefined,
      session.sessionId,
      { spatialEnabled: this.flags.artifactSpatialWorkspace },
    );
    if (this.flags.artifactSpatialWorkspace && session.returnedAfter24h) {
      this.recordWorkspaceEvent(
        workspaceId,
        conversationId,
        'spatial_workspace_returned',
        undefined,
        `${workspaceId}:${returnWindow}`,
        {},
      );
    }
  }

  private notifyChanged(workspace: { id: string; conversationId: string }): void {
    const change = { workspaceId: workspace.id, conversationId: workspace.conversationId };
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch {
        // A renderer refresh listener must never break durable workspace state changes.
      }
    }
  }

  private redactMetadata(metadata: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
    const redacted: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (/path|prompt|content|note|token|lease/i.test(key)) continue;
      redacted[key] = typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
    }
    return redacted;
  }

  private now(): number {
    return this.nowFn();
  }

  private createId(prefix: string): string {
    return this.createIdFn(prefix).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private generationTaskRoot(leaseId: string): string {
    return join(this.generationRoot, leaseId);
  }
}
