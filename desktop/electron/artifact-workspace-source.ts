import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';
import type { ArtifactWorkspaceRequestedKind } from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceError } from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceFileError, ArtifactWorkspaceFileManager, type IngestedWorkspaceArtifact } from './artifact-workspace-files.js';

export function normalizeKind(kind: string | undefined, mimeType: string | undefined, filePath: string): string {
  const raw = (kind ?? '').toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/markdown') return 'markdown';
  if (mime.includes('presentation') || mime.includes('xiaok.slides')) return 'slides';
  if (raw === 'pdf') return 'pdf';
  if (raw === 'md' || raw === 'markdown') return 'markdown';
  if (raw === 'text' && /\.(?:md|markdown)$/i.test(filePath)) return 'markdown';
  if (raw === 'html') return 'html';
  if (raw === 'image' || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(raw)) return 'image';
  if (raw === 'slides' || raw === 'pptx') return 'slides';
  return raw || 'other';
}

export function artifactMatchesRequestedKind(
  requestedKind: ArtifactWorkspaceRequestedKind,
  artifact: { kind: string; mimeType?: string; filePath?: string },
): boolean {
  const raw = artifact.kind.toLowerCase();
  const mime = artifact.mimeType?.toLowerCase();
  if (mime) {
    if (requestedKind === 'image') return mime.startsWith('image/');
    if (requestedKind === 'html') return mime === 'text/html';
    if (requestedKind === 'markdown') return mime === 'text/markdown';
    return mime.includes('presentation') || mime.includes('xiaok.slides');
  }
  if (requestedKind === 'image' || requestedKind === 'html') return false;
  if (requestedKind === 'markdown') {
    return raw === 'markdown'
      || raw === 'md'
      || (raw === 'text' && /\.(?:md|markdown)$/i.test(artifact.filePath ?? ''));
  }
  return raw === 'slides';
}

export function mimeForPath(_filePath: string, declared?: string): string | undefined {
  if (declared) return declared;
  return undefined;
}

export function pluginSourceFromCreator(creator?: string): string | undefined {
  if (creator === 'plugin:kai-report-creator') return 'kai-report-creator';
  if (creator === 'plugin:kai-slide-creator') return 'kai-slide-creator';
  return undefined;
}

export function artifactContentMatchesKind(
  requestedKind: ArtifactWorkspaceRequestedKind,
  filePath: string,
  mimeType?: string,
): boolean {
  if (requestedKind !== 'image') return true;
  try {
    const bytes = readFileSync(filePath);
    const mime = mimeType?.toLowerCase();
    if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
    if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (mime === 'image/svg+xml') return /<svg(?:\s|>)/i.test(bytes.subarray(0, 4096).toString('utf8'));
    return false;
  } catch {
    return false;
  }
}

function sniffImageMime(filePath: string): string | undefined {
  try {
    const bytes = readFileSync(filePath);
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (/<svg(?:\s|>)/i.test(bytes.subarray(0, 4096).toString('utf8'))) return 'image/svg+xml';
    return undefined;
  } catch {
    return undefined;
  }
}

function looksLikeHtmlDocument(filePath: string): boolean {
  try {
    const prefix = readFileSync(filePath).subarray(0, 8192).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    return /^(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(prefix);
  } catch {
    return false;
  }
}

export function proveMaterializedArtifactKind(
  requestedKind: ArtifactWorkspaceRequestedKind,
  artifact: { kind: string; mimeType?: string; filePath: string },
): { mimeType?: string } | null {
  if (artifact.mimeType) {
    return artifactMatchesRequestedKind(requestedKind, artifact)
      && artifactContentMatchesKind(requestedKind, artifact.filePath, artifact.mimeType)
      ? { mimeType: artifact.mimeType }
      : null;
  }

  const raw = artifact.kind.toLowerCase();
  if (requestedKind === 'html') {
    return raw === 'html' && looksLikeHtmlDocument(artifact.filePath)
      ? { mimeType: 'text/html' }
      : null;
  }
  if (requestedKind === 'image') {
    if (raw !== 'image' && !['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(raw)) return null;
    const mimeType = sniffImageMime(artifact.filePath);
    return mimeType ? { mimeType } : null;
  }
  if (!artifactMatchesRequestedKind(requestedKind, artifact)
    || !artifactContentMatchesKind(requestedKind, artifact.filePath)) {
    return null;
  }
  return requestedKind === 'markdown' ? { mimeType: 'text/markdown' } : {};
}

export function mapFileError(error: unknown): never {
  if (error instanceof ArtifactWorkspaceFileError) {
    throw new ArtifactWorkspaceError(error.code, error.message);
  }
  throw error;
}


export function isEligibleKind(kind: string): kind is ArtifactWorkspaceRequestedKind {
  return kind === 'image' || kind === 'html' || kind === 'markdown' || kind === 'slides';
}

export function findArtifact(snapshot: TaskSnapshot, artifactId: string): {
    artifactId: string;
    kind: string;
    label: string;
    filePath?: string;
    mimeType?: string;
    creator?: string;
  } | undefined {
  const event = snapshot.events.find((candidate) => candidate.type === 'artifact_recorded' && candidate.artifactId === artifactId);
  if (event?.type === 'artifact_recorded') {
    return {
      artifactId,
      kind: event.kind,
      label: event.label,
      filePath: event.filePath,
      mimeType: event.mimeType,
      creator: event.creator,
    };
  }
  const artifact = snapshot.result?.artifacts.find((candidate) => candidate.artifactId === artifactId);
  return artifact ? {
    artifactId,
    kind: artifact.kind,
    label: artifact.title,
    filePath: artifact.filePath,
    mimeType: artifact.mimeType,
    creator: artifact.creator,
  } : undefined;
}

export function resolveAllowedSource(fileManager: ArtifactWorkspaceFileManager, allowedRoots: string[], sourcePath: string): ReturnType<ArtifactWorkspaceFileManager['resolveSourceIdentity']> & { allowedRoot: string } {
  for (const allowedRoot of allowedRoots) {
    try {
      return { ...fileManager.resolveSourceIdentity({ sourcePath, allowedRoot }), allowedRoot };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      if (!(error instanceof ArtifactWorkspaceFileError) || error.code !== 'invalid_target') throw error;
    }
  }
  throw new ArtifactWorkspaceFileError('invalid_target', 'artifact source is outside app-managed roots');
}

export function ingestArtifactSource(
  fileManager: ArtifactWorkspaceFileManager,
  generationRoot: string,
  input: {
    sourcePath: string;
    allowedRoot: string;
    stagingId: string;
    kind: string;
    mimeType?: string;
  },
): IngestedWorkspaceArtifact {
  const sourceStat = statSync(input.sourcePath);
  if (sourceStat.isDirectory()) {
    const entryRef = ['index.html', 'slides.html', 'output.html', 'report.html']
      .find(candidate => existsSync(join(input.sourcePath, candidate)));
    if (!entryRef) throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package has no supported entry');
    return fileManager.ingestSealedPackage({
      sourceDirectory: input.sourcePath,
      allowedRoot: input.allowedRoot,
      stagingId: input.stagingId,
      entryRef,
      kind: input.kind,
      mimeType: input.mimeType,
    });
  }
  if (input.kind === 'slides') {
    const packageInput = join(generationRoot, `.package-input-${input.stagingId}`);
    mkdirSync(packageInput, { recursive: false });
    const entryRef = 'index.html';
    try {
      copyFileSync(input.sourcePath, join(packageInput, entryRef));
      return fileManager.ingestSealedPackage({
        sourceDirectory: packageInput,
        allowedRoot: generationRoot,
        stagingId: input.stagingId,
        entryRef,
        kind: input.kind,
        mimeType: input.mimeType,
      });
    } finally {
      rmSync(packageInput, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  return fileManager.ingestSingleFile(input);
}
