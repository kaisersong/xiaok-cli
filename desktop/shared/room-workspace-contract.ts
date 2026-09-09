/** Renderer receives projections only; main authenticates every operation. */
export interface RoomWorkspaceRequest { roomId: string }
export interface RoomWorkspaceScope { kind: 'room_only' | 'project'; projectId?: string }
export interface RoomWorkspaceArtifact {
  artifactId: string; versionId: string; relativePath: string; state: string;
  bindingId: string; generation: number; contentHash?: string; size?: number;
  producerAgentId?: string; producerRunId?: string; producerDisplayName?: string; producerType?: 'user' | 'unknown' | 'agent';
  projectId?: string; synchronization?: 'pending' | 'synced';
}
export interface RoomWorkspaceSnapshot {
  ok: boolean; code?: string; phase: string; revision: number;
  permissions: { canManage: boolean; canRead: boolean; canReadArtifacts?: boolean; canRegister?: boolean };
  workspaceId?: string; bindingId?: string; generation?: number; rootDisplayPath?: string; operationId?: string;
  instructions?: { revision: number; publishedText: string; sourceRelativePath?: string; sourceHash?: string;
    sourceChanged?: boolean; candidateText?: string; candidateHash?: string };
  claims: Array<{ claimId: string; runId: string; executionState: string; authorizationState: string;
    instructionsRevision: number; agentName?: string; executorInstanceId?: string; projectId?: string }>;
  artifacts: RoomWorkspaceArtifact[];
  projectMappings?: Array<{ projectId: string; name?: string; state: string; mappingRevision?: number; projectRevision?: number; workFolderRelativePath?: string; artifactsRelativePath?: string }>;
}
export interface RoomWorkspaceChangeInput extends RoomWorkspaceRequest {
  expectedRevision: number; mode: 'existing' | 'create' | 'unset'; selectedPath?: string; directoryName?: string;
  templateEntries: Array<{ relativePath: string; kind: 'directory' | 'file'; content?: string }>;
  instructionsText?: string;
}
export interface RoomWorkspacePreview {
  ok: boolean; code?: string; previewId?: string; canCommit: boolean;
  changes: Array<{ relativePath: string; kind: 'directory' | 'file'; action: 'create' | 'existing'; content?: string }>;
  conflicts: string[]; overlaps: string[];
}
export interface RoomWorkspaceMutationResult { ok: boolean; code?: string; operationId?: string; snapshot?: RoomWorkspaceSnapshot }
export interface RoomWorkspaceFileRequest extends RoomWorkspaceRequest { bindingId: string; generation: number; relativePath: string }
export interface RoomWorkspaceFilePage { ok: boolean; code?: string; entries: Array<{ relativePath: string; name: string; kind: 'directory' | 'file'; size?: number; state?: string }>; nextCursor?: string }
export interface RoomWorkspaceFilePreview { ok: boolean; code?: string; state?: 'current' | 'changed' | 'missing'; text?: string; truncated?: boolean; mimeType?: string; contentHash?: string }
export interface RoomWorkspaceApi {
  retryCollaborationRoomWorkspaceChange(input: RoomWorkspaceRequest & { operationId: string; expectedRevision: number; idempotencyKey: string }): Promise<RoomWorkspaceMutationResult>;
  mapCollaborationRoomWorkspaceProject(input: RoomWorkspaceRequest & { projectId: string; expectedRevision: number; expectedProjectRevision: number; idempotencyKey: string; workFolderRelativePath: string; artifactsRelativePath: string }): Promise<RoomWorkspaceMutationResult>;
  getCollaborationRoomWorkspace(input: RoomWorkspaceRequest): Promise<RoomWorkspaceSnapshot>;
  previewCollaborationRoomWorkspace(input: RoomWorkspaceChangeInput): Promise<RoomWorkspacePreview>;
  commitCollaborationRoomWorkspace(input: RoomWorkspaceRequest & { previewId: string; expectedRevision: number; idempotencyKey: string; confirmOverlap: boolean; confirmSharedReadGrant: boolean }): Promise<RoomWorkspaceMutationResult>;
  cancelCollaborationRoomWorkspaceChange(input: RoomWorkspaceRequest & { operationId: string; expectedRevision: number; idempotencyKey: string }): Promise<RoomWorkspaceMutationResult>;
  listCollaborationRoomWorkspaceFiles(input: RoomWorkspaceFileRequest & { cursor?: string }): Promise<RoomWorkspaceFilePage>;
  previewCollaborationRoomWorkspaceFile(input: RoomWorkspaceFileRequest & { versionId?: string }): Promise<RoomWorkspaceFilePreview>;
  publishCollaborationRoomWorkspaceInstructions(input: RoomWorkspaceRequest & { expectedRevision: number; idempotencyKey: string; publishedText: string; sourceRelativePath?: string; sourceHash?: string }): Promise<RoomWorkspaceMutationResult>;
  confirmCollaborationRoomWorkspaceArtifact(input: RoomWorkspaceRequest & { artifactId: string; versionId: string; expectedRevision: number; idempotencyKey: string }): Promise<RoomWorkspaceMutationResult>;
  registerCollaborationRoomWorkspaceArtifact(input: RoomWorkspaceFileRequest & { expectedRevision: number; idempotencyKey: string }): Promise<RoomWorkspaceMutationResult>;
}
