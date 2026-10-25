import { z, type ZodSchema } from 'zod';
import type { RiskTag } from './ipc-runtime.js';

const text = z.string();
const number = z.number();
const requestedKind = z.enum(['image', 'html', 'markdown', 'slides']);
const generationState = z.enum(['prepared', 'running', 'ready', 'failed', 'cancelled', 'needs_recovery', 'superseded']);
const errorCode = z.enum(['workspace_not_found', 'artifact_not_found', 'structure_revision_conflict', 'layout_revision_conflict', 'version_referenced', 'permission_denied', 'invalid_target', 'artifact_kind_mismatch', 'artifact_too_large', 'artifact_package_invalid', 'plugin_unavailable', 'runtime_unavailable', 'artifact_missing', 'feature_disabled', 'generation_conflict']);
const workspace = z.object({ id: text, conversationId: text, workspaceRootId: text, schemaVersion: z.literal(1), structureRevision: number, createdAt: text, updatedAt: text }).strict();
const node = z.object({
  id: text, workspaceId: text, kind: z.enum(['artifact', 'placeholder', 'collection', 'note']), lineageId: text.optional(), artifactVersionId: text.optional(),
  placeholderKind: requestedKind.optional(), placeholderState: z.enum(['draft', 'generating', 'failed', 'cancelled', 'needs_recovery']).optional(), title: text.optional(), noteText: text.optional(),
  owner: z.enum(['user', 'agent']), createdByTaskId: text.optional(), x: number, y: number, width: number, height: number, zIndex: number, layoutRevision: number, tombstonedAt: text.optional(), createdAt: text, updatedAt: text,
}).strict();
const relation = z.object({ id: text, workspaceId: text, fromNodeId: text, toNodeId: text, kind: z.enum(['derived_from', 'references', 'part_of_collection']), order: number.optional(), createdBy: z.enum(['user', 'agent', 'system']), createdAt: text }).strict();
const lineage = z.object({ id: text, workspaceId: text, sourceLocatorHash: text, preferredVersionId: text.optional(), createdAt: text, updatedAt: text }).strict();
const version = z.object({
  id: text, lineageId: text, parentVersionId: text.optional(), storageKind: z.enum(['single_file', 'sealed_package']), sourceKind: z.enum(['materialized_base', 'workspace_generation']),
  sourceTaskId: text.optional(), sourceArtifactId: text.optional(), sourceEvidenceId: text.optional(), externalTaskRef: text.optional(), kind: text, mimeType: text.optional(), byteSize: number.optional(), checksum: text,
  producingTaskId: text.optional(), producingAgentId: text.optional(), runtimeSource: text.optional(), pluginSource: text.optional(), status: z.enum(['ready', 'missing']), createdAt: text, preferred: z.boolean(),
  preview: z.object({ available: z.boolean(), title: text, contentKind: z.enum(['text', 'data_url', 'package_manifest']) }).strict(),
}).strict();
const request = z.object({ id: text, workspaceId: text, placeholderNodeId: text, sourceVersionId: text.optional(), producingTaskId: text.optional(), externalTaskRef: text.optional(), state: generationState, errorCode: errorCode.optional(), supersedesRequestId: text.optional(), createdAt: text, updatedAt: text }).strict();
const staging = z.object({
  id: text, source: z.enum(['materialize', 'generation']), generationRequestId: text.optional(), producingTaskId: text.optional(), producedArtifactId: text.optional(), sourceLocatorHash: text.optional(),
  availability: z.enum(['present', 'unavailable']), fileRef: text.optional(), owner: z.literal('system_staging'),
  quarantineReason: z.enum(['cancelled_late_result', 'expired_lease', 'target_conflict', 'unclaimed_result', 'invalid_artifact_ref', 'kind_mismatch', 'materialize_loser', 'commit_recovery']).optional(), keep: z.boolean(), createdAt: text, expiresAt: text,
}).strict();
const view = z.object({ workspaceId: text, viewKey: text, viewport: z.object({ x: number, y: number, zoom: number }).strict(), viewRevision: number, updatedAt: text }).strict();
const snapshot = z.object({ workspace, access: z.object({ revision: z.enum(['hidden', 'read_only', 'write']), spatial: z.enum(['hidden', 'enabled']) }).strict(), nodes: z.array(node), relations: z.array(relation), lineages: z.array(lineage), versions: z.array(version), generationRequests: z.array(request), staging: z.array(staging), view: view.optional() }).strict();
const previewFields = { versionId: text, kind: text, mimeType: text.optional(), title: text };
const preview = z.discriminatedUnion('contentKind', [
  z.object({ ...previewFields, contentKind: z.literal('text'), content: text }).strict(),
  z.object({ ...previewFields, contentKind: z.literal('data_url'), content: text }).strict(),
  z.object({ ...previewFields, contentKind: z.literal('package_manifest'), content: z.object({ entryRef: text, files: z.array(z.object({ path: text, size: number, sha256: text }).strict()) }).strict() }).strict(),
]);
// canonical is the sole deliberately opaque field in the existing public error ABI.
const failure = z.object({ ok: z.literal(false), error: z.object({ code: errorCode, message: text, canonical: z.unknown().optional() }).strict() }).strict();
const result = (data: ZodSchema) => z.union([z.object({ ok: z.literal(true), data }).strict(), failure]);
const snapshotResult = result(snapshot);
export const ARTIFACT_WORKSPACE_OUTPUT_SCHEMAS = {
  getArtifactWorkspaceSnapshot: snapshotResult,
  closeArtifactWorkspace: result(z.object({ closed: z.boolean() }).strict()),
  readArtifactWorkspaceVersionPreview: result(preview),
  exportArtifactWorkspaceVersion: result(z.object({ exported: z.boolean(), canceled: z.boolean().optional() }).strict()),
  createArtifactPlaceholder: snapshotResult, submitArtifactGeneration: snapshotResult, cancelArtifactGeneration: snapshotResult, retryArtifactGeneration: snapshotResult,
  preferArtifactVersion: snapshotResult, removeArtifactWorkspaceNode: snapshotResult, updateArtifactWorkspaceLayout: snapshotResult, saveArtifactWorkspaceViewport: snapshotResult,
  createArtifactWorkspaceCollection: snapshotResult, createArtifactWorkspaceNote: snapshotResult, updateArtifactWorkspaceNote: snapshotResult, createArtifactWorkspaceRelation: snapshotResult, setArtifactCollectionMembership: snapshotResult,
  recordArtifactWorkspaceEvent: result(z.object({ recorded: z.boolean() }).strict()),
} as const;

export const ARTIFACT_WORKSPACE_RISK_TAGS: Record<keyof typeof ARTIFACT_WORKSPACE_OUTPUT_SCHEMAS, RiskTag[]> = {
  getArtifactWorkspaceSnapshot: ['fs-read', 'fs-write-userData'],
  closeArtifactWorkspace: ['fs-write-userData'],
  readArtifactWorkspaceVersionPreview: ['fs-read', 'fs-write-userData'],
  exportArtifactWorkspaceVersion: ['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'dialog'],
  createArtifactPlaceholder: ['fs-read', 'fs-write-userData'],
  submitArtifactGeneration: ['fs-read', 'fs-write', 'fs-write-userData', 'exec', 'network', 'external-process'],
  cancelArtifactGeneration: ['fs-read', 'fs-write-userData', 'external-process'],
  retryArtifactGeneration: ['fs-read', 'fs-write', 'fs-write-userData', 'exec', 'network', 'external-process'],
  preferArtifactVersion: ['fs-read', 'fs-write-userData'], removeArtifactWorkspaceNode: ['fs-read', 'fs-write-userData'], updateArtifactWorkspaceLayout: ['fs-read', 'fs-write-userData'], saveArtifactWorkspaceViewport: ['fs-read', 'fs-write-userData'],
  createArtifactWorkspaceCollection: ['fs-read', 'fs-write-userData'], createArtifactWorkspaceNote: ['fs-read', 'fs-write-userData'], updateArtifactWorkspaceNote: ['fs-read', 'fs-write-userData'], createArtifactWorkspaceRelation: ['fs-read', 'fs-write-userData'], setArtifactCollectionMembership: ['fs-read', 'fs-write-userData'],
  recordArtifactWorkspaceEvent: ['fs-write-userData'],
};
