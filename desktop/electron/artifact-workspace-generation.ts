import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ArtifactGenerationTarget, ArtifactWorkspaceExecutionScope, TaskSnapshot } from '../../src/runtime/task-host/types.js';
import type { ArtifactWorkspaceRequestedKind, ArtifactWorkspaceVersion } from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceFileManager } from './artifact-workspace-files.js';
import { ArtifactWorkspaceStore } from './artifact-workspace-store.js';
import { ARTIFACT_WORKSPACE_LEASE_GRACE_MS, ARTIFACT_WORKSPACE_LEASE_DURATION_MS, ARTIFACT_WORKSPACE_LEASE_EXTENSION_MS, ARTIFACT_WORKSPACE_LEASE_MAX_TOTAL_EXTENSION_MS, ARTIFACT_WORKSPACE_RECOVERY_TIMEOUT_MS } from './artifact-workspace-constants.js';

export class ArtifactWorkspaceRecoveryTimeout extends Error {}

export async function withRecoveryTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ArtifactWorkspaceRecoveryTimeout('artifact workspace recovery timed out')),
          ARTIFACT_WORKSPACE_RECOVERY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function snapshotReportsPluginUnavailable(snapshot: TaskSnapshot): boolean {
  return snapshot.events.some((event) => (
    event.type === 'canvas_tool_result'
    && typeof event.response === 'string'
    && event.response.includes('plugin_unavailable')
  ));
}

export function buildGenerationPrompt(
  prompt: string,
  kind: ArtifactWorkspaceRequestedKind,
  leaseId: string,
  generationTaskRoot: string,
  allowedAction: 'fulfill_placeholder' | 'append_revision' | 'append_collection_item',
  sourceCopyPath?: string,
  target?: ArtifactGenerationTarget,
): string {
  return [
    prompt,
    '',
    `目标产物类型：${kind}`,
    target ? `不可变目标描述：${JSON.stringify(target)}` : '',
    sourceCopyPath ? `不可变来源副本：${sourceCopyPath}。只读取该副本，不修改 workspace 原始版本。` : '',
    `产物必须写入此任务专用目录：${generationTaskRoot}`,
    kind === 'html'
      ? 'HTML/report 最终文件只能调用 render_report_artifact，由 kai-report-creator 生成；严禁手写 HTML 作为降级结果。'
      : '',
    kind === 'slides'
      ? 'Slides 最终文件只能调用 mcp__slide-renderer__render_slide，由 kai-slide-creator 生成；严禁手写 HTML 作为降级结果。'
      : '',
    `如需多步编辑，先使用 .draft 或 .tmp 文件；只有内容最终完成后才写目标类型文件，并使用写入工具返回的 artifactId 调用一次 artifact_workspace_${allowedAction} 登记工具。`,
    `完成后只能调用与当前任务 executionScope 匹配的 artifact_workspace_* 工具登记产物；leaseId=${leaseId}。`,
    '严禁提交任意路径、其他任务产物或修改来源版本。',
  ].filter(Boolean).join('\n');
}

export function copyVersionForGeneration(fileManager: ArtifactWorkspaceFileManager, version: ArtifactWorkspaceVersion, generationTaskRoot: string): string {
  const sourcePath = fileManager.resolveManagedRef(version.fileRef);
  if (!existsSync(sourcePath)) throw new Error('revision source bytes are missing');
  const sourceRoot = join(generationTaskRoot, 'source');
  mkdirSync(sourceRoot, { recursive: true });
  if (version.storageKind === 'sealed_package') {
    const packageRoot = join(sourceRoot, 'package');
    cpSync(sourcePath, packageRoot, { recursive: true, errorOnExist: true });
    return join(packageRoot, ...(version.entryRef ?? '').split(/[\\/]+/));
  }
  const destination = join(sourceRoot, basename(sourcePath));
  copyFileSync(sourcePath, destination);
  return destination;
}

export function maybeExtendLease(store: ArtifactWorkspaceStore, now: () => number, scope: ArtifactWorkspaceExecutionScope, snapshot: TaskSnapshot): void {
  if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') return;
  const lease = store.getLease(scope.leaseId);
  if (!lease || lease.cancelledAt || lease.consumedAt) return;
  const request = store.getGenerationRequest(lease.generationRequestId);
  if (request?.state !== 'running') return;
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiresAt) || now() >= expiresAt || expiresAt - now() > ARTIFACT_WORKSPACE_LEASE_GRACE_MS) return;
  const originalExpiry = Date.parse(lease.createdAt) + ARTIFACT_WORKSPACE_LEASE_DURATION_MS;
  const maximumExpiry = originalExpiry + ARTIFACT_WORKSPACE_LEASE_MAX_TOTAL_EXTENSION_MS;
  const nextExpiry = Math.min(expiresAt + ARTIFACT_WORKSPACE_LEASE_EXTENSION_MS, maximumExpiry);
  if (nextExpiry <= expiresAt) return;
  store.extendLease({ leaseId: lease.id, expiresAt: new Date(nextExpiry).toISOString() });
  store.recordAudit({
    actorKind: 'agent', requestSource: 'agent', workspaceId: lease.workspaceId,
    nodeId: lease.nodeId, producingTaskId: lease.producingTaskId,
    action: 'generation_lease_extended', result: 'success',
  });
}
