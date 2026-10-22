import { isValidExternalId } from './external-id.js';

import type { ActivityOrigin, ConversationActivity, WorkBinding, WorkEvent, WorkProjection, WorkWatch } from './types.js';

export type Sensitivity = 'metadata' | 'content' | 'forbidden';

export const WORK_EVENT_SENSITIVITY = {
  schemaVersion: 'metadata', eventId: 'metadata', source: 'metadata', logicalSourceId: 'metadata',
  sourceDataEpoch: 'metadata', transportGeneration: 'metadata', workId: 'metadata', runId: 'metadata',
  sourceSequence: 'metadata', sourceRevision: 'metadata', kind: 'metadata', occurredAt: 'metadata',
  receivedAt: 'metadata', businessOutcome: 'metadata', summary: 'content', evidenceRefs: 'metadata',
  executionStarted: 'metadata',
} as const satisfies Record<keyof WorkEvent, Sensitivity>;

export const WORK_BINDING_SENSITIVITY = {
  operationId: 'metadata', watchId: 'metadata', source: 'metadata', logicalSourceId: 'metadata',
  sourceDataEpoch: 'metadata', workId: 'metadata', runId: 'metadata', actualExecutionThreadId: 'metadata',
} as const satisfies Record<keyof WorkBinding, Sensitivity>;

/** workspaceId here means the raw value. Hash aliases require an explicit future ledger field. */
export const ACTIVITY_ORIGIN_SENSITIVITY = {
  profileId: 'metadata', threadId: 'metadata', workspaceId: 'forbidden', actorId: 'metadata',
} as const satisfies Record<keyof ActivityOrigin, Sensitivity>;

type OriginPaths = `origin.${keyof ActivityOrigin}`;
export const WORK_WATCH_SENSITIVITY = {
  ...WORK_BINDING_SENSITIVITY, origin: 'metadata', status: 'metadata', generation: 'metadata',
  preference: 'metadata', policyRevision: 'metadata', nextReportDueAt: 'metadata',
  'origin.profileId': ACTIVITY_ORIGIN_SENSITIVITY.profileId,
  'origin.threadId': ACTIVITY_ORIGIN_SENSITIVITY.threadId,
  'origin.workspaceId': ACTIVITY_ORIGIN_SENSITIVITY.workspaceId,
  'origin.actorId': ACTIVITY_ORIGIN_SENSITIVITY.actorId,
} as const satisfies Record<keyof WorkWatch | OriginPaths, Sensitivity>;

export const WORK_PROJECTION_SENSITIVITY = {
  watchId: 'metadata', executionState: 'metadata', businessOutcome: 'metadata', freshness: 'metadata',
  sourceSequence: 'metadata', revision: 'metadata', lastProgressAt: 'metadata', lastHeartbeatAt: 'metadata',
  lastReportAt: 'metadata', errorCode: 'metadata', summary: 'content', evidenceRefs: 'metadata',
} as const satisfies Record<keyof WorkProjection, Sensitivity>;

type ProjectionPaths = `projection.${keyof WorkProjection}`;
export const CONVERSATION_ACTIVITY_SENSITIVITY = {
  activityId: 'metadata', localSeq: 'metadata', watchId: 'metadata', threadId: 'metadata',
  kind: 'metadata', at: 'metadata', projection: 'metadata',
  'projection.watchId': WORK_PROJECTION_SENSITIVITY.watchId,
  'projection.executionState': WORK_PROJECTION_SENSITIVITY.executionState,
  'projection.businessOutcome': WORK_PROJECTION_SENSITIVITY.businessOutcome,
  'projection.freshness': WORK_PROJECTION_SENSITIVITY.freshness,
  'projection.sourceSequence': WORK_PROJECTION_SENSITIVITY.sourceSequence,
  'projection.revision': WORK_PROJECTION_SENSITIVITY.revision,
  'projection.lastProgressAt': WORK_PROJECTION_SENSITIVITY.lastProgressAt,
  'projection.lastHeartbeatAt': WORK_PROJECTION_SENSITIVITY.lastHeartbeatAt,
  'projection.lastReportAt': WORK_PROJECTION_SENSITIVITY.lastReportAt,
  'projection.errorCode': WORK_PROJECTION_SENSITIVITY.errorCode,
  'projection.summary': WORK_PROJECTION_SENSITIVITY.summary,
  'projection.evidenceRefs': WORK_PROJECTION_SENSITIVITY.evidenceRefs,
} as const satisfies Record<keyof ConversationActivity | ProjectionPaths, Sensitivity>;


/** Local key shapes keep the CLI independent of desktop imports. Desktop contract tests guard drift. */
export interface LocalRoomWakeSettled {
  type: unknown;
  roomId: unknown;
  roomMessageId: unknown;
  logicalAgentId: unknown;
  outcome: unknown;
  remaining: unknown;
}
export const ROOM_WAKE_SETTLED_SENSITIVITY = {
  type: 'metadata',
  roomId: 'metadata',
  roomMessageId: 'metadata',
  logicalAgentId: 'metadata',
  outcome: 'metadata',
  remaining: 'metadata',
} as const satisfies Record<keyof LocalRoomWakeSettled, Sensitivity>;

export interface LocalRoomDiscussionSettled {
  type: unknown;
  roomId: unknown;
  roomMessageId: unknown;
  completed: unknown;
  failed: unknown;
}
export const ROOM_DISCUSSION_SETTLED_SENSITIVITY = {
  type: 'metadata',
  roomId: 'metadata',
  roomMessageId: 'metadata',
  completed: 'metadata',
  failed: 'metadata',
} as const satisfies Record<keyof LocalRoomDiscussionSettled, Sensitivity>;

export interface LocalRoomWorkspaceChanged {
  type: unknown;
  kind: unknown;
  roomId: unknown;
}
export const ROOM_WORKSPACE_CHANGED_SENSITIVITY = {
  type: 'metadata',
  kind: 'metadata',
  roomId: 'metadata',
} as const satisfies Record<keyof LocalRoomWorkspaceChanged, Sensitivity>;

export interface LocalRoomWorkspacePermissions {
  canManage: unknown;
  canRead: unknown;
  canReadArtifacts: unknown;
  canRegister: unknown;
}
export const ROOM_WORKSPACE_PERMISSIONS_SENSITIVITY = {
  canManage: 'metadata',
  canRead: 'metadata',
  canReadArtifacts: 'metadata',
  canRegister: 'metadata',
} as const satisfies Record<keyof LocalRoomWorkspacePermissions, Sensitivity>;

export interface LocalRoomWorkspaceInstructions {
  revision: unknown;
  publishedText: unknown;
  sourceRelativePath: unknown;
  sourceHash: unknown;
  sourceChanged: unknown;
  candidateText: unknown;
  candidateHash: unknown;
  roomId: unknown;
  description: unknown;
  directoryNotes: unknown;
  snapshotDigest: unknown;
  publishedBy: unknown;
  publishedAt: unknown;
}
export const ROOM_WORKSPACE_INSTRUCTIONS_SENSITIVITY = {
  revision: 'metadata',
  publishedText: 'content',
  sourceRelativePath: 'forbidden',
  sourceHash: 'metadata',
  sourceChanged: 'metadata',
  candidateText: 'content',
  candidateHash: 'metadata',
  roomId: 'metadata',
  description: 'content',
  directoryNotes: 'content',
  snapshotDigest: 'metadata',
  publishedBy: 'forbidden',
  publishedAt: 'metadata',
} as const satisfies Record<keyof LocalRoomWorkspaceInstructions, Sensitivity>;

export interface LocalRoomWorkspaceClaim {
  claimId: unknown;
  runId: unknown;
  executionState: unknown;
  authorizationState: unknown;
  instructionsRevision: unknown;
  agentName: unknown;
  executorInstanceId: unknown;
  projectId: unknown;
  roomId: unknown;
  logicalAgentId: unknown;
  contextScope: unknown;
  parentClaimId: unknown;
  projectMappingRevision: unknown;
  taskId: unknown;
  protocolVersion: unknown;
  workspaceId: unknown;
  originHostId: unknown;
  hostPrincipal: unknown;
  hostIncarnation: unknown;
  bindingId: unknown;
  generation: unknown;
  workspaceRevision: unknown;
  instructionsDigest: unknown;
  membershipRevision: unknown;
  createdAt: unknown;
  acquireDigest: unknown;
  taskName: unknown;
  mappingRevision: unknown;
  roomSequence: unknown;
  updatedAt: unknown;
  lastHeartbeatAt: unknown;
  terminationEvidence: unknown;
}
export const ROOM_WORKSPACE_CLAIM_SENSITIVITY = {
  claimId: 'metadata',
  runId: 'metadata',
  executionState: 'metadata',
  authorizationState: 'metadata',
  instructionsRevision: 'metadata',
  agentName: 'content',
  executorInstanceId: 'metadata',
  projectId: 'metadata',
  roomId: 'metadata',
  logicalAgentId: 'metadata',
  contextScope: 'forbidden',
  parentClaimId: 'metadata',
  projectMappingRevision: 'metadata',
  taskId: 'metadata',
  protocolVersion: 'metadata',
  workspaceId: 'forbidden',
  originHostId: 'forbidden',
  hostPrincipal: 'forbidden',
  hostIncarnation: 'metadata',
  bindingId: 'metadata',
  generation: 'metadata',
  workspaceRevision: 'metadata',
  instructionsDigest: 'metadata',
  membershipRevision: 'metadata',
  createdAt: 'metadata',
  acquireDigest: 'forbidden',
  taskName: 'content',
  mappingRevision: 'metadata',
  roomSequence: 'metadata',
  updatedAt: 'metadata',
  lastHeartbeatAt: 'metadata',
  terminationEvidence: 'forbidden',
} as const satisfies Record<keyof LocalRoomWorkspaceClaim, Sensitivity>;

export interface LocalRoomWorkspaceArtifact {
  artifactId: unknown;
  versionId: unknown;
  relativePath: unknown;
  state: unknown;
  bindingId: unknown;
  generation: unknown;
  contentHash: unknown;
  size: unknown;
  producerAgentId: unknown;
  producerRunId: unknown;
  producerDisplayName: unknown;
  producerType: unknown;
  projectId: unknown;
  synchronization: unknown;
  roomId: unknown;
  workspaceId: unknown;
  originHostId: unknown;
  workspaceRevision: unknown;
  contextScope: unknown;
  producerClaimId: unknown;
  handoff: unknown;
  observedAt: unknown;
  commitTicketId: unknown;
  confirmationTicketId: unknown;
  sourceSequence: unknown;
}
export const ROOM_WORKSPACE_ARTIFACT_SENSITIVITY = {
  artifactId: 'metadata',
  versionId: 'metadata',
  relativePath: 'forbidden',
  state: 'metadata',
  bindingId: 'metadata',
  generation: 'metadata',
  contentHash: 'metadata',
  size: 'metadata',
  producerAgentId: 'metadata',
  producerRunId: 'metadata',
  producerDisplayName: 'content',
  producerType: 'metadata',
  projectId: 'metadata',
  synchronization: 'metadata',
  roomId: 'metadata',
  workspaceId: 'forbidden',
  originHostId: 'forbidden',
  workspaceRevision: 'metadata',
  contextScope: 'forbidden',
  producerClaimId: 'metadata',
  handoff: 'content',
  observedAt: 'metadata',
  commitTicketId: 'forbidden',
  confirmationTicketId: 'forbidden',
  sourceSequence: 'metadata',
} as const satisfies Record<keyof LocalRoomWorkspaceArtifact, Sensitivity>;

export interface LocalRoomWorkspaceProjectMapping {
  projectId: unknown;
  name: unknown;
  state: unknown;
  mappingRevision: unknown;
  projectRevision: unknown;
  workFolderRelativePath: unknown;
  artifactsRelativePath: unknown;
}
export const ROOM_WORKSPACE_PROJECT_MAPPING_SENSITIVITY = {
  projectId: 'metadata',
  name: 'content',
  state: 'metadata',
  mappingRevision: 'metadata',
  projectRevision: 'metadata',
  workFolderRelativePath: 'forbidden',
  artifactsRelativePath: 'forbidden',
} as const satisfies Record<keyof LocalRoomWorkspaceProjectMapping, Sensitivity>;

export interface LocalRoomWorkspaceSnapshot {
  localCommandsAllowed: unknown;
  ok: unknown;
  code: unknown;
  phase: unknown;
  revision: unknown;
  permissions: unknown;
  workspaceId: unknown;
  bindingId: unknown;
  generation: unknown;
  rootDisplayPath: unknown;
  operationId: unknown;
  instructions: unknown;
  claims: unknown;
  artifacts: unknown;
  projectMappings: unknown;
}
export const ROOM_WORKSPACE_SNAPSHOT_SENSITIVITY = {
  localCommandsAllowed: 'metadata',
  ok: 'metadata',
  code: 'metadata',
  phase: 'metadata',
  revision: 'metadata',
  permissions: 'metadata',
  workspaceId: 'forbidden',
  bindingId: 'metadata',
  generation: 'metadata',
  rootDisplayPath: 'forbidden',
  operationId: 'metadata',
  instructions: 'metadata',
  claims: 'metadata',
  artifacts: 'metadata',
  projectMappings: 'metadata',
} as const satisfies Record<keyof LocalRoomWorkspaceSnapshot, Sensitivity>;

export interface LocalRoomWorkspaceFilePreview {
  ok: unknown;
  code: unknown;
  state: unknown;
  text: unknown;
  truncated: unknown;
  mimeType: unknown;
  contentHash: unknown;
}
export const ROOM_WORKSPACE_FILE_PREVIEW_SENSITIVITY = {
  ok: 'metadata',
  code: 'metadata',
  state: 'metadata',
  text: 'content',
  truncated: 'metadata',
  mimeType: 'metadata',
  contentHash: 'metadata',
} as const satisfies Record<keyof LocalRoomWorkspaceFilePreview, Sensitivity>;

export interface LocalRoomWorkspaceChangeInput {
  roomId: unknown;
  expectedRevision: unknown;
  mode: unknown;
  selectedPath: unknown;
  directoryName: unknown;
  templateEntries: unknown;
  instructionsText: unknown;
}
export const ROOM_WORKSPACE_CHANGE_INPUT_SENSITIVITY = {
  roomId: 'metadata',
  expectedRevision: 'metadata',
  mode: 'metadata',
  selectedPath: 'forbidden',
  directoryName: 'content',
  templateEntries: 'metadata',
  instructionsText: 'content',
} as const satisfies Record<keyof LocalRoomWorkspaceChangeInput, Sensitivity>;

export interface LocalRoomWorkspaceTemplateEntry {
  relativePath: unknown;
  kind: unknown;
  content: unknown;
}
export const ROOM_WORKSPACE_TEMPLATE_ENTRY_SENSITIVITY = {
  relativePath: 'forbidden',
  kind: 'metadata',
  content: 'content',
} as const satisfies Record<keyof LocalRoomWorkspaceTemplateEntry, Sensitivity>;

const tables = {
  RoomWakeSettled: ROOM_WAKE_SETTLED_SENSITIVITY,
  RoomDiscussionSettled: ROOM_DISCUSSION_SETTLED_SENSITIVITY,
  RoomWorkspaceChanged: ROOM_WORKSPACE_CHANGED_SENSITIVITY,
  RoomWorkspacePermissions: ROOM_WORKSPACE_PERMISSIONS_SENSITIVITY,
  RoomWorkspaceInstructions: ROOM_WORKSPACE_INSTRUCTIONS_SENSITIVITY,
  RoomWorkspaceClaim: ROOM_WORKSPACE_CLAIM_SENSITIVITY,
  RoomWorkspaceArtifact: ROOM_WORKSPACE_ARTIFACT_SENSITIVITY,
  RoomWorkspaceProjectMapping: ROOM_WORKSPACE_PROJECT_MAPPING_SENSITIVITY,
  RoomWorkspaceSnapshot: ROOM_WORKSPACE_SNAPSHOT_SENSITIVITY,
  RoomWorkspaceFilePreview: ROOM_WORKSPACE_FILE_PREVIEW_SENSITIVITY,
  RoomWorkspaceChangeInput: ROOM_WORKSPACE_CHANGE_INPUT_SENSITIVITY,
  RoomWorkspaceTemplateEntry: ROOM_WORKSPACE_TEMPLATE_ENTRY_SENSITIVITY,
  WorkEvent: WORK_EVENT_SENSITIVITY, WorkBinding: WORK_BINDING_SENSITIVITY,
  WorkWatch: WORK_WATCH_SENSITIVITY, ActivityOrigin: ACTIVITY_ORIGIN_SENSITIVITY,
  WorkProjection: WORK_PROJECTION_SENSITIVITY, ConversationActivity: CONVERSATION_ACTIVITY_SENSITIVITY,
} as const;
export type MetadataKind = keyof typeof tables;

const nestedObjects: Partial<Record<MetadataKind, Record<string, MetadataKind>>> = {
  ConversationActivity: { projection: 'WorkProjection' }, WorkWatch: { origin: 'ActivityOrigin' },
  RoomWorkspaceSnapshot: { permissions: 'RoomWorkspacePermissions', instructions: 'RoomWorkspaceInstructions' },
};
const nestedArrays: Partial<Record<MetadataKind, Record<string, MetadataKind>>> = {
  RoomWorkspaceSnapshot: { claims: 'RoomWorkspaceClaim', artifacts: 'RoomWorkspaceArtifact', projectMappings: 'RoomWorkspaceProjectMapping' },
  RoomWorkspaceChangeInput: { templateEntries: 'RoomWorkspaceTemplateEntry' },
};

class RejectEvent extends Error {}
/** Keys whose values must be arrays of safe external IDs (no paths); any bad element rejects the whole event. */
const ID_ARRAY_KEYS = new Set(['evidenceRefs']);

const scalar = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Field classification, not schema/ID validation. Unknown fields and raw workspace paths are dropped.
 * Human-written titles/task names are content and must never be added as metadata.
 * Only data properties are read; arbitrary objects cannot smuggle nested unknown fields.
 */
export function projectMetadataOnly(kind: MetadataKind, value: unknown): Record<string, unknown> | null {
  try {
    return project(kind, value);
  } catch {
    // Invalid evidenceRefs, or proxies throwing from reflection: reject the whole event
    // and never forward content-bearing errors.
    return null;
  }
}

function readIdArray(field: unknown): string[] {
  if (!Array.isArray(field)) throw new RejectEvent();
  const copy: string[] = [];
  for (let index = 0; index < field.length; index++) {
    const item = Object.getOwnPropertyDescriptor(field, String(index));
    if (!item || !('value' in item) || !isValidExternalId(item.value)) throw new RejectEvent();
    copy.push(item.value);
  }
  return copy;
}

function project(kind: MetadataKind, value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  {
    const table = tables[kind];
    if (!table) return result;
    for (const [key, sensitivity] of Object.entries(table)) {
      if (sensitivity !== 'metadata' || key.includes('.')) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const field: unknown = descriptor.value;
      const objectKind = nestedObjects[kind]?.[key];
      const arrayKind = nestedArrays[kind]?.[key];
      if (ID_ARRAY_KEYS.has(key)) {
        result[key] = readIdArray(field);
      } else if (objectKind) {
        result[key] = project(objectKind, field);
      } else if (arrayKind) {
        if (!Array.isArray(field)) continue;
        const copy: Record<string, unknown>[] = [];
        for (let index = 0; index < field.length; index++) {
          const item = Object.getOwnPropertyDescriptor(field, String(index));
          if (!item || !('value' in item)) break;
          copy.push(project(arrayKind, item.value));
        }
        if (copy.length === field.length) result[key] = copy;
      } else if (scalar(field)) {
        result[key] = field;
      } else if (Array.isArray(field)) {
        // Read data descriptors only, avoiding getters and custom array serialization.
        const copy: unknown[] = [];
        for (let index = 0; index < field.length; index++) {
          const item = Object.getOwnPropertyDescriptor(field, String(index));
          if (!item || !('value' in item) || !scalar(item.value)) break;
          copy.push(item.value);
        }
        if (copy.length === field.length) result[key] = copy;
      }
    }
    return result;
  }
}
