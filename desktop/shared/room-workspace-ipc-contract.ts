import { z } from 'zod';
import type { RoomWorkspaceApi, RoomWorkspaceRequest } from './room-workspace-contract.js';

export type RoomWorkspaceMethod = keyof RoomWorkspaceApi;
export type RoomWorkspaceWireInput = {
  [K in RoomWorkspaceMethod]: RoomWorkspaceRequest & Partial<Parameters<RoomWorkspaceApi[K]>[0]>
}[RoomWorkspaceMethod] & { requestSource?: 'user' };

const text = z.string();
const number = z.number().finite();
const optionalText = text.optional();
const optionalNumber = number.optional();
const scope = z.object({ kind: z.enum(['room_only', 'project']), projectId: optionalText }).strict();
const actor = z.union([
  z.object({ kind: z.literal('user'), userId: text }).strict(),
  z.object({ kind: z.literal('agent'), logicalAgentId: text }).strict(),
  z.object({ kind: z.literal('system'), service: text }).strict(),
]);
const termination = z.object({ executorInstanceId: text,
  kind: z.enum(['process-exit', 'session-disposed', 'resources-disposed']), verified: z.boolean() }).strict();
const handoff = z.object({ reportedSummary: text, completionStatus: text,
  unfinished: z.null(), blockers: z.null(), sourceMessageIds: z.array(text) }).strict();
const claim = z.object({
  claimId: text, runId: text, executionState: text, authorizationState: text,
  instructionsRevision: number, agentName: optionalText, executorInstanceId: optionalText, projectId: optionalText,
  roomId: optionalText, logicalAgentId: optionalText, contextScope: scope.optional(),
  parentClaimId: text.nullable().optional(), projectMappingRevision: number.nullable().optional(),
  taskId: text.nullable().optional(), protocolVersion: optionalNumber, workspaceId: optionalText,
  originHostId: optionalText, hostPrincipal: optionalText, hostIncarnation: optionalNumber,
  bindingId: optionalText, generation: optionalNumber, workspaceRevision: optionalNumber,
  instructionsDigest: text.nullable().optional(), membershipRevision: optionalNumber, createdAt: optionalText,
  acquireDigest: optionalText, taskName: optionalText, mappingRevision: optionalNumber,
  roomSequence: optionalNumber, updatedAt: optionalText, lastHeartbeatAt: optionalText,
  terminationEvidence: termination.optional(),
}).strict();
const artifact = z.object({
  artifactId: text, versionId: text, relativePath: text, state: text, bindingId: text, generation: number,
  contentHash: optionalText, size: optionalNumber, producerAgentId: optionalText, producerRunId: optionalText,
  producerDisplayName: optionalText, producerType: z.enum(['user', 'unknown', 'agent']).optional(),
  projectId: optionalText, synchronization: z.enum(['pending', 'synced']).optional(),
  roomId: optionalText, workspaceId: optionalText, originHostId: optionalText, workspaceRevision: optionalNumber,
  contextScope: scope.optional(), producerClaimId: optionalText, handoff: handoff.optional(),
  observedAt: optionalText, commitTicketId: optionalText, confirmationTicketId: optionalText, sourceSequence: optionalNumber,
}).strict();
const instructions = z.object({
  revision: number, publishedText: text, sourceRelativePath: text.nullable().optional(),
  sourceHash: text.nullable().optional(), sourceChanged: z.boolean().optional(), candidateText: optionalText,
  candidateHash: optionalText, roomId: optionalText, description: optionalText,
  directoryNotes: z.union([text, z.array(text)]).optional(), snapshotDigest: optionalText,
  publishedBy: actor.optional(), publishedAt: optionalText,
}).strict();
const permissions = z.object({ canManage: z.boolean(), canRead: z.boolean(),
  canReadArtifacts: z.boolean().optional(), canRegister: z.boolean().optional() }).strict();
const mapping = z.object({ projectId: text, name: optionalText, state: text, mappingRevision: optionalNumber,
  projectRevision: optionalNumber, workFolderRelativePath: optionalText, artifactsRelativePath: optionalText }).strict();
export const ROOM_WORKSPACE_SNAPSHOT_SCHEMA = z.object({
  ok: z.boolean(), code: optionalText, phase: text, revision: number, permissions,
  workspaceId: text.nullable().optional(), bindingId: text.nullable().optional(), generation: optionalNumber,
  rootDisplayPath: optionalText, operationId: text.nullable().optional(), localCommandsAllowed: z.boolean().optional(),
  instructions: instructions.nullable().optional(), claims: z.array(claim), artifacts: z.array(artifact),
  projectMappings: z.array(mapping).optional(),
}).strict();
const error = z.object({ ok: z.literal(false), code: text }).strict();
const mutation = z.object({ ok: z.boolean(), code: optionalText, operationId: optionalText,
  snapshot: ROOM_WORKSPACE_SNAPSHOT_SCHEMA.optional() }).strict();
const preview = z.object({ ok: z.boolean(), code: optionalText, previewId: optionalText, canCommit: z.boolean(),
  changes: z.array(z.object({ relativePath: text, kind: z.enum(['directory', 'file']),
    action: z.enum(['create', 'existing']), content: optionalText }).strict()),
  conflicts: z.array(text), overlaps: z.array(text) }).strict();
const filePage = z.object({ ok: z.boolean(), code: optionalText,
  entries: z.array(z.object({ relativePath: text, name: text, kind: z.enum(['directory', 'file']),
    size: optionalNumber, state: optionalText }).strict()), nextCursor: optionalText }).strict();
const filePreview = z.object({ ok: z.boolean(), code: optionalText,
  state: z.enum(['current', 'changed', 'missing']).optional(), text: optionalText,
  truncated: z.boolean().optional(), mimeType: optionalText, contentHash: optionalText }).strict();

const room = { roomId: text, requestSource: z.literal('user').optional() };
const revision = { expectedRevision: optionalNumber, idempotencyKey: optionalText };
const file = { bindingId: optionalText, generation: optionalNumber, relativePath: optionalText };
const inputValidators = {
  setCollaborationRoomLocalCommands: z.object({ ...room, bindingId: optionalText, generation: optionalNumber,
    enabled: z.boolean(), requestSource: z.literal('user') }).strict(),
  getCollaborationRoomWorkspace: z.object(room).strict(),
  previewCollaborationRoomWorkspace: z.object({ ...room, expectedRevision: optionalNumber,
    mode: z.enum(['existing', 'create', 'unset']).optional(), selectedPath: optionalText, directoryName: optionalText,
    templateEntries: z.array(z.object({ relativePath: text, kind: z.enum(['directory', 'file']), content: optionalText }).strict()).optional(),
    instructionsText: optionalText }).strict(),
  commitCollaborationRoomWorkspace: z.object({ ...room, ...revision, previewId: optionalText,
    confirmOverlap: z.boolean().optional(), confirmSharedReadGrant: z.boolean().optional() }).strict(),
  cancelCollaborationRoomWorkspaceChange: z.object({ ...room, ...revision, operationId: optionalText }).strict(),
  listCollaborationRoomWorkspaceFiles: z.object({ ...room, ...file, cursor: optionalText }).strict(),
  previewCollaborationRoomWorkspaceFile: z.object({ ...room, ...file, versionId: optionalText }).strict(),
  publishCollaborationRoomWorkspaceInstructions: z.object({ ...room, ...revision, publishedText: optionalText,
    sourceRelativePath: optionalText, sourceHash: optionalText }).strict(),
  confirmCollaborationRoomWorkspaceArtifact: z.object({ ...room, ...revision, artifactId: optionalText, versionId: optionalText }).strict(),
  registerCollaborationRoomWorkspaceArtifact: z.object({ ...room, ...revision, ...file }).strict(),
  mapCollaborationRoomWorkspaceProject: z.object({ ...room, ...revision, projectId: optionalText,
    expectedProjectRevision: optionalNumber, workFolderRelativePath: optionalText, artifactsRelativePath: optionalText }).strict(),
  retryCollaborationRoomWorkspaceChange: z.object({ ...room, ...revision, operationId: optionalText }).strict(),
} satisfies Record<RoomWorkspaceMethod, z.ZodTypeAny>;

/** Validation preserves the captured object, including its original data prototype.
 * A Zod object parse result must not normalize a null Room canonical input. */
export function roomWorkspaceInputSchema(method: RoomWorkspaceMethod) {
  return z.custom<RoomWorkspaceWireInput>(() => true).transform(value => {
    inputValidators[method].parse(value);
    return value;
  });
}
export const ROOM_WORKSPACE_OUTPUT_SCHEMAS = {
  setCollaborationRoomLocalCommands: mutation,
  getCollaborationRoomWorkspace: z.union([ROOM_WORKSPACE_SNAPSHOT_SCHEMA, error]),
  previewCollaborationRoomWorkspace: z.union([preview, error]),
  commitCollaborationRoomWorkspace: mutation,
  cancelCollaborationRoomWorkspaceChange: mutation,
  listCollaborationRoomWorkspaceFiles: z.union([filePage, error]),
  previewCollaborationRoomWorkspaceFile: z.union([filePreview, error]),
  publishCollaborationRoomWorkspaceInstructions: mutation,
  confirmCollaborationRoomWorkspaceArtifact: mutation,
  registerCollaborationRoomWorkspaceArtifact: mutation,
  mapCollaborationRoomWorkspaceProject: mutation,
  retryCollaborationRoomWorkspaceChange: mutation,
} satisfies Record<RoomWorkspaceMethod, z.ZodTypeAny>;
