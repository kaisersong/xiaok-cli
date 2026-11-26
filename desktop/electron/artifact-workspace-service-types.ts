import type { FileTaskSnapshotStore } from '../../src/runtime/task-host/snapshot-store.js';
import type { TaskRuntimeHost } from '../../src/runtime/task-host/types.js';
import type { ArtifactWorkspaceQuarantineReason } from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceFileManager } from './artifact-workspace-files.js';
import { ArtifactWorkspaceStore } from './artifact-workspace-store.js';

export interface ArtifactWorkspaceFeatureFlags {
  artifactWorkspaceRevisionUi: boolean;
  artifactSpatialWorkspace: boolean;
}

export type PreparedTaskHost = Pick<TaskRuntimeHost, 'prepareTask' | 'startTask' | 'cancelTask' | 'recoverTask'>;

export interface ArtifactWorkspaceServiceOptions {
  store: ArtifactWorkspaceStore;
  snapshotStore: FileTaskSnapshotStore;
  taskHost: PreparedTaskHost;
  fileManager: ArtifactWorkspaceFileManager;
  workspaceRoot: string;
  allowedRoots?: string[];
  generationRoot?: string;
  featureFlags?: Partial<ArtifactWorkspaceFeatureFlags>;
  now?: () => number;
  createId?: (prefix: string) => string;
}

export interface ArtifactWorkspaceClaimResult {
  outcomeKind: 'ready_version' | 'staging';
  versionId?: string;
  stagingId?: string;
  quarantineReason?: ArtifactWorkspaceQuarantineReason;
}

export interface ArtifactWorkspaceChange {
  conversationId: string;
  workspaceId: string;
}
