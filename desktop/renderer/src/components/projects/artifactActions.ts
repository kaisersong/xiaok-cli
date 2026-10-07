import type { KSwarmArtifact } from '../../hooks/useKSwarmClient';
import { fileBasename, isAbsoluteFilePath, normalizeClipboardFilePath, toFileUrl } from '../../lib/file-path';

function getKswarmBaseUrl(): string {
  return 'http://127.0.0.1:4400';
}

type ArtifactLike = Partial<KSwarmArtifact> & {
  filename?: string;
  relativePath?: string;
  projectId?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  generatedAt?: number | string;
};

export function artifactDisplayName(artifact: ArtifactLike): string {
  return (
    fileBasename(artifact.name) ||
    fileBasename(artifact.filename) ||
    basename(artifact.path) ||
    basename(artifact.url) ||
    basename(artifact.relativePath) ||
    'artifact'
  );
}

export function resolveArtifactUrl(artifact: ArtifactLike): string | null {
  const projectId = artifact.projectId?.trim();
  const rawUrl = artifact.url?.trim();
  if (rawUrl) {
    if (isAbsoluteUrl(rawUrl) && !rawUrl.startsWith('file:') && !isAbsoluteFilePath(rawUrl)) return rawUrl;
    const route = rawUrl.match(/^\/projects\/([^/]+)\/artifacts\/(.+)$/);
    if (route) return projectArtifactUrl(decodeReference(route[1]), decodeReference(route[2]).replace(/^(artifacts\/)+/, ''));
    const name = projectArtifactFilenameFromReference(rawUrl);
    if (projectId && name) return projectArtifactUrl(projectId, name);
    if (rawUrl.startsWith('/')) return `${getKswarmBaseUrl()}${rawUrl}`;
    return rawUrl;
  }
  const rawPath = artifact.path?.trim();
  const rawRelativePath = artifact.relativePath?.trim();
  const filename = artifact.filename?.trim();
  const nestedFilename = filename && /[\\/]/.test(filename) && !isAbsoluteFilePath(filename) ? filename : '';
  const name = projectArtifactFilenameFromReference(rawRelativePath)
    || nestedFilename || projectArtifactFilenameFromReference(rawPath)
    || filename || basename(rawRelativePath) || (!rawPath ? artifact.name?.trim() : '');
  if (projectId && name) return projectArtifactUrl(projectId, name);
  if (rawPath) return rawPath.startsWith('file://') ? rawPath : toFileUrl(rawPath);
  if (projectId && artifact.name) return projectArtifactUrl(projectId, artifact.name);
  return null;
}

export function resolveArtifactProxyPath(artifact: ArtifactLike): string | null {
  const url = resolveArtifactUrl(artifact);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.origin !== getKswarmBaseUrl()) return null;
    if (!/^\/projects\/[^/]+\/artifacts\/.+/.test(parsed.pathname)) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

export function downloadArtifact(artifact: ArtifactLike): boolean {
  const url = resolveArtifactUrl(artifact);
  if (!url) return false;

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifactDisplayName(artifact);
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }
}

export function formatArtifactGeneratedTime(artifact: ArtifactLike): string | null {
  const time = coerceArtifactTime(artifact.generatedAt ?? artifact.createdAt ?? artifact.updatedAt);
  if (time === null) return null;
  const date = new Date(time);
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

function projectArtifactUrl(projectId: string, filename: string): string {
  const path = filename.replace(/\\+/g, '/').split('/').map(encodeURIComponent).join('/');
  return `${getKswarmBaseUrl()}/projects/${encodeURIComponent(projectId)}/artifacts/${path}`;
}

function projectArtifactFilenameFromReference(value?: string): string {
  if (!value) return '';
  const normalized = normalizeClipboardFilePath(value).replace(/\\+/g, '/');
  if (normalized.startsWith('artifacts/')) return normalized.slice('artifacts/'.length);
  const index = normalized.indexOf('/artifacts/');
  if (index >= 0) return normalized.slice(index + '/artifacts/'.length);
  if (!isAbsoluteFilePath(normalized) && !isAbsoluteUrl(normalized)) return normalized;
  return '';
}

function decodeReference(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function basename(value?: string): string {
  if (!value) return '';
  const withoutQuery = value.split(/[?#]/, 1)[0] || '';
  const normalized = withoutQuery.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  const name = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function coerceArtifactTime(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
