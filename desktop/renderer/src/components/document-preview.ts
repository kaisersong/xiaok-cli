import type { ArtifactRef } from '../storage'

const textLikeMimeTypes = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/typescript',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/x-toml',
  'application/markdown',
  'application/x-markdown',
])

const textFallbackExtensions = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'csv', 'tsv', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'css', 'html', 'htm', 'sh', 'bash', 'zsh',
  'py', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'sql',
])

function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function getFilenameExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).trim().toLowerCase()
}

function isTextMime(mime: string | null | undefined): boolean {
  const normalized = normalizeMime(mime)
  return normalized.startsWith('text/') || textLikeMimeTypes.has(normalized)
}

const iframeRenderableMimes = new Set(['text/html', 'image/svg+xml'])
const iframeRenderableExtensions = new Set(['html', 'htm', 'svg'])

export function shouldRenderAsIframe(artifact: ArtifactRef): boolean {
  if (iframeRenderableMimes.has(normalizeMime(artifact.mime_type))) return true
  return iframeRenderableExtensions.has(getFilenameExtension(artifact.filename))
}

export function canPreviewDocumentAsText(serverMime: string | null | undefined, artifactMime: string | null | undefined, filename: string): boolean {
  if (isTextMime(serverMime) || isTextMime(artifactMime)) return true

  const normalizedServerMime = normalizeMime(serverMime)
  const normalizedArtifactMime = normalizeMime(artifactMime)
  const shouldUseExtensionFallback = normalizedServerMime === ''
    || normalizedServerMime === 'application/octet-stream'
    || normalizedArtifactMime === ''
    || normalizedArtifactMime === 'application/octet-stream'

  if (!shouldUseExtensionFallback) return false
  return textFallbackExtensions.has(getFilenameExtension(filename))
}
