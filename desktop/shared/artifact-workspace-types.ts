export type ArtifactWorkspaceRequestSource = 'user' | 'agent' | 'scheduler';
export type ArtifactWorkspaceActorKind = ArtifactWorkspaceRequestSource | 'system_reconcile';
export type ArtifactWorkspaceRequestedKind = 'image' | 'html' | 'markdown' | 'slides';
export type ArtifactWorkspaceNodeKind = 'artifact' | 'placeholder' | 'collection' | 'note';
export type ArtifactWorkspaceRelationKind = 'derived_from' | 'references' | 'part_of_collection';
export type ArtifactWorkspaceGenerationState =
  | 'prepared'
  | 'running'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'needs_recovery'
  | 'superseded';

export type ArtifactWorkspaceErrorCode =
  | 'workspace_not_found'
  | 'artifact_not_found'
  | 'structure_revision_conflict'
  | 'layout_revision_conflict'
  | 'version_referenced'
  | 'permission_denied'
  | 'invalid_target'
  | 'artifact_kind_mismatch'
  | 'artifact_too_large'
  | 'artifact_package_invalid'
  | 'plugin_unavailable'
  | 'runtime_unavailable'
  | 'artifact_missing'
  | 'feature_disabled'
  | 'generation_conflict';

export class ArtifactWorkspaceError extends Error {
  constructor(
    readonly code: ArtifactWorkspaceErrorCode,
    message: string,
    readonly canonical?: unknown,
  ) {
    super(message);
    this.name = 'ArtifactWorkspaceError';
  }
}

export type ArtifactWorkspaceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ArtifactWorkspaceErrorCode;
        message?: string;
        canonical?: unknown;
        /** @deprecated IPC normalizes canonical state into `canonical`. */
        canonicalSnapshot?: ArtifactWorkspaceSnapshot;
        /** @deprecated IPC normalizes canonical state into `canonical`. */
        canonicalNodes?: ArtifactWorkspaceNode[];
      };
    };

export interface ArtifactWorkspaceFeatureAccess {
  revision: 'hidden' | 'read_only' | 'write';
  spatial: 'hidden' | 'enabled';
}

export interface ArtifactWorkspace {
  id: string;
  conversationId: string;
  workspaceRootId: string;
  schemaVersion: 1;
  structureRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceNode {
  id: string;
  workspaceId: string;
  kind: ArtifactWorkspaceNodeKind;
  lineageId?: string;
  artifactVersionId?: string;
  placeholderKind?: ArtifactWorkspaceRequestedKind;
  placeholderState?: 'draft' | 'generating' | 'failed' | 'cancelled' | 'needs_recovery';
  title?: string;
  noteText?: string;
  owner: 'user' | 'agent';
  createdByTaskId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  layoutRevision: number;
  tombstonedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceRelation {
  id: string;
  workspaceId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: ArtifactWorkspaceRelationKind;
  order?: number;
  createdBy: 'user' | 'agent' | 'system';
  createdAt: string;
}

export interface ArtifactLineage {
  id: string;
  workspaceId: string;
  sourceLocatorHash: string;
  preferredVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWorkspaceVersion {
  id: string;
  lineageId: string;
  parentVersionId?: string;
  fileRef: string;
  storageKind: 'single_file' | 'sealed_package';
  entryRef?: string;
  packageManifestRef?: string;
  sourceKind: 'materialized_base' | 'workspace_generation';
  sourceTaskId?: string;
  sourceArtifactId?: string;
  sourceEvidenceId?: string;
  externalTaskRef?: string;
  kind: string;
  mimeType?: string;
  byteSize?: number;
  checksum: string;
  producingTaskId?: string;
  producingAgentId?: string;
  runtimeSource?: string;
  pluginSource?: string;
  status: 'ready' | 'missing';
  createdAt: string;
}

export interface ArtifactWorkspaceVersionView extends Omit<ArtifactWorkspaceVersion, 'fileRef' | 'entryRef' | 'packageManifestRef'> {
  preferred: boolean;
  preview: {
    available: boolean;
    title: string;
    contentKind: 'text' | 'data_url' | 'package_manifest';
  };
}

export interface WorkspaceGenerationRequest {
  id: string;
  workspaceId: string;
  placeholderNodeId: string;
  sourceVersionId?: string;
  producingTaskId?: string;
  externalTaskRef?: string;
  state: ArtifactWorkspaceGenerationState;
  errorCode?: ArtifactWorkspaceErrorCode;
  supersedesRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceGenerationLease {
  id: string;
  generationRequestId: string;
  workspaceId: string;
  nodeId: string;
  sourceVersionId?: string;
  allowedAction: 'fulfill_placeholder' | 'append_revision' | 'append_collection_item';
  requestedKind: ArtifactWorkspaceRequestedKind;
  producingTaskId: string;
  producingAgentId?: string;
  expiresAt: string;
  consumedAt?: string;
  cancelledAt?: string;
  createdAt: string;
}

export type ArtifactWorkspaceQuarantineReason =
  | 'cancelled_late_result'
  | 'expired_lease'
  | 'target_conflict'
  | 'unclaimed_result'
  | 'invalid_artifact_ref'
  | 'kind_mismatch'
  | 'materialize_loser'
  | 'commit_recovery';

export interface ArtifactWorkspaceStagingFile {
  id: string;
  source: 'materialize' | 'generation';
  generationRequestId?: string;
  producingTaskId?: string;
  producedArtifactId?: string;
  sourceLocatorHash?: string;
  availability: 'present' | 'unavailable';
  fileRef?: string;
  owner: 'system_staging';
  quarantineReason?: ArtifactWorkspaceQuarantineReason;
  keep: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface ArtifactWorkspaceView {
  workspaceId: string;
  viewKey: string;
  viewport: { x: number; y: number; zoom: number };
  viewRevision: number;
  updatedAt: string;
}

export type ArtifactWorkspaceEventName =
  | 'workspace_opened'
  | 'eligible_artifact_opened'
  | 'placeholder_created'
  | 'generation_submitted'
  | 'generation_cancelled'
  | 'revision_requested'
  | 'revision_ready'
  | 'revision_failed'
  | 'revision_compare_opened'
  | 'revision_preferred'
  | 'revision_downloaded'
  | 'revision_branched'
  | 'relation_created'
  | 'recovery_attempted'
  | 'recovery_succeeded'
  | 'recovery_failed'
  | 'generation_retried'
  | 'workspace_permission_denied'
  | 'spatial_workspace_multi_artifact_reached'
  | 'spatial_node_repositioned'
  | 'spatial_workspace_returned';

export interface ArtifactWorkspaceEvent {
  id: string;
  workspaceId: string;
  conversationId: string;
  requestId?: string;
  eventName: ArtifactWorkspaceEventName;
  dedupeKey?: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface ArtifactWorkspaceSnapshot {
  workspace: ArtifactWorkspace;
  access: ArtifactWorkspaceFeatureAccess;
  nodes: ArtifactWorkspaceNode[];
  relations: ArtifactWorkspaceRelation[];
  lineages: ArtifactLineage[];
  versions: ArtifactWorkspaceVersionView[];
  generationRequests: WorkspaceGenerationRequest[];
  staging: ArtifactWorkspaceStagingFile[];
  view?: ArtifactWorkspaceView;
}

export interface ArtifactWorkspaceSelectedArtifact {
  artifactId: string;
  sourceTaskId?: string;
  kind?: string;
  mimeType?: string;
  title?: string;
}

export interface ArtifactWorkspacePreview {
  versionId: string;
  kind: string;
  mimeType?: string;
  title: string;
  contentKind: 'text' | 'data_url' | 'package_manifest';
  content: string | { entryRef: string; files: Array<{ path: string; size: number; sha256: string }> };
}

export interface ArtifactWorkspaceLayoutPatch {
  nodeId: string;
  x: number;
  y: number;
  zIndex: number;
  expectedLayoutRevision: number;
}
