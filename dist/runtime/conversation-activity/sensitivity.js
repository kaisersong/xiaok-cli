import { isValidExternalId } from './external-id.js';
export const WORK_EVENT_SENSITIVITY = {
    schemaVersion: 'metadata', eventId: 'metadata', source: 'metadata', logicalSourceId: 'metadata',
    sourceDataEpoch: 'metadata', transportGeneration: 'metadata', workId: 'metadata', runId: 'metadata',
    sourceSequence: 'metadata', sourceRevision: 'metadata', kind: 'metadata', occurredAt: 'metadata',
    receivedAt: 'metadata', businessOutcome: 'metadata', summary: 'content', evidenceRefs: 'metadata',
    executionStarted: 'metadata',
};
export const WORK_BINDING_SENSITIVITY = {
    operationId: 'metadata', watchId: 'metadata', source: 'metadata', logicalSourceId: 'metadata',
    sourceDataEpoch: 'metadata', workId: 'metadata', runId: 'metadata', actualExecutionThreadId: 'metadata',
};
/** workspaceId here means the raw value. Hash aliases require an explicit future ledger field. */
export const ACTIVITY_ORIGIN_SENSITIVITY = {
    profileId: 'metadata', threadId: 'metadata', workspaceId: 'forbidden', actorId: 'metadata',
};
export const WORK_WATCH_SENSITIVITY = {
    ...WORK_BINDING_SENSITIVITY, origin: 'metadata', status: 'metadata', generation: 'metadata',
    preference: 'metadata', policyRevision: 'metadata', nextReportDueAt: 'metadata',
    'origin.profileId': ACTIVITY_ORIGIN_SENSITIVITY.profileId,
    'origin.threadId': ACTIVITY_ORIGIN_SENSITIVITY.threadId,
    'origin.workspaceId': ACTIVITY_ORIGIN_SENSITIVITY.workspaceId,
    'origin.actorId': ACTIVITY_ORIGIN_SENSITIVITY.actorId,
};
export const WORK_PROJECTION_SENSITIVITY = {
    watchId: 'metadata', executionState: 'metadata', businessOutcome: 'metadata', freshness: 'metadata',
    sourceSequence: 'metadata', revision: 'metadata', lastProgressAt: 'metadata', lastHeartbeatAt: 'metadata',
    lastReportAt: 'metadata', errorCode: 'metadata', summary: 'content', evidenceRefs: 'metadata',
};
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
};
export const ROOM_WAKE_SETTLED_SENSITIVITY = {
    type: 'metadata',
    roomId: 'metadata',
    roomMessageId: 'metadata',
    logicalAgentId: 'metadata',
    outcome: 'metadata',
    remaining: 'metadata',
};
export const ROOM_DISCUSSION_SETTLED_SENSITIVITY = {
    type: 'metadata',
    roomId: 'metadata',
    roomMessageId: 'metadata',
    completed: 'metadata',
    failed: 'metadata',
};
export const ROOM_WORKSPACE_CHANGED_SENSITIVITY = {
    type: 'metadata',
    kind: 'metadata',
    roomId: 'metadata',
};
export const ROOM_WORKSPACE_PERMISSIONS_SENSITIVITY = {
    canManage: 'metadata',
    canRead: 'metadata',
    canReadArtifacts: 'metadata',
    canRegister: 'metadata',
};
export const ROOM_WORKSPACE_INSTRUCTIONS_SENSITIVITY = {
    revision: 'metadata',
    publishedText: 'content',
    sourceRelativePath: 'forbidden',
    sourceHash: 'metadata',
    sourceChanged: 'metadata',
    candidateText: 'content',
    candidateHash: 'metadata',
};
export const ROOM_WORKSPACE_CLAIM_SENSITIVITY = {
    claimId: 'metadata',
    runId: 'metadata',
    executionState: 'metadata',
    authorizationState: 'metadata',
    instructionsRevision: 'metadata',
    agentName: 'content',
    executorInstanceId: 'metadata',
    projectId: 'metadata',
};
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
};
export const ROOM_WORKSPACE_PROJECT_MAPPING_SENSITIVITY = {
    projectId: 'metadata',
    name: 'content',
    state: 'metadata',
    mappingRevision: 'metadata',
    projectRevision: 'metadata',
    workFolderRelativePath: 'forbidden',
    artifactsRelativePath: 'forbidden',
};
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
};
export const ROOM_WORKSPACE_FILE_PREVIEW_SENSITIVITY = {
    ok: 'metadata',
    code: 'metadata',
    state: 'metadata',
    text: 'content',
    truncated: 'metadata',
    mimeType: 'metadata',
    contentHash: 'metadata',
};
export const ROOM_WORKSPACE_CHANGE_INPUT_SENSITIVITY = {
    roomId: 'metadata',
    expectedRevision: 'metadata',
    mode: 'metadata',
    selectedPath: 'forbidden',
    directoryName: 'content',
    templateEntries: 'metadata',
    instructionsText: 'content',
};
export const ROOM_WORKSPACE_TEMPLATE_ENTRY_SENSITIVITY = {
    relativePath: 'forbidden',
    kind: 'metadata',
    content: 'content',
};
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
};
const nestedObjects = {
    ConversationActivity: { projection: 'WorkProjection' }, WorkWatch: { origin: 'ActivityOrigin' },
    RoomWorkspaceSnapshot: { permissions: 'RoomWorkspacePermissions', instructions: 'RoomWorkspaceInstructions' },
};
const nestedArrays = {
    RoomWorkspaceSnapshot: { claims: 'RoomWorkspaceClaim', artifacts: 'RoomWorkspaceArtifact', projectMappings: 'RoomWorkspaceProjectMapping' },
    RoomWorkspaceChangeInput: { templateEntries: 'RoomWorkspaceTemplateEntry' },
};
class RejectEvent extends Error {
}
/** Keys whose values must be arrays of safe external IDs (no paths); any bad element rejects the whole event. */
const ID_ARRAY_KEYS = new Set(['evidenceRefs']);
const scalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
/** Field classification, not schema/ID validation. Unknown fields and raw workspace paths are dropped.
 * Human-written titles/task names are content and must never be added as metadata.
 * Only data properties are read; arbitrary objects cannot smuggle nested unknown fields.
 */
export function projectMetadataOnly(kind, value) {
    try {
        return project(kind, value);
    }
    catch {
        // Invalid evidenceRefs, or proxies throwing from reflection: reject the whole event
        // and never forward content-bearing errors.
        return null;
    }
}
function readIdArray(field) {
    if (!Array.isArray(field))
        throw new RejectEvent();
    const copy = [];
    for (let index = 0; index < field.length; index++) {
        const item = Object.getOwnPropertyDescriptor(field, String(index));
        if (!item || !('value' in item) || !isValidExternalId(item.value))
            throw new RejectEvent();
        copy.push(item.value);
    }
    return copy;
}
function project(kind, value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return result;
    {
        const table = tables[kind];
        if (!table)
            return result;
        for (const [key, sensitivity] of Object.entries(table)) {
            if (sensitivity !== 'metadata' || key.includes('.'))
                continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor))
                continue;
            const field = descriptor.value;
            const objectKind = nestedObjects[kind]?.[key];
            const arrayKind = nestedArrays[kind]?.[key];
            if (ID_ARRAY_KEYS.has(key)) {
                result[key] = readIdArray(field);
            }
            else if (objectKind) {
                result[key] = project(objectKind, field);
            }
            else if (arrayKind) {
                if (!Array.isArray(field))
                    continue;
                const copy = [];
                for (let index = 0; index < field.length; index++) {
                    const item = Object.getOwnPropertyDescriptor(field, String(index));
                    if (!item || !('value' in item))
                        break;
                    copy.push(project(arrayKind, item.value));
                }
                if (copy.length === field.length)
                    result[key] = copy;
            }
            else if (scalar(field)) {
                result[key] = field;
            }
            else if (Array.isArray(field)) {
                // Read data descriptors only, avoiding getters and custom array serialization.
                const copy = [];
                for (let index = 0; index < field.length; index++) {
                    const item = Object.getOwnPropertyDescriptor(field, String(index));
                    if (!item || !('value' in item) || !scalar(item.value))
                        break;
                    copy.push(item.value);
                }
                if (copy.length === field.length)
                    result[key] = copy;
            }
        }
        return result;
    }
}
