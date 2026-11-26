import { existsSync } from 'node:fs';
import { ArtifactWorkspaceFileManager } from './artifact-workspace-files.js';
import { ArtifactWorkspaceStore } from './artifact-workspace-store.js';
import { ARTIFACT_WORKSPACE_STAGING_RETENTION_MS } from './artifact-workspace-constants.js';
import type { ArtifactWorkspaceFeatureFlags } from './artifact-workspace-service-types.js';

export function cleanup(store: ArtifactWorkspaceStore, flags: ArtifactWorkspaceFeatureFlags, fileManager: ArtifactWorkspaceFileManager, now: () => number, input: { activeViewKeys?: Set<string> } = {}): { stagingRows: number; secondaryViews: number } {
  const cutoff = now() - ARTIFACT_WORKSPACE_STAGING_RETENTION_MS;
  let stagingRows = 0;
  for (const entry of store.listStagingFiles()) {
    if (!flags.artifactWorkspaceRevisionUi && !flags.artifactSpatialWorkspace) break;
    if (entry.keep || Date.parse(entry.expiresAt) > now()) continue;
    const request = entry.generationRequestId ? store.getGenerationRequest(entry.generationRequestId) : undefined;
    if (request && ['prepared', 'running', 'needs_recovery'].includes(request.state)) continue;
    if (entry.fileRef) fileManager.removeManagedRef(entry.fileRef);
    const requestWorkspaceId = request?.workspaceId;
    store.deleteStagingFile(entry.id);
    store.recordAudit({
      actorKind: 'system_reconcile', workspaceId: requestWorkspaceId,
      producingTaskId: entry.producingTaskId,
      action: 'cleanup_staging', result: 'success', errorCode: entry.quarantineReason,
    });
    stagingRows++;
  }
  const secondaryViews = store.cleanupSecondaryViews({
    before: new Date(cutoff).toISOString(),
    activeViewKeys: input.activeViewKeys ?? new Set(),
  });
  if (secondaryViews > 0) {
    store.recordAudit({
      actorKind: 'system_reconcile', action: 'cleanup_secondary_views', result: 'success',
    });
  }
  return { stagingRows, secondaryViews };
}

export function reconcileStagingRegistry(store: ArtifactWorkspaceStore, fileManager: ArtifactWorkspaceFileManager): void {
  for (const staging of store.listStagingFiles()) {
    if (staging.availability !== 'present' || !staging.fileRef) continue;
    const currentPath = fileManager.resolveManagedRef(staging.fileRef);
    if (existsSync(currentPath)) continue;
    let finalRef: string;
    try {
      finalRef = fileManager.finalRefForStagingRef(staging.fileRef);
    } catch {
      continue;
    }
    if (!existsSync(fileManager.resolveManagedRef(finalRef))) continue;
    store.updateStagingFile({
      id: staging.id,
      fileRef: finalRef,
      quarantineReason: 'commit_recovery',
    });
  }
}
