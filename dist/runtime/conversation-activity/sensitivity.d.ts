export type Sensitivity = 'metadata' | 'content' | 'forbidden';
export declare const WORK_EVENT_SENSITIVITY: {
    readonly schemaVersion: "metadata";
    readonly eventId: "metadata";
    readonly source: "metadata";
    readonly logicalSourceId: "metadata";
    readonly sourceDataEpoch: "metadata";
    readonly transportGeneration: "metadata";
    readonly workId: "metadata";
    readonly runId: "metadata";
    readonly sourceSequence: "metadata";
    readonly sourceRevision: "metadata";
    readonly kind: "metadata";
    readonly occurredAt: "metadata";
    readonly receivedAt: "metadata";
    readonly businessOutcome: "metadata";
    readonly summary: "content";
    readonly evidenceRefs: "metadata";
    readonly executionStarted: "metadata";
};
export declare const WORK_BINDING_SENSITIVITY: {
    readonly operationId: "metadata";
    readonly watchId: "metadata";
    readonly source: "metadata";
    readonly logicalSourceId: "metadata";
    readonly sourceDataEpoch: "metadata";
    readonly workId: "metadata";
    readonly runId: "metadata";
    readonly actualExecutionThreadId: "metadata";
};
/** workspaceId here means the raw value. Hash aliases require an explicit future ledger field. */
export declare const ACTIVITY_ORIGIN_SENSITIVITY: {
    readonly profileId: "metadata";
    readonly threadId: "metadata";
    readonly workspaceId: "forbidden";
    readonly actorId: "metadata";
};
export declare const WORK_WATCH_SENSITIVITY: {
    readonly origin: "metadata";
    readonly status: "metadata";
    readonly generation: "metadata";
    readonly preference: "metadata";
    readonly policyRevision: "metadata";
    readonly nextReportDueAt: "metadata";
    readonly 'origin.profileId': "metadata";
    readonly 'origin.threadId': "metadata";
    readonly 'origin.workspaceId': "forbidden";
    readonly 'origin.actorId': "metadata";
    readonly operationId: "metadata";
    readonly watchId: "metadata";
    readonly source: "metadata";
    readonly logicalSourceId: "metadata";
    readonly sourceDataEpoch: "metadata";
    readonly workId: "metadata";
    readonly runId: "metadata";
    readonly actualExecutionThreadId: "metadata";
};
export declare const WORK_PROJECTION_SENSITIVITY: {
    readonly watchId: "metadata";
    readonly executionState: "metadata";
    readonly businessOutcome: "metadata";
    readonly freshness: "metadata";
    readonly sourceSequence: "metadata";
    readonly revision: "metadata";
    readonly lastProgressAt: "metadata";
    readonly lastHeartbeatAt: "metadata";
    readonly lastReportAt: "metadata";
    readonly errorCode: "metadata";
    readonly summary: "content";
    readonly evidenceRefs: "metadata";
};
export declare const CONVERSATION_ACTIVITY_SENSITIVITY: {
    readonly activityId: "metadata";
    readonly localSeq: "metadata";
    readonly watchId: "metadata";
    readonly threadId: "metadata";
    readonly kind: "metadata";
    readonly at: "metadata";
    readonly projection: "metadata";
    readonly 'projection.watchId': "metadata";
    readonly 'projection.executionState': "metadata";
    readonly 'projection.businessOutcome': "metadata";
    readonly 'projection.freshness': "metadata";
    readonly 'projection.sourceSequence': "metadata";
    readonly 'projection.revision': "metadata";
    readonly 'projection.lastProgressAt': "metadata";
    readonly 'projection.lastHeartbeatAt': "metadata";
    readonly 'projection.lastReportAt': "metadata";
    readonly 'projection.errorCode': "metadata";
    readonly 'projection.summary': "content";
    readonly 'projection.evidenceRefs': "metadata";
};
/** Local key shapes keep the CLI independent of desktop imports. Desktop contract tests guard drift. */
export interface LocalRoomWakeSettled {
    type: unknown;
    roomId: unknown;
    roomMessageId: unknown;
    logicalAgentId: unknown;
    outcome: unknown;
    remaining: unknown;
}
export declare const ROOM_WAKE_SETTLED_SENSITIVITY: {
    readonly type: "metadata";
    readonly roomId: "metadata";
    readonly roomMessageId: "metadata";
    readonly logicalAgentId: "metadata";
    readonly outcome: "metadata";
    readonly remaining: "metadata";
};
export interface LocalRoomDiscussionSettled {
    type: unknown;
    roomId: unknown;
    roomMessageId: unknown;
    completed: unknown;
    failed: unknown;
}
export declare const ROOM_DISCUSSION_SETTLED_SENSITIVITY: {
    readonly type: "metadata";
    readonly roomId: "metadata";
    readonly roomMessageId: "metadata";
    readonly completed: "metadata";
    readonly failed: "metadata";
};
export interface LocalRoomWorkspaceChanged {
    type: unknown;
    kind: unknown;
    roomId: unknown;
}
export declare const ROOM_WORKSPACE_CHANGED_SENSITIVITY: {
    readonly type: "metadata";
    readonly kind: "metadata";
    readonly roomId: "metadata";
};
export interface LocalRoomWorkspacePermissions {
    canManage: unknown;
    canRead: unknown;
    canReadArtifacts: unknown;
    canRegister: unknown;
}
export declare const ROOM_WORKSPACE_PERMISSIONS_SENSITIVITY: {
    readonly canManage: "metadata";
    readonly canRead: "metadata";
    readonly canReadArtifacts: "metadata";
    readonly canRegister: "metadata";
};
export interface LocalRoomWorkspaceInstructions {
    revision: unknown;
    publishedText: unknown;
    sourceRelativePath: unknown;
    sourceHash: unknown;
    sourceChanged: unknown;
    candidateText: unknown;
    candidateHash: unknown;
}
export declare const ROOM_WORKSPACE_INSTRUCTIONS_SENSITIVITY: {
    readonly revision: "metadata";
    readonly publishedText: "content";
    readonly sourceRelativePath: "forbidden";
    readonly sourceHash: "metadata";
    readonly sourceChanged: "metadata";
    readonly candidateText: "content";
    readonly candidateHash: "metadata";
};
export interface LocalRoomWorkspaceClaim {
    claimId: unknown;
    runId: unknown;
    executionState: unknown;
    authorizationState: unknown;
    instructionsRevision: unknown;
    agentName: unknown;
    executorInstanceId: unknown;
    projectId: unknown;
}
export declare const ROOM_WORKSPACE_CLAIM_SENSITIVITY: {
    readonly claimId: "metadata";
    readonly runId: "metadata";
    readonly executionState: "metadata";
    readonly authorizationState: "metadata";
    readonly instructionsRevision: "metadata";
    readonly agentName: "content";
    readonly executorInstanceId: "metadata";
    readonly projectId: "metadata";
};
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
}
export declare const ROOM_WORKSPACE_ARTIFACT_SENSITIVITY: {
    readonly artifactId: "metadata";
    readonly versionId: "metadata";
    readonly relativePath: "forbidden";
    readonly state: "metadata";
    readonly bindingId: "metadata";
    readonly generation: "metadata";
    readonly contentHash: "metadata";
    readonly size: "metadata";
    readonly producerAgentId: "metadata";
    readonly producerRunId: "metadata";
    readonly producerDisplayName: "content";
    readonly producerType: "metadata";
    readonly projectId: "metadata";
    readonly synchronization: "metadata";
};
export interface LocalRoomWorkspaceProjectMapping {
    projectId: unknown;
    name: unknown;
    state: unknown;
    mappingRevision: unknown;
    projectRevision: unknown;
    workFolderRelativePath: unknown;
    artifactsRelativePath: unknown;
}
export declare const ROOM_WORKSPACE_PROJECT_MAPPING_SENSITIVITY: {
    readonly projectId: "metadata";
    readonly name: "content";
    readonly state: "metadata";
    readonly mappingRevision: "metadata";
    readonly projectRevision: "metadata";
    readonly workFolderRelativePath: "forbidden";
    readonly artifactsRelativePath: "forbidden";
};
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
export declare const ROOM_WORKSPACE_SNAPSHOT_SENSITIVITY: {
    readonly localCommandsAllowed: "metadata";
    readonly ok: "metadata";
    readonly code: "metadata";
    readonly phase: "metadata";
    readonly revision: "metadata";
    readonly permissions: "metadata";
    readonly workspaceId: "forbidden";
    readonly bindingId: "metadata";
    readonly generation: "metadata";
    readonly rootDisplayPath: "forbidden";
    readonly operationId: "metadata";
    readonly instructions: "metadata";
    readonly claims: "metadata";
    readonly artifacts: "metadata";
    readonly projectMappings: "metadata";
};
export interface LocalRoomWorkspaceFilePreview {
    ok: unknown;
    code: unknown;
    state: unknown;
    text: unknown;
    truncated: unknown;
    mimeType: unknown;
    contentHash: unknown;
}
export declare const ROOM_WORKSPACE_FILE_PREVIEW_SENSITIVITY: {
    readonly ok: "metadata";
    readonly code: "metadata";
    readonly state: "metadata";
    readonly text: "content";
    readonly truncated: "metadata";
    readonly mimeType: "metadata";
    readonly contentHash: "metadata";
};
export interface LocalRoomWorkspaceChangeInput {
    roomId: unknown;
    expectedRevision: unknown;
    mode: unknown;
    selectedPath: unknown;
    directoryName: unknown;
    templateEntries: unknown;
    instructionsText: unknown;
}
export declare const ROOM_WORKSPACE_CHANGE_INPUT_SENSITIVITY: {
    readonly roomId: "metadata";
    readonly expectedRevision: "metadata";
    readonly mode: "metadata";
    readonly selectedPath: "forbidden";
    readonly directoryName: "content";
    readonly templateEntries: "metadata";
    readonly instructionsText: "content";
};
export interface LocalRoomWorkspaceTemplateEntry {
    relativePath: unknown;
    kind: unknown;
    content: unknown;
}
export declare const ROOM_WORKSPACE_TEMPLATE_ENTRY_SENSITIVITY: {
    readonly relativePath: "forbidden";
    readonly kind: "metadata";
    readonly content: "content";
};
declare const tables: {
    readonly RoomWakeSettled: {
        readonly type: "metadata";
        readonly roomId: "metadata";
        readonly roomMessageId: "metadata";
        readonly logicalAgentId: "metadata";
        readonly outcome: "metadata";
        readonly remaining: "metadata";
    };
    readonly RoomDiscussionSettled: {
        readonly type: "metadata";
        readonly roomId: "metadata";
        readonly roomMessageId: "metadata";
        readonly completed: "metadata";
        readonly failed: "metadata";
    };
    readonly RoomWorkspaceChanged: {
        readonly type: "metadata";
        readonly kind: "metadata";
        readonly roomId: "metadata";
    };
    readonly RoomWorkspacePermissions: {
        readonly canManage: "metadata";
        readonly canRead: "metadata";
        readonly canReadArtifacts: "metadata";
        readonly canRegister: "metadata";
    };
    readonly RoomWorkspaceInstructions: {
        readonly revision: "metadata";
        readonly publishedText: "content";
        readonly sourceRelativePath: "forbidden";
        readonly sourceHash: "metadata";
        readonly sourceChanged: "metadata";
        readonly candidateText: "content";
        readonly candidateHash: "metadata";
    };
    readonly RoomWorkspaceClaim: {
        readonly claimId: "metadata";
        readonly runId: "metadata";
        readonly executionState: "metadata";
        readonly authorizationState: "metadata";
        readonly instructionsRevision: "metadata";
        readonly agentName: "content";
        readonly executorInstanceId: "metadata";
        readonly projectId: "metadata";
    };
    readonly RoomWorkspaceArtifact: {
        readonly artifactId: "metadata";
        readonly versionId: "metadata";
        readonly relativePath: "forbidden";
        readonly state: "metadata";
        readonly bindingId: "metadata";
        readonly generation: "metadata";
        readonly contentHash: "metadata";
        readonly size: "metadata";
        readonly producerAgentId: "metadata";
        readonly producerRunId: "metadata";
        readonly producerDisplayName: "content";
        readonly producerType: "metadata";
        readonly projectId: "metadata";
        readonly synchronization: "metadata";
    };
    readonly RoomWorkspaceProjectMapping: {
        readonly projectId: "metadata";
        readonly name: "content";
        readonly state: "metadata";
        readonly mappingRevision: "metadata";
        readonly projectRevision: "metadata";
        readonly workFolderRelativePath: "forbidden";
        readonly artifactsRelativePath: "forbidden";
    };
    readonly RoomWorkspaceSnapshot: {
        readonly localCommandsAllowed: "metadata";
        readonly ok: "metadata";
        readonly code: "metadata";
        readonly phase: "metadata";
        readonly revision: "metadata";
        readonly permissions: "metadata";
        readonly workspaceId: "forbidden";
        readonly bindingId: "metadata";
        readonly generation: "metadata";
        readonly rootDisplayPath: "forbidden";
        readonly operationId: "metadata";
        readonly instructions: "metadata";
        readonly claims: "metadata";
        readonly artifacts: "metadata";
        readonly projectMappings: "metadata";
    };
    readonly RoomWorkspaceFilePreview: {
        readonly ok: "metadata";
        readonly code: "metadata";
        readonly state: "metadata";
        readonly text: "content";
        readonly truncated: "metadata";
        readonly mimeType: "metadata";
        readonly contentHash: "metadata";
    };
    readonly RoomWorkspaceChangeInput: {
        readonly roomId: "metadata";
        readonly expectedRevision: "metadata";
        readonly mode: "metadata";
        readonly selectedPath: "forbidden";
        readonly directoryName: "content";
        readonly templateEntries: "metadata";
        readonly instructionsText: "content";
    };
    readonly RoomWorkspaceTemplateEntry: {
        readonly relativePath: "forbidden";
        readonly kind: "metadata";
        readonly content: "content";
    };
    readonly WorkEvent: {
        readonly schemaVersion: "metadata";
        readonly eventId: "metadata";
        readonly source: "metadata";
        readonly logicalSourceId: "metadata";
        readonly sourceDataEpoch: "metadata";
        readonly transportGeneration: "metadata";
        readonly workId: "metadata";
        readonly runId: "metadata";
        readonly sourceSequence: "metadata";
        readonly sourceRevision: "metadata";
        readonly kind: "metadata";
        readonly occurredAt: "metadata";
        readonly receivedAt: "metadata";
        readonly businessOutcome: "metadata";
        readonly summary: "content";
        readonly evidenceRefs: "metadata";
        readonly executionStarted: "metadata";
    };
    readonly WorkBinding: {
        readonly operationId: "metadata";
        readonly watchId: "metadata";
        readonly source: "metadata";
        readonly logicalSourceId: "metadata";
        readonly sourceDataEpoch: "metadata";
        readonly workId: "metadata";
        readonly runId: "metadata";
        readonly actualExecutionThreadId: "metadata";
    };
    readonly WorkWatch: {
        readonly origin: "metadata";
        readonly status: "metadata";
        readonly generation: "metadata";
        readonly preference: "metadata";
        readonly policyRevision: "metadata";
        readonly nextReportDueAt: "metadata";
        readonly 'origin.profileId': "metadata";
        readonly 'origin.threadId': "metadata";
        readonly 'origin.workspaceId': "forbidden";
        readonly 'origin.actorId': "metadata";
        readonly operationId: "metadata";
        readonly watchId: "metadata";
        readonly source: "metadata";
        readonly logicalSourceId: "metadata";
        readonly sourceDataEpoch: "metadata";
        readonly workId: "metadata";
        readonly runId: "metadata";
        readonly actualExecutionThreadId: "metadata";
    };
    readonly ActivityOrigin: {
        readonly profileId: "metadata";
        readonly threadId: "metadata";
        readonly workspaceId: "forbidden";
        readonly actorId: "metadata";
    };
    readonly WorkProjection: {
        readonly watchId: "metadata";
        readonly executionState: "metadata";
        readonly businessOutcome: "metadata";
        readonly freshness: "metadata";
        readonly sourceSequence: "metadata";
        readonly revision: "metadata";
        readonly lastProgressAt: "metadata";
        readonly lastHeartbeatAt: "metadata";
        readonly lastReportAt: "metadata";
        readonly errorCode: "metadata";
        readonly summary: "content";
        readonly evidenceRefs: "metadata";
    };
    readonly ConversationActivity: {
        readonly activityId: "metadata";
        readonly localSeq: "metadata";
        readonly watchId: "metadata";
        readonly threadId: "metadata";
        readonly kind: "metadata";
        readonly at: "metadata";
        readonly projection: "metadata";
        readonly 'projection.watchId': "metadata";
        readonly 'projection.executionState': "metadata";
        readonly 'projection.businessOutcome': "metadata";
        readonly 'projection.freshness': "metadata";
        readonly 'projection.sourceSequence': "metadata";
        readonly 'projection.revision': "metadata";
        readonly 'projection.lastProgressAt': "metadata";
        readonly 'projection.lastHeartbeatAt': "metadata";
        readonly 'projection.lastReportAt': "metadata";
        readonly 'projection.errorCode': "metadata";
        readonly 'projection.summary': "content";
        readonly 'projection.evidenceRefs': "metadata";
    };
};
export type MetadataKind = keyof typeof tables;
/** Field classification, not schema/ID validation. Unknown fields and raw workspace paths are dropped.
 * Human-written titles/task names are content and must never be added as metadata.
 * Only data properties are read; arbitrary objects cannot smuggle nested unknown fields.
 */
export declare function projectMetadataOnly(kind: MetadataKind, value: unknown): Record<string, unknown> | null;
export {};
