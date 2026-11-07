import type { ArtifactSummary, TaskResult } from '../../../shared/task-types';
import { isA2UIMimeType } from '../../../../src/a2ui/index';
import { filePathIdentity, normalizeClipboardFilePath } from './file-path';

export function isInlineUiArtifact(artifact: ArtifactSummary): boolean {
  return artifact.kind === 'a2ui' || isA2UIMimeType(artifact.mimeType)
    || artifact.title.endsWith('.a2ui.json') || Boolean(artifact.filePath?.endsWith('.a2ui.json'));
}

export function inlineUiKey(artifact: ArtifactSummary): string {
  return JSON.stringify([artifact.sourceTaskId ?? '', artifact.artifactId]);
}

/** Presentation only: durable artifacts stay with the main-owned task result. */
export function separateInlineUiOutputs<T extends { filePath: string }>(result: TaskResult | null, files: T[]) {
  const inlineArtifacts = result?.artifacts.filter(isInlineUiArtifact) ?? [];
  const paths = new Set(inlineArtifacts.flatMap(artifact => artifact.filePath
    ? [filePathIdentity(normalizeClipboardFilePath(artifact.filePath))] : []));
  return {
    inlineArtifacts,
    result: result ? { ...result, artifacts: result.artifacts.filter(artifact => !isInlineUiArtifact(artifact)) } : null,
    generatedFiles: files.filter(file => !paths.has(filePathIdentity(normalizeClipboardFilePath(file.filePath)))),
  };
}
