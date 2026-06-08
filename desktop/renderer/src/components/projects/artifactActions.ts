import type { KSwarmArtifact } from '../../hooks/useKSwarmClient';

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
    artifact.name ||
    artifact.filename ||
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
    if (isAbsoluteUrl(rawUrl) && !rawUrl.startsWith('file:')) return rawUrl;
    const projectArtifactName = projectId ? projectArtifactFilenameFromReference(rawUrl) : '';
    if (projectId && projectArtifactName) return projectArtifactUrl(projectId, projectArtifactName);
    if (rawUrl.startsWith('/')) return `${getKswarmBaseUrl()}${rawUrl}`;
    return rawUrl;
  }

  const rawPath = artifact.path?.trim();
  const rawRelativePath = artifact.relativePath?.trim();
  const projectArtifactName = artifact.filename?.trim()
    || projectArtifactFilenameFromReference(rawRelativePath)
    || projectArtifactFilenameFromReference(rawPath)
    || basename(rawRelativePath)
    || basename(rawPath)
    || artifact.name?.trim();
  if (projectId && projectArtifactName) {
    return projectArtifactUrl(projectId, projectArtifactName);
  }

  if (rawPath) {
    if (rawPath.startsWith('file://')) return rawPath;
    return `file://${rawPath}`;
  }

  const filename = (artifact.filename || artifact.name)?.trim();
  if (projectId && filename) {
    return projectArtifactUrl(projectId, filename);
  }

  return null;
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
  const time = coerceTime(artifact.generatedAt ?? artifact.createdAt ?? artifact.updatedAt);
  if (time === null) return null;
  const date = new Date(time);
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

function projectArtifactUrl(projectId: string, filename: string): string {
  return `${getKswarmBaseUrl()}/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(filename)}`;
}

function projectArtifactFilenameFromReference(value?: string): string {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized.startsWith('artifacts/') ||
    normalized.includes('/artifacts/') ||
    normalized.includes('/.kswarm/projects/')
  ) {
    return basename(normalized);
  }
  return '';
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

function coerceTime(value: number | string | undefined): number | null {
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
