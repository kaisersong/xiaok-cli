import { app, BrowserWindow, clipboard, dialog, shell, systemPreferences, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open as openFile, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';
import type { DesktopLoopRuntime } from './loop-executor.js';
import type { MeetingTranscriber } from './meeting-service.js';
import type { CreateUserLoopTemplateInput, UserLoopTemplate } from './loop-types.js';
import { isSafeLoopOutputFileName } from './loop-output-paths.js';
import { createMeetingAudioPermissionService } from './meeting-audio-permission.js';
import type { ArtifactWorkspaceErrorCode } from '../shared/artifact-workspace-types.js';

type DesktopServices = ReturnType<typeof createDesktopServices>;

const ARTIFACT_WORKSPACE_ERROR_CODES = new Set<ArtifactWorkspaceErrorCode>([
  'workspace_not_found',
  'artifact_not_found',
  'structure_revision_conflict',
  'layout_revision_conflict',
  'version_referenced',
  'permission_denied',
  'invalid_target',
  'artifact_kind_mismatch',
  'artifact_too_large',
  'artifact_package_invalid',
  'plugin_unavailable',
  'runtime_unavailable',
  'artifact_missing',
  'feature_disabled',
  'generation_conflict',
]);

const ARTIFACT_WORKSPACE_ALLOWED_FIELDS = {
  getArtifactWorkspaceSnapshot: ['conversationId', 'workspaceRootId', 'selectedArtifact'],
  closeArtifactWorkspace: ['conversationId', 'workspaceRootId'],
  readArtifactWorkspaceVersionPreview: ['conversationId', 'workspaceRootId', 'versionId'],
  exportArtifactWorkspaceVersion: ['conversationId', 'workspaceRootId', 'versionId'],
  createArtifactPlaceholder: ['conversationId', 'workspaceRootId', 'requestedKind', 'title', 'x', 'y', 'expectedStructureRevision'],
  submitArtifactGeneration: ['conversationId', 'workspaceRootId', 'placeholderNodeId', 'prompt', 'sourceVersionId', 'selectedArtifact', 'requestedKind', 'expectedStructureRevision'],
  cancelArtifactGeneration: ['conversationId', 'workspaceRootId', 'generationRequestId'],
  retryArtifactGeneration: ['conversationId', 'workspaceRootId', 'generationRequestId', 'prompt'],
  preferArtifactVersion: ['conversationId', 'workspaceRootId', 'lineageId', 'versionId', 'expectedStructureRevision'],
  removeArtifactWorkspaceNode: ['conversationId', 'workspaceRootId', 'nodeId', 'expectedStructureRevision'],
  updateArtifactWorkspaceLayout: ['conversationId', 'workspaceRootId', 'patches'],
  saveArtifactWorkspaceViewport: ['conversationId', 'workspaceRootId', 'viewport', 'expectedViewRevision'],
  createArtifactWorkspaceCollection: ['conversationId', 'workspaceRootId', 'title', 'x', 'y', 'expectedStructureRevision'],
  createArtifactWorkspaceNote: ['conversationId', 'workspaceRootId', 'title', 'noteText', 'x', 'y', 'expectedStructureRevision'],
  updateArtifactWorkspaceNote: ['conversationId', 'workspaceRootId', 'nodeId', 'noteText', 'expectedStructureRevision'],
  createArtifactWorkspaceRelation: ['conversationId', 'workspaceRootId', 'fromNodeId', 'toNodeId', 'kind', 'order', 'expectedStructureRevision'],
  setArtifactCollectionMembership: ['conversationId', 'workspaceRootId', 'collectionNodeId', 'memberNodeId', 'included', 'order', 'expectedStructureRevision'],
  recordArtifactWorkspaceEvent: ['conversationId', 'workspaceRootId', 'eventName', 'requestId', 'dedupeKey', 'metadata'],
} as const;

const ARTIFACT_WORKSPACE_REQUIRED_FIELDS: Record<ArtifactWorkspaceOperation, readonly string[]> = {
  getArtifactWorkspaceSnapshot: [],
  closeArtifactWorkspace: [],
  readArtifactWorkspaceVersionPreview: ['versionId'],
  exportArtifactWorkspaceVersion: ['versionId'],
  createArtifactPlaceholder: ['requestedKind', 'expectedStructureRevision'],
  submitArtifactGeneration: ['prompt'],
  cancelArtifactGeneration: ['generationRequestId'],
  retryArtifactGeneration: ['generationRequestId'],
  preferArtifactVersion: ['lineageId', 'versionId', 'expectedStructureRevision'],
  removeArtifactWorkspaceNode: ['nodeId', 'expectedStructureRevision'],
  updateArtifactWorkspaceLayout: ['patches'],
  saveArtifactWorkspaceViewport: ['viewport'],
  createArtifactWorkspaceCollection: ['title', 'expectedStructureRevision'],
  createArtifactWorkspaceNote: ['noteText', 'expectedStructureRevision'],
  updateArtifactWorkspaceNote: ['nodeId', 'noteText', 'expectedStructureRevision'],
  createArtifactWorkspaceRelation: ['fromNodeId', 'toNodeId', 'kind', 'expectedStructureRevision'],
  setArtifactCollectionMembership: ['collectionNodeId', 'memberNodeId', 'included', 'expectedStructureRevision'],
  recordArtifactWorkspaceEvent: ['eventName'],
};

const ARTIFACT_WORKSPACE_REQUESTED_KINDS = new Set(['image', 'html', 'markdown', 'slides']);
const ARTIFACT_WORKSPACE_RELATION_KINDS = new Set(['derived_from', 'references', 'part_of_collection']);
const ARTIFACT_WORKSPACE_EVENT_NAMES = new Set([
  'revision_compare_opened',
  'revision_branched',
]);

type ArtifactWorkspaceOperation = keyof typeof ARTIFACT_WORKSPACE_ALLOWED_FIELDS;
type ArtifactWorkspaceIpcRecord = Record<string, unknown>;

type ArtifactWorkspaceDesktopServices = Record<
  ArtifactWorkspaceOperation,
  (input: ArtifactWorkspaceIpcRecord, viewKey?: string) => unknown
> & {
  subscribeArtifactWorkspaceChanges?: (listener: (change: { conversationId: string; workspaceId: string }) => void) => () => void;
  closeArtifactWorkspaceViewKey?: (viewKey: string) => number;
};

function isRecordValue(value: unknown): value is ArtifactWorkspaceIpcRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(input: ArtifactWorkspaceIpcRecord, key: string): void {
  if (typeof input[key] !== 'string' || !(input[key] as string).trim()) {
    throw Object.assign(new Error(`Invalid artifact workspace field: ${key}`), { code: 'invalid_target' });
  }
}

function validateOptionalPrimitiveFields(input: ArtifactWorkspaceIpcRecord): void {
  const stringFields = [
    'versionId', 'requestedKind', 'title', 'placeholderNodeId', 'prompt', 'sourceVersionId',
    'generationRequestId', 'lineageId', 'nodeId', 'noteText', 'fromNodeId', 'toNodeId',
    'kind', 'collectionNodeId', 'memberNodeId', 'eventName', 'requestId', 'dedupeKey',
  ];
  for (const key of stringFields) {
    if (key in input && typeof input[key] !== 'string') {
      throw Object.assign(new Error(`Invalid artifact workspace field: ${key}`), { code: 'invalid_target' });
    }
  }
  for (const key of ['x', 'y', 'order', 'expectedStructureRevision', 'expectedViewRevision']) {
    if (key in input && (typeof input[key] !== 'number' || !Number.isFinite(input[key]))) {
      throw Object.assign(new Error(`Invalid artifact workspace field: ${key}`), { code: 'invalid_target' });
    }
  }
  if ('included' in input && typeof input.included !== 'boolean') {
    throw Object.assign(new Error('Invalid artifact workspace field: included'), { code: 'invalid_target' });
  }
}

function validateArtifactWorkspaceNestedFields(input: ArtifactWorkspaceIpcRecord): void {
  for (const artifactField of ['selectedArtifact'] as const) {
    if (!(artifactField in input)) continue;
    if (!isRecordValue(input[artifactField])) {
      throw Object.assign(new Error(`Invalid artifact workspace field: ${artifactField}`), { code: 'invalid_target' });
    }
    const selected = input[artifactField];
    requireNonEmptyString(selected, 'artifactId');
    for (const key of ['sourceTaskId', 'kind', 'mimeType', 'title']) {
      if (key in selected && typeof selected[key] !== 'string') {
        throw Object.assign(new Error(`Invalid artifact workspace selected artifact field: ${key}`), { code: 'invalid_target' });
      }
    }
    input[artifactField] = Object.fromEntries(
      ['artifactId', 'sourceTaskId', 'kind', 'mimeType', 'title']
        .filter((key) => key in selected)
        .map((key) => [key, selected[key]]),
    );
  }
  if ('patches' in input) {
    if (!Array.isArray(input.patches)) {
      throw Object.assign(new Error('Invalid artifact workspace field: patches'), { code: 'invalid_target' });
    }
    input.patches = input.patches.map((value) => {
      if (!isRecordValue(value)) {
        throw Object.assign(new Error('Invalid artifact workspace layout patch'), { code: 'invalid_target' });
      }
      requireNonEmptyString(value, 'nodeId');
      for (const key of ['x', 'y', 'zIndex', 'expectedLayoutRevision']) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
          throw Object.assign(new Error(`Invalid artifact workspace layout field: ${key}`), { code: 'invalid_target' });
        }
      }
      return {
        nodeId: value.nodeId,
        x: value.x,
        y: value.y,
        zIndex: value.zIndex,
        expectedLayoutRevision: value.expectedLayoutRevision,
      };
    });
  }
  if ('viewport' in input) {
    if (!isRecordValue(input.viewport)) {
      throw Object.assign(new Error('Invalid artifact workspace field: viewport'), { code: 'invalid_target' });
    }
    const viewport = input.viewport;
    for (const key of ['x', 'y', 'zoom']) {
      if (typeof viewport[key] !== 'number' || !Number.isFinite(viewport[key])) {
        throw Object.assign(new Error(`Invalid artifact workspace viewport field: ${key}`), { code: 'invalid_target' });
      }
    }
    input.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }
  if ('metadata' in input) {
    if (!isRecordValue(input.metadata)) {
      throw Object.assign(new Error('Invalid artifact workspace field: metadata'), { code: 'invalid_target' });
    }
    const metadata: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(input.metadata)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw Object.assign(new Error(`Invalid artifact workspace metadata field: ${key}`), { code: 'invalid_target' });
      }
      metadata[key] = value as string | number | boolean | null;
    }
    input.metadata = metadata;
  }
}

export function sanitizeArtifactWorkspaceIpcInput(
  operation: ArtifactWorkspaceOperation,
  rawInput: unknown,
): ArtifactWorkspaceIpcRecord {
  if (!isRecordValue(rawInput)) {
    throw Object.assign(new Error('Artifact workspace input must be an object'), { code: 'invalid_target' });
  }
  const input = Object.fromEntries(
    ARTIFACT_WORKSPACE_ALLOWED_FIELDS[operation]
      .filter((key) => key in rawInput)
      .map((key) => [key, rawInput[key]]),
  );
  requireNonEmptyString(input, 'conversationId');
  // Renderer-supplied paths/roots are never authorization input. Keep the
  // legacy field in the wire allowlist for compatibility, then overwrite it
  // with a main-owned stable opaque identity.
  input.workspaceRootId = 'desktop-artifact-workspace-v1';
  for (const key of ARTIFACT_WORKSPACE_REQUIRED_FIELDS[operation]) {
    if (!(key in input)) {
      throw Object.assign(new Error(`Missing artifact workspace field: ${key}`), { code: 'invalid_target' });
    }
    if (typeof input[key] === 'string') requireNonEmptyString(input, key);
  }
  validateOptionalPrimitiveFields(input);
  validateArtifactWorkspaceNestedFields(input);
  if ('requestedKind' in input && !ARTIFACT_WORKSPACE_REQUESTED_KINDS.has(input.requestedKind as string)) {
    throw Object.assign(new Error('Invalid artifact workspace field: requestedKind'), { code: 'invalid_target' });
  }
  if (operation === 'submitArtifactGeneration' && !input.placeholderNodeId && !input.sourceVersionId && !input.selectedArtifact) {
    throw Object.assign(new Error('Artifact generation needs placeholderNodeId, sourceVersionId or selectedArtifact'), { code: 'invalid_target' });
  }
  if (operation === 'createArtifactWorkspaceRelation' && !ARTIFACT_WORKSPACE_RELATION_KINDS.has(input.kind as string)) {
    throw Object.assign(new Error('Invalid artifact workspace field: kind'), { code: 'invalid_target' });
  }
  if ('eventName' in input && !ARTIFACT_WORKSPACE_EVENT_NAMES.has(input.eventName as string)) {
    throw Object.assign(new Error('Invalid artifact workspace field: eventName'), { code: 'invalid_target' });
  }
  return input;
}

function artifactWorkspaceErrorCode(error: unknown): ArtifactWorkspaceErrorCode {
  if (isRecordValue(error) && typeof error.code === 'string' && ARTIFACT_WORKSPACE_ERROR_CODES.has(error.code as ArtifactWorkspaceErrorCode)) {
    return error.code as ArtifactWorkspaceErrorCode;
  }
  return 'runtime_unavailable';
}

export function normalizeArtifactWorkspaceIpcError(error: unknown): {
  ok: false;
  error: { code: ArtifactWorkspaceErrorCode; message: string; canonical?: unknown };
} {
  const record = isRecordValue(error) ? error : {};
  const canonical = record.canonical ?? record.canonicalSnapshot ?? record.canonicalNodes;
  const code = artifactWorkspaceErrorCode(error);
  return {
    ok: false,
    error: {
      code,
      message: code !== 'runtime_unavailable' && typeof record.message === 'string' && record.message
        ? record.message
        : 'Artifact workspace operation failed',
      ...(canonical === undefined ? {} : { canonical }),
    },
  };
}

function sanitizeArtifactWorkspacePreviewOutput(value: unknown): unknown {
  if (!isRecordValue(value)) return value;
  const output = Object.fromEntries(
    ['versionId', 'kind', 'mimeType', 'title', 'contentKind', 'content']
      .filter((key) => key in value)
      .map((key) => [key, value[key]]),
  );
  if (output.contentKind === 'package_manifest' && isRecordValue(output.content)) {
    const isSafeRef = (candidate: unknown): candidate is string => typeof candidate === 'string'
      && !!candidate
      && !candidate.startsWith('/')
      && !candidate.startsWith('\\')
      && !/^[a-z]:[\\/]/i.test(candidate)
      && !candidate.split(/[\\/]+/).includes('..');
    const files = Array.isArray(output.content.files)
      ? output.content.files.flatMap((file) => {
          if (!isRecordValue(file) || !isSafeRef(file.path)) return [];
          if (typeof file.size !== 'number' || !Number.isFinite(file.size) || typeof file.sha256 !== 'string') return [];
          return [{ path: file.path, size: file.size, sha256: file.sha256 }];
        })
      : [];
    output.content = {
      entryRef: isSafeRef(output.content.entryRef) ? output.content.entryRef : '',
      files,
    };
  } else if (typeof output.content !== 'string') {
    output.content = '';
  }
  return output;
}

function sanitizeArtifactWorkspaceSnapshotOutput(value: unknown): unknown {
  if (!isRecordValue(value)) return value;
  const output = Object.fromEntries(
    ['workspace', 'access', 'nodes', 'relations', 'lineages', 'versions', 'generationRequests', 'staging', 'view']
      .filter((key) => key in value)
      .map((key) => [key, value[key]]),
  );
  if (Array.isArray(output.staging)) {
    output.staging = output.staging.map((entry) => {
      if (!isRecordValue(entry)) return entry;
      const { fileRef: _fileRef, ...safe } = entry;
      return safe;
    });
  }
  return output;
}

function sanitizeArtifactWorkspaceExportOutput(value: unknown): unknown {
  if (!isRecordValue(value)) return value;
  return {
    exported: value.exported === true,
    ...(typeof value.canceled === 'boolean' ? { canceled: value.canceled } : {}),
  };
}

async function invokeArtifactWorkspaceOperation(
  operation: () => unknown,
  sanitizeData: (value: unknown) => unknown = (value) => value,
): Promise<unknown> {
  try {
    const value = await operation();
    if (isRecordValue(value) && value.ok === true && 'data' in value) {
      return { ok: true, data: sanitizeData(value.data) };
    }
    if (isRecordValue(value) && value.ok === false) return normalizeArtifactWorkspaceIpcError(value.error);
    return { ok: true, data: sanitizeData(value) };
  } catch (error) {
    return normalizeArtifactWorkspaceIpcError(error);
  }
}

function invokeArtifactWorkspaceIpcOperation(
  services: ArtifactWorkspaceDesktopServices,
  operation: ArtifactWorkspaceOperation,
  rawInput: unknown,
  options: {
    viewKey?: string;
    sanitizeData?: (value: unknown) => unknown;
  } = {},
): Promise<unknown> {
  return invokeArtifactWorkspaceOperation(() => {
    const input = sanitizeArtifactWorkspaceIpcInput(operation, rawInput);
    return options.viewKey === undefined
      ? services[operation](input)
      : services[operation](input, options.viewKey);
  }, options.sanitizeData);
}

interface RegisterDesktopIpcOptions {
  loopRuntime?: Pick<DesktopLoopRuntime, 'loopStore' | 'evidenceStore' | 'scanner' | 'runner' | 'listAnomalies'>;
}

const LOOP_OUTPUT_PREVIEW_LIMIT_BYTES = 256 * 1024;
const MEETING_TRANSCRIBER_ALLOWED_MODELS = new Set(['tiny', 'base', 'small', 'medium', 'large', 'turbo']);
const MEETING_SHERPA_ONNX_ALLOWED_MODELS = new Set(['sherpa-onnx-paraformer-zh-small-2024-03-09']);
const MEETING_TRANSCRIBER_ALLOWED_ENGINES = new Set(['sherpa-onnx-paraformer', 'whisper', 'volcengine-asr', 'aliyun-asr']);
const DEFAULT_MEETING_TRANSCRIBER_ENGINE = 'sherpa-onnx-paraformer';
const MEETING_RECORDING_ALLOWED_SCENARIOS = new Set(['discussion', 'meeting', 'sales']);
const DATA_URL_MIME_BY_EXTENSION = new Map<string, string>([
  ['.pdf', 'application/pdf'],
]);

const HTML_EDIT_IMAGE_MIME_BY_EXTENSION = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
]);

const meetingAudioPermissionService = createMeetingAudioPermissionService({
  platform: process.platform,
  getMediaAccessStatus: (mediaType) => systemPreferences.getMediaAccessStatus(mediaType),
  askForMediaAccess: (mediaType) => systemPreferences.askForMediaAccess(mediaType),
});

function getDataUrlMimeType(filePath: string): string | null {
  return DATA_URL_MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? null;
}

function getHtmlEditImageMimeType(filePath: string): string | null {
  return HTML_EDIT_IMAGE_MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? null;
}

function decodeBase64DataUrl(content: string): Buffer | null {
  const match = /^data:[^,;]+(?:;[^,]*)*;base64,([\s\S]*)$/i.exec(content);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

function decodeBase64Audio(content: string): Buffer {
  const dataUrl = decodeBase64DataUrl(content);
  return dataUrl ?? Buffer.from(content, 'base64');
}

function safeMeetingRecordingFileName(title: unknown): string {
  const raw = typeof title === 'string' ? title.trim() : '';
  const base = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'meeting';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${base}-${suffix}.wav`;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

async function realpathIfExists(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

type ArtifactEditPurpose = 'html-edit' | 'text-edit';

const EDIT_PURPOSE_CONFIG: Record<ArtifactEditPurpose, { extensions: Set<string>; errorPrefix: string }> = {
  'html-edit': {
    extensions: new Set(['.html', '.htm']),
    errorPrefix: 'html_edit',
  },
  'text-edit': {
    extensions: new Set(['.md', '.markdown']),
    errorPrefix: 'text_edit',
  },
};

async function validateArtifactEditWritePath(
  filePath: string,
  services: DesktopServices,
  purpose: ArtifactEditPurpose,
): Promise<string | null> {
  const config = EDIT_PURPOSE_CONFIG[purpose];
  if (!filePath || typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return `${config.errorPrefix}_path_not_allowed`;
  }

  const resolved = resolve(filePath);
  const extension = extname(resolved).toLowerCase();
  if (!config.extensions.has(extension)) {
    return `${config.errorPrefix}_invalid_extension`;
  }

  const segments = resolved.split(/[\\/]+/);
  if (segments.includes('node_modules') || basename(resolved).startsWith('.')) {
    return `${config.errorPrefix}_path_not_allowed`;
  }

  const allowedRoots = [
    services.getDataRoot(),
    app.getPath('downloads'),
    join(os.homedir(), '.kswarm', 'projects'),
    join(os.homedir(), '.xiaok', 'tasks'),
    // Report-renderer artifacts are written under the current working directory
    // (see isAllowedReportArtifactOutputPath in desktop-services, which allows
    // process.cwd()). Editing must be allowed there too, otherwise saving an
    // edit to a freshly generated report fails with path_not_allowed.
    process.cwd(),
  ];
  const parentReal = await realpathIfExists(dirname(resolved));
  const allowed = await Promise.all(allowedRoots.map((root) => realpathIfExists(root)));
  return allowed.some((root) => isPathInside(parentReal, root)) ? null : `${config.errorPrefix}_path_not_allowed`;
}

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const payload = args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
  console.log(`[${ts}] [${level}] [ipc] ${msg}${payload}`);
}

export type MeetingTranscriberEngineForIpc = 'sherpa-onnx-paraformer' | 'whisper' | 'volcengine-asr' | 'aliyun-asr';

export interface MeetingTranscriberOptionsForIpc {
  engine: MeetingTranscriberEngineForIpc;
  model?: string;
  language?: string;
}

export function parseMeetingTranscriberOptions(input: unknown): MeetingTranscriberOptionsForIpc {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const requestedEngine = typeof record.engine === 'string' ? record.engine.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  const language = typeof record.language === 'string' ? record.language.trim() : '';
  const engine = MEETING_TRANSCRIBER_ALLOWED_ENGINES.has(requestedEngine)
    ? requestedEngine as MeetingTranscriberEngineForIpc
    : MEETING_TRANSCRIBER_ALLOWED_MODELS.has(model)
      ? 'whisper'
      : DEFAULT_MEETING_TRANSCRIBER_ENGINE;
  const options: MeetingTranscriberOptionsForIpc = { engine };

  if (engine === 'whisper' && model && MEETING_TRANSCRIBER_ALLOWED_MODELS.has(model)) {
    options.model = model;
  }
  if (engine === 'sherpa-onnx-paraformer' && model && MEETING_SHERPA_ONNX_ALLOWED_MODELS.has(model)) {
    options.model = model;
  }
  if (language && language !== 'auto' && /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/i.test(language)) {
    options.language = language;
  }

  return options;
}

async function createMeetingTranscriberForIpc(input: unknown): Promise<MeetingTranscriber> {
  const options = parseMeetingTranscriberOptions(input);
  if (options.engine === 'volcengine-asr') {
    const { loadConfig } = await import('../../src/utils/config.js');
    const { resolveMeetingVolcengineAsrCredentials } = await import('./meeting-asr-config.js');
    const { createVolcengineMeetingTranscriber } = await import('./meeting-online-asr-transcriber.js');
    return createVolcengineMeetingTranscriber(resolveMeetingVolcengineAsrCredentials(await loadConfig()));
  }
  if (options.engine === 'aliyun-asr') {
    const { loadConfig } = await import('../../src/utils/config.js');
    const { resolveMeetingAliyunAsrCredentials } = await import('./meeting-asr-config.js');
    const { createAliyunMeetingTranscriber } = await import('./meeting-online-asr-transcriber.js');
    return createAliyunMeetingTranscriber(resolveMeetingAliyunAsrCredentials(await loadConfig()));
  }
  if (options.engine === 'sherpa-onnx-paraformer') {
    const { createSherpaOnnxParaformerTranscriber } = await import('./meeting-sherpa-onnx-transcriber.js');
    const { createLocalMeetingTranscriber } = await import('./meeting-local-transcriber.js');
    return createFallbackMeetingTranscriber([
      createSherpaOnnxParaformerTranscriber({ model: options.model }),
      createLocalMeetingTranscriber(toWhisperFallbackOptions(options)),
    ]);
  }

  const { createLocalMeetingTranscriber } = await import('./meeting-local-transcriber.js');
  return createLocalMeetingTranscriber(toWhisperFallbackOptions(options));
}

function toWhisperFallbackOptions(options: MeetingTranscriberOptionsForIpc): { model?: string; language?: string } {
  return {
    ...(options.engine === 'whisper' && options.model ? { model: options.model } : {}),
    ...(options.language ? { language: options.language } : {}),
  };
}

function createFallbackMeetingTranscriber(transcribers: MeetingTranscriber[]): MeetingTranscriber {
  return {
    async transcribeFile(input) {
      let lastError: unknown;
      for (const transcriber of transcribers) {
        try {
          return await transcriber.transcribeFile(input);
        } catch (error) {
          lastError = error;
          if (!isMeetingTranscriberFallbackError(error)) {
            throw error;
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error('transcription_failed');
    },
  };
}

async function restorePreviewPunctuation(transcription: Awaited<ReturnType<MeetingTranscriber['transcribeFile']>>) {
  const { createMeetingPunctuationService } = await import('./meeting-punctuation-service.js');
  const punctuationService = createMeetingPunctuationService();
  const result = await punctuationService.restoreFinalPunctuation({
    text: transcription.text,
    segments: transcription.segments,
    language: 'zh',
  });
  return {
    text: result.punctuatedText,
    segments: result.segments.map(segment => ({
      start: segment.start,
      end: segment.end,
      text: segment.punctuatedText,
    })),
  };
}

function isMeetingTranscriberFallbackError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'sherpa_onnx_runtime_missing'
    || error.message === 'sherpa_onnx_model_not_downloaded'
    || error.message === 'sherpa_onnx_model_incomplete';
}

type MeetingRecordingScenarioForIpc = 'discussion' | 'meeting' | 'sales';

function parseMeetingRecordingScenario(input: unknown): MeetingRecordingScenarioForIpc {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const scenario = typeof record.scenario === 'string' ? record.scenario.trim() : '';
  return MEETING_RECORDING_ALLOWED_SCENARIOS.has(scenario)
    ? scenario as MeetingRecordingScenarioForIpc
    : 'meeting';
}

function parseMeetingTranscriptSegments(input: unknown): Array<{ start: number; end: number; text: string }> {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text) return [];
    const start = Number(record.start);
    const end = Number(record.end);
    return [{
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 0,
      text,
    }];
  });
}

function parseMeetingLiveSessionId(value: unknown): string {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (!sessionId || sessionId.length > 100 || !/^[a-z0-9-]+$/i.test(sessionId)) {
    throw new Error('meeting_live_session_not_found');
  }
  return sessionId;
}

function stableMeetingLiveError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'aliyun_asr_not_configured'
    || message === 'volcengine_asr_not_configured'
    || /^(?:aliyun|volcengine|meeting)_live_[a-z0-9_]+(?::[a-z0-9_.-]+)?$/i.test(message)) {
    return message;
  }
  return 'meeting_live_failed';
}

export async function registerDesktopIpc(
  ipcMain: IpcMain,
  window: BrowserWindow,
  services: DesktopServices,
  options: RegisterDesktopIpcOptions = {}
): Promise<void> {
  const { createAliyunLiveTranscriptionRegistry } = await import('./meeting-aliyun-live-transcriber.js');
  const { createVolcengineLiveTranscriptionRegistry } = await import('./meeting-volcengine-live-transcriber.js');
  const meetingAliyunLiveRegistry = createAliyunLiveTranscriptionRegistry();
  const meetingVolcengineLiveRegistry = createVolcengineLiveTranscriptionRegistry();
  const meetingLiveSessions = new Map<string, { ownerId: number; provider: 'aliyun' | 'volcengine' }>();
  const meetingLiveOwnerCleanupRegistered = new Set<number>();

  const cancelMeetingLiveOwner = (ownerId: number) => {
    meetingAliyunLiveRegistry.cancelOwner(ownerId);
    meetingVolcengineLiveRegistry.cancelOwner(ownerId);
    for (const [sessionId, active] of meetingLiveSessions) {
      if (active.ownerId === ownerId) meetingLiveSessions.delete(sessionId);
    }
  };

  const readMeetingLiveSession = (ownerId: number, sessionId: string) => {
    const active = meetingLiveSessions.get(sessionId);
    if (!active || active.ownerId !== ownerId) throw new Error('meeting_live_session_not_found');
    return active;
  };
  const artifactWorkspaceServices = services as DesktopServices & ArtifactWorkspaceDesktopServices;
  const unsubscribeArtifactWorkspaceChanges = artifactWorkspaceServices.subscribeArtifactWorkspaceChanges?.((change) => {
    const targets = typeof BrowserWindow?.getAllWindows === 'function'
      ? BrowserWindow.getAllWindows()
      : [window];
    for (const target of targets) {
      if (!target.isDestroyed()) target.webContents.send('desktop:artifactWorkspace:changed', change);
    }
  });
  const onPrimaryClosed = () => {
    unsubscribeArtifactWorkspaceChanges?.();
    artifactWorkspaceServices.closeArtifactWorkspaceViewKey?.('primary');
  };
  if (typeof window.once === 'function') window.once('closed', onPrimaryClosed);
  const secondaryArtifactWorkspaceViewKeys = new Map<number, string>();
  const artifactWorkspaceViewKey = (event: IpcMainInvokeEvent): string => {
    const senderWindow = typeof BrowserWindow?.fromWebContents === 'function'
      ? BrowserWindow.fromWebContents(event.sender)
      : undefined;
    if (senderWindow === window || senderWindow?.webContents.id === window.webContents.id || event.sender.id === window.webContents.id) {
      return 'primary';
    }
    const ownerId = senderWindow?.id ?? event.sender.id;
    const existing = secondaryArtifactWorkspaceViewKeys.get(ownerId);
    if (existing) return existing;
    const viewKey = `window-${randomUUID()}`;
    secondaryArtifactWorkspaceViewKeys.set(ownerId, viewKey);
    if (typeof senderWindow?.once === 'function') {
      senderWindow.once('closed', () => {
        secondaryArtifactWorkspaceViewKeys.delete(ownerId);
        artifactWorkspaceServices.closeArtifactWorkspaceViewKey?.(viewKey);
      });
    }
    return viewKey;
  };

  ipcMain.handle('desktop:artifactWorkspace:getArtifactWorkspaceSnapshot', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'getArtifactWorkspaceSnapshot', rawInput, {
      viewKey: artifactWorkspaceViewKey(event),
      sanitizeData: sanitizeArtifactWorkspaceSnapshotOutput,
    });
  });
  ipcMain.handle('desktop:artifactWorkspace:closeArtifactWorkspace', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'closeArtifactWorkspace', rawInput, {
      viewKey: artifactWorkspaceViewKey(event),
    });
  });
  ipcMain.handle('desktop:artifactWorkspace:readArtifactWorkspaceVersionPreview', async (_event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'readArtifactWorkspaceVersionPreview', rawInput, {
      sanitizeData: sanitizeArtifactWorkspacePreviewOutput,
    });
  });
  ipcMain.handle('desktop:artifactWorkspace:exportArtifactWorkspaceVersion', async (event, rawInput) => {
    return invokeArtifactWorkspaceOperation(async () => {
      const input = sanitizeArtifactWorkspaceIpcInput('exportArtifactWorkspaceVersion', rawInput);
      const prepared = await artifactWorkspaceServices.exportArtifactWorkspaceVersion(input);
      if (!isRecordValue(prepared) || typeof prepared.sourcePath !== 'string' || typeof prepared.fileName !== 'string') {
        throw Object.assign(new Error('Artifact workspace export is unavailable'), { code: 'artifact_missing' });
      }
      const senderWindow = (typeof BrowserWindow?.fromWebContents === 'function'
        ? BrowserWindow.fromWebContents(event.sender)
        : undefined) ?? window;
      const selected = await dialog.showSaveDialog(senderWindow, { defaultPath: prepared.fileName });
      if (selected.canceled || !selected.filePath) return { exported: false, canceled: true };
      await artifactWorkspaceServices.exportArtifactWorkspaceVersion({ ...input, destinationPath: selected.filePath });
      return { exported: true };
    }, sanitizeArtifactWorkspaceExportOutput);
  });
  ipcMain.handle('desktop:artifactWorkspace:createArtifactPlaceholder', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactPlaceholder', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:submitArtifactGeneration', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'submitArtifactGeneration', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:cancelArtifactGeneration', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'cancelArtifactGeneration', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:retryArtifactGeneration', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'retryArtifactGeneration', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:preferArtifactVersion', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'preferArtifactVersion', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:removeArtifactWorkspaceNode', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'removeArtifactWorkspaceNode', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:updateArtifactWorkspaceLayout', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'updateArtifactWorkspaceLayout', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:saveArtifactWorkspaceViewport', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'saveArtifactWorkspaceViewport', rawInput, {
      viewKey: artifactWorkspaceViewKey(event),
    });
  });
  ipcMain.handle('desktop:artifactWorkspace:createArtifactWorkspaceCollection', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactWorkspaceCollection', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:createArtifactWorkspaceNote', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactWorkspaceNote', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:updateArtifactWorkspaceNote', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'updateArtifactWorkspaceNote', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:createArtifactWorkspaceRelation', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactWorkspaceRelation', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:setArtifactCollectionMembership', async (event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'setArtifactCollectionMembership', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  ipcMain.handle('desktop:artifactWorkspace:recordArtifactWorkspaceEvent', async (_event, rawInput) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'recordArtifactWorkspaceEvent', rawInput);
  });
  ipcMain.handle('desktop:getModelConfig', async () => {
    log('info', 'getModelConfig');
    const r = await services.getModelConfig();
    log('info', 'getModelConfig ok', { providers: r?.providers?.length ?? 0 });
    return r;
  });
  ipcMain.handle('desktop:saveModelConfig', async (_event, input) => {
    log('info', 'saveModelConfig', { providerId: input?.providerId });
    const r = await services.saveModelConfig(input);
    log('info', 'saveModelConfig ok');
    return r;
  });
  ipcMain.handle('desktop:updateModelRuntimeOptions', async (_event, input) => {
    log('info', 'updateModelRuntimeOptions', { modelId: input?.modelId });
    const r = await services.updateModelRuntimeOptions(input);
    log('info', 'updateModelRuntimeOptions ok', { modelId: input?.modelId });
    return r;
  });
  ipcMain.handle('desktop:createManagedXiaokAgent', async (_event, input) => {
    log('info', 'createManagedXiaokAgent', { name: input?.name, roles: input?.roles });
    const r = await services.createManagedXiaokAgent(input);
    log('info', 'createManagedXiaokAgent ok');
    return r;
  });
  ipcMain.handle('desktop:testProviderConnection', async (_event, input) => {
    log('info', 'testProviderConnection', { providerId: input?.providerId });
    const r = await services.testProviderConnection(input);
    log('info', 'testProviderConnection ok', { success: r?.success, latencyMs: r?.latencyMs });
    return r;
  });
  ipcMain.handle('desktop:listAvailableModelsForProvider', async (_event, providerId) => {
    log('info', 'listAvailableModelsForProvider', { providerId });
    const r = await services.listAvailableModelsForProvider(providerId);
    log('info', 'listAvailableModelsForProvider ok', { count: r?.length });
    return r;
  });
  ipcMain.handle('desktop:deleteProvider', async (_event, providerId) => {
    log('info', 'deleteProvider', { providerId });
    await services.deleteProvider(providerId);
    log('info', 'deleteProvider ok');
  });
  ipcMain.handle('desktop:deleteModel', async (_event, modelId) => {
    log('info', 'deleteModel', { modelId });
    await services.deleteModel(modelId);
    log('info', 'deleteModel ok');
  });
  ipcMain.handle('desktop:kswarm:startProjectPlanning', async (_event, input) => {
    log('info', 'startProjectPlanning', { projectId: input?.projectId });
    const r = services.startProjectPlanning(input);
    log('info', 'startProjectPlanning ok', { ok: r?.ok });
    return r;
  });
  ipcMain.handle('desktop:readClipboardFilePaths', async () => {
    // macOS Finder copy puts file URLs in 'public.file-url' pasteboard type
    // Electron clipboard.read('NSFilenamesPboardType') returns newline-separated paths
    try {
      const raw = clipboard.read('NSFilenamesPboardType');
      if (raw) {
        // NSFilenamesPboardType returns a plist XML string; extract paths from it
        const paths = raw.match(/<string>(.*?)<\/string>/g)?.map(m => m.replace(/<\/?string>/g, '')) ?? [];
        return paths.filter(p => p.startsWith('/'));
      }
    } catch { /* not available on this platform */ }
    return [];
  });
  ipcMain.handle('desktop:readClipboardImage', async () => {
    try {
      const img = clipboard.readImage();
      if (img.isEmpty()) return null;
      const png = img.toPNG();
      const tmpDir = join(os.tmpdir(), 'xiaok-clipboard-images');
      await mkdir(tmpDir, { recursive: true });
      const filePath = join(tmpDir, `clipboard-${Date.now()}.png`);
      await writeFile(filePath, png);
      return filePath;
    } catch { return null; }
  });
  ipcMain.handle('desktop:selectDirectory', async () => {
    log('info', 'selectDirectory');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      log('info', 'selectDirectory cancelled');
      return { filePath: '' };
    }
    log('info', 'selectDirectory ok', { filePath: result.filePaths[0] });
    return { filePath: result.filePaths[0] };
  });
  ipcMain.handle('desktop:selectMaterials', async () => {
    log('info', 'selectMaterials');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) {
      log('info', 'selectMaterials cancelled');
      return { filePaths: [] };
    }
    const expanded = await expandSelectedMaterialPaths(result.filePaths);
    log('info', 'selectMaterials ok', { fileCount: expanded.length });
    return { filePaths: expanded };
  });
  ipcMain.handle('desktop:importMaterial', async (_event, input) => {
    log('info', 'importMaterial', { filePath: input?.filePath });
    const r = await services.importMaterial(input);
    log('info', 'importMaterial ok');
    return r;
  });
  ipcMain.handle('desktop:createTask', async (_event, input) => {
    log('info', 'createTask', { prompt: input?.prompt?.slice(0, 50) });
    const r = await services.createTask(input);
    log('info', 'createTask ok', { taskId: r?.taskId });
    return r;
  });
  ipcMain.handle('desktop:answerQuestion', async (_event, input) => {
    log('info', 'answerQuestion', { taskId: input?.taskId });
    const r = await services.answerQuestion(input);
    log('info', 'answerQuestion ok');
    return r;
  });
  ipcMain.handle('desktop:cancelTask', async (_event, input) => {
    log('info', 'cancelTask', { taskId: input?.taskId });
    await services.cancelTask(input.taskId);
    log('info', 'cancelTask ok');
  });
  ipcMain.handle('desktop:getActiveTask', async () => {
    const r = await services.getActiveTask();
    log('debug', 'getActiveTask', { taskId: r?.taskId ?? null });
    return r;
  });
  ipcMain.handle('desktop:recoverTask', async (_event, input) => {
    log('info', 'recoverTask', { taskId: input?.taskId });
    const r = await services.recoverTask(input.taskId);
    log('info', 'recoverTask ok', { status: r?.snapshot?.status });
    return r;
  });
  ipcMain.handle('desktop:openArtifact', async (_event, input) => {
    log('info', 'openArtifact', { artifactId: input?.artifactId });
    return services.openArtifact(input.artifactId);
  });
  ipcMain.handle('desktop:openFileInSystemApp', async (_event, input) => {
    const filePath = input?.filePath as string;
    if (!filePath || !isAbsolute(filePath)) return { ok: false, error: 'invalid_path' };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle('desktop:readFileContent', async (_event, input) => {
    const filePath = input?.filePath as string;
    log('info', 'readFileContent', { filePath });
    try {
      const dataUrlMimeType = getDataUrlMimeType(filePath);
      if (dataUrlMimeType) {
        const content = await readFile(filePath);
        return { content: `data:${dataUrlMimeType};base64,${content.toString('base64')}` };
      }
      const content = await readFile(filePath, 'utf-8');
      return { content };
    } catch (e) {
      return { content: '', error: String(e) };
    }
  });
  ipcMain.handle('desktop:selectHtmlEditMedia', async (_event, input) => {
    const kind = input?.kind as 'image' | 'svg' | undefined;
    if (kind !== 'image' && kind !== 'svg') {
      return { canceled: true, filePath: '', content: '', error: 'invalid_kind' };
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }]
        : [{ name: 'SVG', extensions: ['svg'] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
      return { canceled: true, filePath: '', content: '' };
    }

    try {
      if (kind === 'image') {
        const mimeType = getHtmlEditImageMimeType(filePath);
        if (!mimeType) {
          return { canceled: true, filePath, content: '', error: 'invalid_extension' };
        }
        const content = await readFile(filePath);
        return { canceled: false, filePath, content: `data:${mimeType};base64,${content.toString('base64')}` };
      }

      if (extname(filePath).toLowerCase() !== '.svg') {
        return { canceled: true, filePath, content: '', error: 'invalid_extension' };
      }
      return { canceled: false, filePath, content: await readFile(filePath, 'utf-8') };
    } catch (e) {
      return { canceled: true, filePath, content: '', error: String(e) };
    }
  });
  const activeTaskSubs = new Map<string, AbortController>();
  ipcMain.handle('desktop:subscribeTask', async (_event, input) => {
    const taskId = input.taskId as string;
    const sinceIndex = typeof input.sinceIndex === 'number' ? input.sinceIndex : undefined;
    log('info', 'subscribeTask', { taskId, sinceIndex });

    // Cancel any existing subscription for this taskId to prevent duplicate streams
    const prev = activeTaskSubs.get(taskId);
    if (prev) {
      prev.abort();
      activeTaskSubs.delete(taskId);
    }

    const controller = new AbortController();
    activeTaskSubs.set(taskId, controller);

    void (async () => {
      try {
        const stream = sinceIndex !== undefined
          ? services.subscribeTask(taskId, { sinceIndex })
          : services.subscribeTask(taskId);
        for await (const event of stream) {
          if (controller.signal.aborted || window.isDestroyed()) {
            break;
          }
          window.webContents.send(`desktop:taskEvent:${taskId}`, event);
        }
        log('info', 'subscribeTask stream ended', { taskId });
      } catch (e) {
        if (!controller.signal.aborted) {
          log('error', 'subscribeTask error', { taskId, message: String(e) });
        }
      } finally {
        if (activeTaskSubs.get(taskId) === controller) {
          activeTaskSubs.delete(taskId);
        }
      }
    })();
  });
  ipcMain.handle('desktop:listSkills', async () => {
    const r = await services.listSkills();
    log('info', 'listSkills', { count: r.length });
    return r;
  });
  ipcMain.handle('desktop:installSkill', async (_event, skillName) => {
    log('info', 'installSkill', { skillName });
    const r = await services.installSkill(skillName);
    log('info', 'installSkill result', { success: r.success });
    return r;
  });
  ipcMain.handle('desktop:uninstallSkill', async (_event, skillName) => {
    log('info', 'uninstallSkill', { skillName });
    const r = await services.uninstallSkill(skillName);
    log('info', 'uninstallSkill result', { success: r.success });
    return r;
  });
  // Channel IPC
  ipcMain.handle('desktop:listChannels', async () => services.listChannels());
  ipcMain.handle('desktop:testChannel', async (_event, channelId) => {
    log('info', 'testChannel', { channelId });
    const r = await services.testChannel(channelId);
    log('info', 'testChannel result', { success: r.success });
    return r;
  });
  ipcMain.handle('desktop:createChannel', async (_event, input) => services.createChannel(input));
  ipcMain.handle('desktop:updateChannel', async (_event, id, input) => services.updateChannel(id, input));
  ipcMain.handle('desktop:deleteChannel', async (_event, id) => services.deleteChannel(id));
  // MCP IPC
  ipcMain.handle('desktop:listMCPInstalls', async () => services.listMCPInstalls());
  ipcMain.handle('desktop:createMCPInstall', async (_event, input) => services.createMCPInstall(input));
  ipcMain.handle('desktop:updateMCPInstall', async (_event, id, input) => services.updateMCPInstall(id, input));
  ipcMain.handle('desktop:deleteMCPInstall', async (_event, id) => services.deleteMCPInstall(id));
  // Plugin MCP servers
  ipcMain.handle('desktop:listPluginMcpServers', () => services.listPluginMcpServers());
  ipcMain.handle('desktop:setPluginMcpServerEnabled', (_event, input) => services.setPluginMcpServerEnabled(input));
  ipcMain.handle('desktop:restartPluginMcpServers', () => services.restartPluginMcpServers());
  ipcMain.handle('desktop:restartPluginMcpServer', (_event, input) => services.restartPluginMcpServer(input));
  ipcMain.handle('desktop:getComputerUseCapabilityStatus', () => services.getComputerUseCapabilityStatus());
  ipcMain.handle('desktop:enableComputerUse', () => services.enableComputerUse());
  ipcMain.handle('desktop:reconnectComputerUse', () => services.reconnectComputerUse());
  ipcMain.handle('desktop:disableComputerUse', () => services.disableComputerUse());
  ipcMain.handle('desktop:openPluginDependencyPermissionSettings', async (_event, input) => {
    const permission = String(input?.permission ?? '');
    const pane = permission === 'screen'
      ? 'Privacy_ScreenCapture'
      : 'Privacy_Accessibility';
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  });
  ipcMain.handle('desktop:installPlugin', (_event, name) => services.installPlugin(name));
  ipcMain.handle('desktop:listAvailablePlugins', () => services.listAvailablePlugins());
  ipcMain.handle('desktop:listPluginDependencyStatuses', () => services.listPluginDependencyStatuses());
  ipcMain.handle('desktop:installPluginDependency', (_event, input) => services.installPluginDependency(input));
  ipcMain.handle('desktop:updatePluginDependency', (_event, input) => services.updatePluginDependency(input));
  ipcMain.handle('desktop:diagnosePluginDependency', (_event, input) => services.diagnosePluginDependency(input));
  ipcMain.handle('desktop:createTaskWithFiles', async (_event, input) => {
    log('info', 'createTaskWithFiles', { prompt: input?.prompt?.slice(0, 50), files: input?.filePaths?.length });
    const expanded = await expandSelectedMaterialPaths(input?.filePaths ?? []);
    const r = await services.createTaskWithFiles({ ...input, filePaths: expanded });
    log('info', 'createTaskWithFiles ok', { taskId: r?.taskId });
    return r;
  });
  ipcMain.handle('desktop:getSkillStats', async () => {
    try {
      return await services.getSkillStats();
    } catch { return []; }
  });
  ipcMain.handle('desktop:trace:export', async (_event, input) => {
    log('info', 'traceExport', { kind: input?.kind, id: input?.id });
    const result = await services.exportTraceBundle(input);
    log('info', 'traceExport result', { ok: result.ok, path: result.path });
    return result;
  });
  ipcMain.handle('desktop:diagnose', async (_event, input) => {
    log('info', 'diagnose', { kind: input?.kind, id: input?.id });
    const result = await services.diagnose(input);
    log('info', 'diagnose result', { health: result?.health, primaryFinding: result?.primaryFinding?.category ?? null });
    return result;
  });

  ipcMain.handle('desktop:loops:listDefinitions', () => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listLoopDefinitions();
  });
  ipcMain.handle('desktop:loops:listUserTemplates', () => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listUserLoopTemplates();
  });
  ipcMain.handle('desktop:loops:createUserTemplate', (_event, input) => {
    log('info', 'loops:createUserTemplate', { title: input?.title, kind: input?.kind, loopId: input?.loopId });
    try {
      const loopRuntime = getLoopRuntime(options);
      const result = loopRuntime.loopStore.createUserLoopTemplate(readCreateUserLoopTemplateInput(input));
      log('info', 'loops:createUserTemplate ok', { loopId: result.template.loopId });
      return result;
    } catch (e) {
      log('error', 'loops:createUserTemplate failed', String(e));
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:updateUserTemplate', (_event, loopId, patch) => {
    log('info', 'loops:updateUserTemplate', { loopId, patchKeys: patch ? Object.keys(patch) : [] });
    try {
      const loopRuntime = getLoopRuntime(options);
      const id = readLoopId(loopId);
      const result = loopRuntime.loopStore.updateUserLoopTemplate(id, patch ?? {});
      log('info', 'loops:updateUserTemplate ok', { loopId: id, found: !!result });
      return result;
    } catch (e) {
      log('error', 'loops:updateUserTemplate failed', { loopId, error: String(e) });
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:deleteUserTemplate', (_event, loopId) => {
    log('info', 'loops:deleteUserTemplate', { loopId });
    try {
      const loopRuntime = getLoopRuntime(options);
      const id = readLoopId(loopId);
      loopRuntime.loopStore.deleteUserLoopTemplate(id);
      log('info', 'loops:deleteUserTemplate ok', { loopId: id });
    } catch (e) {
      log('error', 'loops:deleteUserTemplate failed', { loopId, error: String(e) });
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:openOutputDirectory', async (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    const id = readLoopId(loopId);
    return openLoopOutputDirectory(id, loopRuntime.loopStore.getUserLoopTemplate(id));
  });
  ipcMain.handle('desktop:loops:readOutputPreview', async (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    const id = readLoopId(loopId);
    return readLoopOutputPreview(id, loopRuntime.loopStore.getUserLoopTemplate(id));
  });
  ipcMain.handle('desktop:loops:readTaskResult', async (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    const id = readLoopId(loopId);
    return readLoopTaskResult(id, loopRuntime, services.getDataRoot());
  });
  ipcMain.handle('desktop:loops:listRuns', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listLoopRuns(readLoopId(loopId), 20);
  });
  ipcMain.handle('desktop:loops:listAnomalies', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.listAnomalies(readLoopId(loopId));
  });
  ipcMain.handle('desktop:loops:runNow', async (_event, loopId) => {
    log('info', 'loops:runNow', { loopId });
    try {
      const loopRuntime = getLoopRuntime(options);
      const result = await loopRuntime.runner.runLoopNow(readLoopId(loopId));
      log('info', 'loops:runNow result', { loopId, status: result.status });
      return result;
    } catch (e) {
      log('error', 'loops:runNow failed', { loopId, error: String(e) });
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:listConstraints', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.getConstraintsByLoopId(readLoopId(loopId));
  });
  ipcMain.handle('desktop:loops:setConstraintActive', (_event, constraintId, active) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.setConstraintActive(String(constraintId), Boolean(active));
  });
  ipcMain.handle('desktop:loops:confirmConstraint', (_event, constraintId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.confirmConstraint(String(constraintId));
  });
  ipcMain.handle('desktop:loops:clearRunHistory', (_event, loopId, statuses) => {
    log('info', 'loops:clearRunHistory', { loopId, statuses });
    try {
      const loopRuntime = getLoopRuntime(options);
      const id = readLoopId(loopId);
      const validStatuses = Array.isArray(statuses) && statuses.every(s => typeof s === 'string') ? statuses : undefined;
      const removed = loopRuntime.loopStore.clearLoopRunHistory(id, validStatuses);
      log('info', 'loops:clearRunHistory ok', { loopId: id, removed });
      return { ok: true, removed };
    } catch (e) {
      log('error', 'loops:clearRunHistory failed', { loopId, error: String(e) });
      throw e;
    }
  });

  // ---- Memory ----
  const { getDesktopMemoryStore } = await import('./desktop-services.js');
  const { parseMemories } = await import('./memory-import-parser.js');
  const memoryStore = getDesktopMemoryStore(services.getDataRoot());

  ipcMain.handle('desktop:listMemories', async () => {
    try {
      if (memoryStore.search) {
        return (await memoryStore.search('', 50)).map(r => ({
          id: r.id, content: r.summary, tags: r.tags, createdAt: r.updatedAt,
        }));
      }
      return (await memoryStore.listRelevant({ cwd: '', query: '' })).map(r => ({
        id: r.id, content: r.summary, tags: r.tags, createdAt: r.updatedAt,
      }));
    } catch (e) { log('error', 'listMemories failed', e); return []; }
  });
  ipcMain.handle('desktop:createMemory', async (_event, input: { content: string; tags: string[]; source?: string }) => {
    try {
      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await memoryStore.save({
        id, scope: 'global', title: input.content.slice(0, 80),
        summary: input.content, tags: input.tags, updatedAt: Date.now(), type: 'user',
      });
      return { id, content: input.content, tags: input.tags, createdAt: Date.now() };
    } catch (e) { log('error', 'createMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:updateMemory', async (_event, input: { id: string; content?: string; tags?: string[] }) => {
    try {
      // Delete old + re-save with updated content
      await memoryStore.delete?.(input.id);
      const content = input.content ?? '';
      await memoryStore.save({
        id: input.id, scope: 'global', title: content.slice(0, 80),
        summary: content, tags: input.tags ?? [], updatedAt: Date.now(), type: 'user',
      });
      return { id: input.id, content, tags: input.tags ?? [], createdAt: Date.now() };
    } catch (e) { log('error', 'updateMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:deleteMemory', async (_event, id: string) => {
    try { return await memoryStore.delete?.(id) ?? false; }
    catch (e) { log('error', 'deleteMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:importMemories', async (_event, raw: string) => {
    try {
      const { items, errors } = parseMemories(raw);
      if (items.length === 0 && errors.length === 0) return { imported: 0, deduped: 0, parseErrors: ['未解析到任何记忆'] };
      let imported = 0;
      for (const item of items) {
        const content = (item.content || '').trim();
        if (!content) continue;
        await memoryStore.save({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          scope: 'global', title: content.slice(0, 80),
          summary: content, tags: item.tags || [], updatedAt: Date.now(), type: 'user',
        });
        imported++;
      }
      return { imported, deduped: 0, parseErrors: errors };
    } catch (e) {
      return { imported: 0, deduped: 0, parseErrors: [`导入失败: ${e}`] };
    }
  });
  ipcMain.handle('desktop:memoryStats', async () => {
    try { return memoryStore.getStats?.() ?? null; }
    catch (e) { log('error', 'memoryStats failed', e); return null; }
  });
  ipcMain.handle('desktop:memoryCompact', async () => {
    try { await memoryStore.compact?.(); return true; }
    catch (e) { log('error', 'memoryCompact failed', e); return false; }
  });
  ipcMain.handle('desktop:memoryPersonaTraits', async () => {
    try { return memoryStore.getPersonaTraits?.() ?? []; }
    catch (e) { log('error', 'memoryPersonaTraits failed', e); return []; }
  });
  ipcMain.handle('desktop:memoryListLayer', async (_event, layer: number, limit?: number, offset?: number) => {
    try { return memoryStore.listLayer?.(layer, limit ?? 50, offset ?? 0) ?? []; }
    catch (e) { log('error', 'memoryListLayer failed', e); return []; }
  });
  ipcMain.handle('desktop:memoryDeleteEntry', async (_event, id: string, layer: number) => {
    try { return await memoryStore.delete?.(id, layer) ?? false; }
    catch (e) { log('error', 'memoryDeleteEntry failed', e); return false; }
  });
  ipcMain.handle('desktop:memoryClearAll', async () => {
    try { memoryStore.clearAll?.(); return true; }
    catch (e) { log('error', 'memoryClearAll failed', e); return false; }
  });
  ipcMain.handle('desktop:memoryGetModelId', async () => {
    try {
      const config = await (await import('../../src/utils/config.js')).loadConfig();
      return config.memory?.modelId ?? null;
    } catch { return null; }
  });
  ipcMain.handle('desktop:memorySetModelId', async (_event, modelId: string | null) => {
    try {
      const { loadConfig, saveConfig: saveConfigFn } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      if (!config.memory) config.memory = {};
      config.memory.modelId = modelId ?? undefined;
      await saveConfigFn(config);
      return true;
    } catch (e) { log('error', 'memorySetModelId failed', e); return false; }
  });

  ipcMain.handle('desktop:getEmbeddingModels', async () => {
    try {
      const { MODEL_REGISTRY, isModelDownloaded, getManualDownloadHint } = await import('../../src/ai/memory/model-registry.js');
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      const activeModelId = config.memory?.modelId ?? 'all-MiniLM-L6-v2';
      return MODEL_REGISTRY.map(m => ({
        id: m.id,
        name: m.name,
        dims: m.dims,
        size: m.size,
        languages: m.languages,
        downloaded: isModelDownloaded(m.id),
        active: m.id === activeModelId,
        manualHint: getManualDownloadHint(m.id),
      }));
    } catch (e) { log('error', 'getEmbeddingModels failed', e); return []; }
  });

  ipcMain.handle('desktop:downloadEmbeddingModel', async (_event, modelId: string) => {
    const { downloadModel } = await import('../../src/ai/memory/model-registry.js');
    await downloadModel(modelId);
  });

  ipcMain.handle('desktop:setEmbeddingModel', async (_event, modelId: string) => {
    try {
      const { loadConfig, saveConfig: saveConfigFn, getConfigDir } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      const prevModelId = config.memory?.modelId;
      if (!config.memory) config.memory = {};
      config.memory.modelId = modelId;
      await saveConfigFn(config);
      if (prevModelId !== modelId) {
        try {
          const Database = (await import('better-sqlite3')).default;
          const path = await import('node:path');
          const dbPath = path.join(getConfigDir(), 'memory.db');
          const db = new Database(dbPath);
          db.prepare('DELETE FROM memory_embeddings').run();
          db.close();
          log('info', 'Cleared memory_embeddings after model switch', { from: prevModelId, to: modelId });
        } catch (e) { log('warn', 'Failed to clear embeddings on model switch', e); }
      }
    } catch (e) { log('error', 'setEmbeddingModel failed', e); throw e; }
  });

  // ---- Artifact Editing ----
  const { sessionHash, backupArtifact, revertArtifact, cleanupBackups, watchArtifactFile, unwatchArtifactFile } = await import('./artifact-editing.js');

  ipcMain.handle('desktop:artifactBackup', async (_event, filePath: string) => {
    const sid = sessionHash(filePath);
    return backupArtifact(filePath, sid);
  });

  ipcMain.handle('desktop:artifactRevert', async (_event, filePath: string) => {
    const sid = sessionHash(filePath);
    const ok = revertArtifact(filePath, sid);
    if (ok) window.webContents.send('desktop:artifactFileChanged', filePath);
    return ok;
  });

  ipcMain.handle('desktop:artifactCleanup', async (_event, filePath: string) => {
    const sid = sessionHash(filePath);
    cleanupBackups(sid);
  });

  ipcMain.handle('desktop:artifactWatch', async (_event, filePath: string) => {
    watchArtifactFile(filePath, () => {
      window.webContents.send('desktop:artifactFileChanged', filePath);
    });
  });

  ipcMain.handle('desktop:artifactUnwatch', async (_event, filePath: string) => {
    unwatchArtifactFile(filePath);
  });

  // ---- File Export ----
  ipcMain.handle('desktop:showSaveDialog', async (_event, input: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    log('info', 'showSaveDialog', { defaultPath: input?.defaultPath });
    const result = await dialog.showSaveDialog(window, {
      defaultPath: input?.defaultPath,
      filters: input?.filters ?? [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) {
      log('info', 'showSaveDialog cancelled');
      return { canceled: true, filePath: '' };
    }
    log('info', 'showSaveDialog ok', { filePath: result.filePath });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('desktop:saveFile', async (_event, input: { filePath: string; content: string; purpose?: string }) => {
    log('info', 'saveFile', { filePath: input?.filePath });
    try {
      if (input?.purpose === 'html-edit' || input?.purpose === 'text-edit') {
        const validationError = await validateArtifactEditWritePath(input.filePath, services, input.purpose);
        if (validationError) {
          log('warn', 'saveFile rejected artifact edit', { filePath: input?.filePath, purpose: input.purpose, error: validationError });
          return { success: false, error: validationError };
        }
      }
      const binaryContent = decodeBase64DataUrl(input.content);
      if (binaryContent) {
        await writeFile(input.filePath, binaryContent);
      } else {
        await writeFile(input.filePath, input.content, 'utf-8');
      }
      log('info', 'saveFile ok');
      return { success: true };
    } catch (e) {
      log('error', 'saveFile failed', String(e));
      return { success: false, error: String(e) };
    }
  });

  // ---- Project Principles ----
  const { PrinciplesStore } = await import('./principles-store.js');
  const principlesStore = new PrinciplesStore(services.getDataRoot());

  ipcMain.handle('desktop:listPrinciples', async () => {
    log('info', 'listPrinciples');
    return principlesStore.list();
  });

  ipcMain.handle('desktop:savePrinciple', async (_event, input) => {
    log('info', 'savePrinciple', { id: input?.id });
    const result = await principlesStore.save(input);
    log('info', 'savePrinciple result', result);
    return result;
  });

  ipcMain.handle('desktop:deletePrinciple', async (_event, id: string) => {
    log('info', 'deletePrinciple', { id });
    const result = await principlesStore.delete(id);
    log('info', 'deletePrinciple result', result);
    return result;
  });

  // ---- Knowledge Base ----
  const { createKbStoreSqlite } = await import('./kb-store-sqlite.js');
  const { createChunker } = await import('./kb-chunker.js');
  const { createSourceExtractor } = await import('./kb-source-extractor.js');
  const { app } = await import('electron');

  let kbStore: import('./kb-store.js').KbStore | null = null;
  function getKbStore() {
    if (!kbStore) {
      kbStore = createKbStoreSqlite(join(app.getPath('userData'), 'knowledge.db'));
      if (kbStore.listCollections().length === 0) {
        kbStore.createCollection({
          name: '我的知识库',
          description: '默认知识库集合',
          embeddingModelId: 'bge-small-zh-v1.5',
          embeddingDim: 512,
        });
      }
      (kbStore as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed' WHERE parse_status = 'pending' AND id IN (SELECT DISTINCT source_id FROM chunks)").run();
      const pendingSources = (kbStore as any)._db?.prepare("SELECT id, raw_path, mime_type FROM sources WHERE parse_status = 'pending' AND raw_path != ''").all() as Array<{ id: string; raw_path: string; mime_type: string }> | undefined;
      if (pendingSources?.length) {
        const store = kbStore!;
        setImmediate(async () => {
          const extractor = createSourceExtractor();
          const chunker = createChunker();
          for (const src of pendingSources) {
            try {
              const extractResult = await extractor.extract({ filePath: src.raw_path, mimeType: src.mime_type || 'application/octet-stream' });
              if (extractResult.ok && extractResult.text) {
                const chunks = chunker.chunk({ text: extractResult.text, mimeType: extractResult.mimeType });
                store.insertChunks(src.id, chunks);
                (store as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed', updated_at = ? WHERE id = ?").run(Date.now(), src.id);
              } else {
                (store as any)._db?.prepare("UPDATE sources SET parse_status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), src.id);
              }
            } catch {
              (store as any)._db?.prepare("UPDATE sources SET parse_status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), src.id);
            }
          }
        });
      }
    }
    return kbStore;
  }

  ipcMain.handle('desktop:kb:listCollections', async () => {
    log('info', 'kb:listCollections');
    return getKbStore().listCollections();
  });

  ipcMain.handle('desktop:kb:createCollection', async (_event, input) => {
    log('info', 'kb:createCollection', { name: input?.name });
    return getKbStore().createCollection(input);
  });

  ipcMain.handle('desktop:kb:deleteCollection', async (_event, id: string) => {
    log('info', 'kb:deleteCollection', { id });
    getKbStore().deleteCollection(id);
  });

  ipcMain.handle('desktop:kb:listSources', async (_event, collectionId: string) => {
    log('info', 'kb:listSources', { collectionId });
    return getKbStore().listSources(collectionId);
  });

  ipcMain.handle('desktop:kb:addSource', async (_event, input) => {
    log('info', 'kb:addSource', { kind: input?.kind, title: input?.title });
    const store = getKbStore();
    const source = store.addSource(input);
    const extractor = createSourceExtractor();
    const chunker = createChunker();
    try {
      let extractResult: { ok: boolean; text?: string; mimeType?: string } | null = null;
      if (input?.kind === 'paste' && input?.text) {
        extractResult = extractor.extractFromText(input.text, input.title || '粘贴文本');
      } else if (input?.kind === 'file' && input?.filePath) {
        extractResult = await extractor.extract({ filePath: input.filePath, mimeType: input.mimeType || 'application/octet-stream' });
      } else if (input?.kind === 'url' && input?.uri) {
        extractResult = await extractor.extractFromUrl(input.uri);
      }
      if (extractResult?.ok && extractResult.text) {
        const chunks = chunker.chunk({ text: extractResult.text, mimeType: extractResult.mimeType });
        store.insertChunks(source.id, chunks);
        (store as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed', updated_at = ? WHERE id = ?").run(Date.now(), source.id);
      }
    } catch (e) {
      log('error', 'kb:addSource processing failed', String(e));
    }
    return source;
  });

  ipcMain.handle('desktop:kb:pickFiles', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文档', extensions: ['pdf', 'txt', 'md', 'docx', 'pptx', 'xlsx', 'html', 'json', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('desktop:meeting:pickAudioFile', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'WAV audio', extensions: ['wav'] },
      ],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('desktop:meeting:getMicrophonePermission', async () => (
    meetingAudioPermissionService.getStatus()
  ));

  ipcMain.handle('desktop:meeting:requestMicrophonePermission', async () => (
    meetingAudioPermissionService.requestPermission()
  ));

  ipcMain.handle('desktop:meeting:getAsrConfig', async () => {
    const { loadConfig } = await import('../../src/utils/config.js');
    const { createMeetingAsrConfigSnapshot } = await import('./meeting-asr-config.js');
    return createMeetingAsrConfigSnapshot(await loadConfig());
  });

  ipcMain.handle('desktop:meeting:saveAsrConfig', async (_event, input) => {
    const { loadConfig, saveConfig } = await import('../../src/utils/config.js');
    const { applyMeetingAsrConfigUpdate, createMeetingAsrConfigSnapshot } = await import('./meeting-asr-config.js');
    const config = applyMeetingAsrConfigUpdate(await loadConfig(), input ?? {});
    await saveConfig(config);
    return createMeetingAsrConfigSnapshot(config);
  });

  ipcMain.handle('desktop:meeting:listModels', async () => {
    const { createMeetingModelService } = await import('./meeting-model-service.js');
    return createMeetingModelService().listModels();
  });

  ipcMain.handle('desktop:meeting:downloadModel', async (_event, modelId: string) => {
    const { createMeetingModelService } = await import('./meeting-model-service.js');
    return createMeetingModelService().downloadModel(String(modelId ?? ''));
  });

  ipcMain.handle('desktop:meeting:uninstallModel', async (_event, modelId: string) => {
    const { createMeetingModelService } = await import('./meeting-model-service.js');
    return createMeetingModelService().uninstallModel(String(modelId ?? ''));
  });

  ipcMain.handle('desktop:meeting:saveRecordedAudio', async (_event, input) => {
    const wavBase64 = typeof input?.wavBase64 === 'string' ? input.wavBase64 : '';
    if (!wavBase64) return { ok: false, error: 'missing_audio' };
    if (Buffer.byteLength(wavBase64, 'utf8') > 512 * 1024 * 1024) {
      return { ok: false, error: 'audio_too_large' };
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = decodeBase64Audio(wavBase64);
      const { parsePcm16WavInfo } = await import('./meeting-audio-format.js');
      parsePcm16WavInfo(audioBuffer);
    } catch {
      return { ok: false, error: 'invalid_wav' };
    }

    const recordingsDir = join(app.getPath('userData'), 'meeting-recordings');
    await mkdir(recordingsDir, { recursive: true });
    const filePath = join(recordingsDir, safeMeetingRecordingFileName(input?.title));
    await writeFile(filePath, audioBuffer);
    return { ok: true, filePath };
  });

  ipcMain.handle('desktop:meeting:transcribePreview', async (_event, input) => {
    const wavBase64 = typeof input?.wavBase64 === 'string' ? input.wavBase64 : '';
    if (!wavBase64) return { ok: false, error: 'missing_audio' };
    if (Buffer.byteLength(wavBase64, 'utf8') > 96 * 1024 * 1024) {
      return { ok: false, error: 'audio_too_large' };
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = decodeBase64Audio(wavBase64);
      const { parsePcm16WavInfo } = await import('./meeting-audio-format.js');
      parsePcm16WavInfo(audioBuffer);
    } catch {
      return { ok: false, error: 'invalid_wav' };
    }

    const previewDir = join(app.getPath('temp'), 'xiaok-meeting-preview');
    await mkdir(previewDir, { recursive: true });
    const filePath = join(previewDir, safeMeetingRecordingFileName(input?.title));
    await writeFile(filePath, audioBuffer);
    try {
      const transcriber = await createMeetingTranscriberForIpc(input);
      const transcription = await transcriber.transcribeFile({
        audioFilePath: filePath,
        meetingId: `preview-${Date.now()}`,
      });
      const punctuated = await restorePreviewPunctuation(transcription);
      return { ok: true, ...punctuated };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'preview_transcription_failed',
      };
    } finally {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  });

  ipcMain.handle('desktop:meeting:live:start', async (event, input) => {
    try {
      const engine = input?.engine === 'aliyun-asr' || input?.engine === 'volcengine-asr'
        ? input.engine as 'aliyun-asr' | 'volcengine-asr'
        : null;
      if (!engine) throw new Error('meeting_live_provider_not_supported');
      const sampleRate = Number(input?.sampleRate);
      const language = typeof input?.language === 'string' ? input.language.trim() : undefined;
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      const ownerId = event.sender.id;
      if (!meetingLiveOwnerCleanupRegistered.has(ownerId)) {
        meetingLiveOwnerCleanupRegistered.add(ownerId);
        event.sender.once('destroyed', () => {
          meetingLiveOwnerCleanupRegistered.delete(ownerId);
          cancelMeetingLiveOwner(ownerId);
        });
      }
      const onUpdate = (activeSessionId: string, update: {
        sentenceId: string;
        start: number;
        end: number;
        text: string;
        final: boolean;
      }) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('desktop:meeting:live:update', { sessionId: activeSessionId, ...update });
        }
      };
      let sessionId: string;
      let provider: 'aliyun' | 'volcengine';
      if (engine === 'aliyun-asr') {
        const { resolveMeetingAliyunAsrCredentials } = await import('./meeting-asr-config.js');
        const credentials = resolveMeetingAliyunAsrCredentials(config);
        provider = 'aliyun';
        sessionId = await meetingAliyunLiveRegistry.start(ownerId, {
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          sampleRate,
          language,
        }, onUpdate);
      } else {
        const { resolveMeetingVolcengineAsrCredentials } = await import('./meeting-asr-config.js');
        const credentials = resolveMeetingVolcengineAsrCredentials(config);
        provider = 'volcengine';
        sessionId = await meetingVolcengineLiveRegistry.start(ownerId, {
          ...credentials,
          sampleRate,
        }, onUpdate);
      }
      meetingLiveSessions.set(sessionId, { ownerId, provider });
      return { ok: true, sessionId };
    } catch (error) {
      return { ok: false, error: stableMeetingLiveError(error) };
    }
  });

  ipcMain.handle('desktop:meeting:live:pushAudio', async (event, input) => {
    try {
      const sessionId = parseMeetingLiveSessionId(input?.sessionId);
      const active = readMeetingLiveSession(event.sender.id, sessionId);
      const pcmBase64 = typeof input?.pcmBase64 === 'string' ? input.pcmBase64 : '';
      if (!pcmBase64 || Buffer.byteLength(pcmBase64, 'utf8') > 1024 * 1024) {
        throw new Error('meeting_live_invalid_audio');
      }
      const audio = Buffer.from(pcmBase64, 'base64');
      if (audio.length === 0 || audio.length % 2 !== 0) throw new Error('meeting_live_invalid_audio');
      if (active.provider === 'aliyun') {
        meetingAliyunLiveRegistry.pushAudio(event.sender.id, sessionId, audio);
      } else {
        meetingVolcengineLiveRegistry.pushAudio(event.sender.id, sessionId, audio);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: stableMeetingLiveError(error) };
    }
  });

  ipcMain.handle('desktop:meeting:live:finish', async (event, input) => {
    try {
      const sessionId = parseMeetingLiveSessionId(input?.sessionId);
      const active = readMeetingLiveSession(event.sender.id, sessionId);
      try {
        if (active.provider === 'aliyun') {
          await meetingAliyunLiveRegistry.finish(event.sender.id, sessionId);
        } else {
          await meetingVolcengineLiveRegistry.finish(event.sender.id, sessionId);
        }
      } finally {
        meetingLiveSessions.delete(sessionId);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: stableMeetingLiveError(error) };
    }
  });

  ipcMain.handle('desktop:meeting:live:cancel', async (event, input) => {
    try {
      const sessionId = parseMeetingLiveSessionId(input?.sessionId);
      const active = readMeetingLiveSession(event.sender.id, sessionId);
      meetingLiveSessions.delete(sessionId);
      if (active.provider === 'aliyun') {
        meetingAliyunLiveRegistry.cancel(event.sender.id, sessionId);
      } else {
        meetingVolcengineLiveRegistry.cancel(event.sender.id, sessionId);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: stableMeetingLiveError(error) };
    }
  });

  ipcMain.handle('desktop:meeting:processRecording', async (_event, input) => {
    log('info', 'meeting:processRecording', { collectionId: input?.collectionId, title: input?.title });
    const { createMeetingService } = await import('./meeting-service.js');
    const { createLocalMeetingSummaryService } = await import('./meeting-summary-service.js');
    const { createMeetingPunctuationService } = await import('./meeting-punctuation-service.js');
    const service = createMeetingService({
      store: getKbStore(),
      transcriber: await createMeetingTranscriberForIpc(input),
      punctuationService: createMeetingPunctuationService(),
      summaryService: createLocalMeetingSummaryService(),
    });
    return service.processRecording({
      requestSource: 'user',
      collectionId: String(input?.collectionId ?? ''),
      title: String(input?.title ?? '').trim() || 'Meeting',
      audioFilePath: String(input?.audioFilePath ?? ''),
      summaryProvider: 'local-only',
      scenario: parseMeetingRecordingScenario(input),
    });
  });

  ipcMain.handle('desktop:meeting:draftRecording', async (_event, input) => {
    log('info', 'meeting:draftRecording', { title: input?.title });
    const { createMeetingService } = await import('./meeting-service.js');
    const { createLocalMeetingSummaryService } = await import('./meeting-summary-service.js');
    const { createMeetingPunctuationService } = await import('./meeting-punctuation-service.js');
    const service = createMeetingService({
      store: getKbStore(),
      transcriber: await createMeetingTranscriberForIpc(input),
      punctuationService: createMeetingPunctuationService(),
      summaryService: createLocalMeetingSummaryService(),
    });
    return service.draftRecording({
      requestSource: 'user',
      title: String(input?.title ?? '').trim() || 'Meeting',
      audioFilePath: String(input?.audioFilePath ?? ''),
      summaryProvider: 'local-only',
      scenario: parseMeetingRecordingScenario(input),
      transcript: typeof input?.transcript === 'string' ? input.transcript : undefined,
      segments: parseMeetingTranscriptSegments(input?.segments),
    });
  });

  ipcMain.handle('desktop:meeting:saveTranscript', async (_event, input) => {
    log('info', 'meeting:saveTranscript', { collectionId: input?.collectionId, title: input?.title });
    const { createMeetingService } = await import('./meeting-service.js');
    const service = createMeetingService({ store: getKbStore() });
    return service.saveTranscript({
      requestSource: 'user',
      collectionId: String(input?.collectionId ?? ''),
      title: String(input?.title ?? '').trim() || 'Meeting',
      audioFilePath: String(input?.audioFilePath ?? ''),
      transcript: String(input?.transcript ?? ''),
    });
  });

  ipcMain.handle('desktop:kb:deleteSource', async (_event, id: string) => {
    log('info', 'kb:deleteSource', { id });
    getKbStore().deleteSource(id);
  });

  ipcMain.handle('desktop:kb:getCollectionState', async (_event, collectionId: string) => {
    log('info', 'kb:getCollectionState', { collectionId });
    return getKbStore().getCollectionState(collectionId);
  });

  ipcMain.handle('desktop:kb:getSourceContent', async (_event, input) => {
    const sourceId = String(input?.sourceId ?? '');
    const offset = Math.max(0, Number(input?.offset ?? 0) || 0);
    const requestedLimit = Number(input?.limit ?? 64_000) || 64_000;
    const limit = Math.min(Math.max(1, requestedLimit), 128_000);
    log('info', 'kb:getSourceContent', { sourceId, offset, limit });
    return getKbStore().getSourceWithContent(sourceId, offset, limit);
  });

  ipcMain.handle('desktop:kb:search', async (_event, input) => {
    log('info', 'kb:search', { collectionId: input?.collectionId, query: input?.query?.slice(0, 50) });
    const store = getKbStore();
    const query = (input?.query ?? '').trim();
    const topK = input?.topK ?? 10;
    if (!query) return [];
    const collectionId = input?.collectionId ?? '';
    const sourceIds = input?.sourceIds as string[] | undefined;
    const allSources = store.listSources(collectionId);
    const filteredSources = sourceIds?.length ? allSources.filter(s => sourceIds.includes(s.id)) : allSources;
    const { extractQueryTerms, meetsRelevanceFloor } = await import('./kb-query-terms.js');
    const uniqueTerms = extractQueryTerms(query);
    const results: Array<{ chunkId: string; sourceId: string; sourceTitle: string; collectionId: string; text: string; pageIndex: number | null; slideIndex: number | null; sheetName: string | null; bm25Score: number; vectorScore: number; fusedScore: number }> = [];
    for (const src of filteredSources) {
      const srcChunks = store.listChunks(src.id);
      for (const chunk of srcChunks) {
        const lower = chunk.text.toLowerCase();
        const matchCount = uniqueTerms.filter((t: string) => lower.includes(t)).length;
        const score = matchCount / uniqueTerms.length;
        if (meetsRelevanceFloor(score)) {
          results.push({
            chunkId: chunk.id,
            sourceId: chunk.sourceId,
            sourceTitle: src.title,
            collectionId: chunk.collectionId,
            text: chunk.text,
            pageIndex: chunk.pageIndex,
            slideIndex: chunk.slideIndex,
            sheetName: chunk.sheetName,
            bm25Score: score,
            vectorScore: 0,
            fusedScore: score,
          });
        }
      }
    }
    results.sort((a, b) => b.fusedScore - a.fusedScore);
    return results.slice(0, topK);
  });
}

function getLoopRuntime(options: RegisterDesktopIpcOptions): NonNullable<RegisterDesktopIpcOptions['loopRuntime']> {
  if (!options.loopRuntime) {
    throw new Error('loop diagnostics runtime is not registered');
  }
  return options.loopRuntime;
}

function readLoopId(input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('loopId must be a non-empty string');
  }
  return input;
}

async function openLoopOutputDirectory(loopId: string, template: UserLoopTemplate | undefined): Promise<Record<string, unknown>> {
  const target = resolveUserLoopOutputTarget(loopId, template);
  if (!target.ok) return target;
  try {
    await mkdir(target.outputDirectory, { recursive: true });
    const error = await shell.openPath(target.outputDirectory);
    if (error) {
      return { ok: false, loopId, error: 'open_output_directory_failed', message: error, pathLabel: target.outputDirectory };
    }
    return { ok: true, loopId, pathLabel: target.outputDirectory };
  } catch (error) {
    return {
      ok: false,
      loopId,
      error: 'open_output_directory_failed',
      message: error instanceof Error ? error.message : String(error),
      pathLabel: target.outputDirectory,
    };
  }
}

async function readLoopOutputPreview(loopId: string, template: UserLoopTemplate | undefined): Promise<Record<string, unknown>> {
  const target = resolveUserLoopOutputTarget(loopId, template);
  if (!target.ok) return target;
  try {
    const symlinkCheck = await lstat(target.outputPath);
    if (symlinkCheck.isSymbolicLink()) {
      return { ok: false, loopId, error: 'output_file_symlink', pathLabel: target.outputPath };
    }
    if (!symlinkCheck.isFile()) {
      return { ok: false, loopId, error: 'output_not_file', pathLabel: target.outputPath };
    }
    if (symlinkCheck.size > LOOP_OUTPUT_PREVIEW_LIMIT_BYTES) {
      return {
        ok: false,
        loopId,
        error: 'output_file_too_large',
        pathLabel: target.outputPath,
        sizeBytes: symlinkCheck.size,
        limitBytes: LOOP_OUTPUT_PREVIEW_LIMIT_BYTES,
      };
    }

    const file = await openFile(target.outputPath, 'r');
    try {
      const fileStat = await file.stat();
      if (!fileStat.isFile()) {
        return { ok: false, loopId, error: 'output_not_file', pathLabel: target.outputPath };
      }
      if (fileStat.size > LOOP_OUTPUT_PREVIEW_LIMIT_BYTES) {
        return {
          ok: false,
          loopId,
          error: 'output_file_too_large',
          pathLabel: target.outputPath,
          sizeBytes: fileStat.size,
          limitBytes: LOOP_OUTPUT_PREVIEW_LIMIT_BYTES,
        };
      }
      const buffer = Buffer.alloc(fileStat.size);
      if (fileStat.size > 0) {
        await file.read(buffer, 0, fileStat.size, 0);
      }
      if (looksBinary(buffer)) {
        return { ok: false, loopId, error: 'output_file_binary', pathLabel: target.outputPath, sizeBytes: fileStat.size };
      }
      return {
        ok: true,
        loopId,
        pathLabel: target.outputPath,
        content: buffer.toString('utf8'),
        sizeBytes: fileStat.size,
        truncated: false,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    if (code === 'ENOENT') {
      return { ok: false, loopId, error: 'missing_output_file', pathLabel: target.outputPath };
    }
    return {
      ok: false,
      loopId,
      error: 'read_output_preview_failed',
      message: error instanceof Error ? error.message : String(error),
      pathLabel: target.outputPath,
    };
  }
}

async function readLoopTaskResult(
  loopId: string,
  loopRuntime: NonNullable<RegisterDesktopIpcOptions['loopRuntime']>,
  dataRoot: string,
): Promise<Record<string, unknown>> {
  const latestRun = loopRuntime.loopStore.listLoopRuns(loopId, 1)[0];
  if (!latestRun) return { ok: false, loopId, error: 'missing_loop_run' };
  const evidence = loopRuntime.evidenceStore
    .listEvidenceForOwner('loop_run', latestRun.id)
    .filter(record => latestRun.evidenceIds.includes(record.id));
  const taskId = evidence.map(record => readTaskIdFromMetadata(record.metadata)).find(Boolean);
  if (!taskId) {
    const fallback = evidence.find(record => record.summary.trim().length > 0)?.summary.trim();
    if (fallback) return { ok: true, loopId, runId: latestRun.id, content: fallback };
    return { ok: false, loopId, runId: latestRun.id, error: 'missing_task_result_evidence' };
  }

  const snapshotPath = join(dataRoot, 'tasks', 'snapshots', `${taskId}.json`);
  try {
    const raw = await readFile(snapshotPath, 'utf8');
    const snapshot = JSON.parse(raw) as unknown;
    const content = readTaskSnapshotResultSummary(snapshot);
    if (!content) {
      const fallback = evidence.find(record => record.summary.trim().length > 0)?.summary.trim();
      if (fallback) return { ok: true, loopId, runId: latestRun.id, taskId, content: fallback };
      return { ok: false, loopId, runId: latestRun.id, taskId, error: 'missing_task_result_content' };
    }
    return { ok: true, loopId, runId: latestRun.id, taskId, content };
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    return {
      ok: false,
      loopId,
      runId: latestRun.id,
      taskId,
      error: code === 'ENOENT' ? 'missing_task_snapshot' : 'read_task_result_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTaskIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const raw = typeof metadata.taskId === 'string'
    ? metadata.taskId
    : typeof metadata.responseId === 'string'
      ? metadata.responseId
      : '';
  const taskId = raw.trim();
  return /^[A-Za-z0-9_-]+$/.test(taskId) ? taskId : undefined;
}

function readTaskSnapshotResultSummary(snapshot: unknown): string | undefined {
  if (!isRecord(snapshot) || !isRecord(snapshot.result)) return undefined;
  const summary = snapshot.result.summary;
  return typeof summary === 'string' && summary.trim().length > 0 ? summary : undefined;
}

function resolveUserLoopOutputTarget(
  loopId: string,
  template: UserLoopTemplate | undefined,
): { ok: true; outputDirectory: string; outputPath: string } | { ok: false; loopId: string; error: string; message?: string; pathLabel?: string } {
  if (!template) return { ok: false, loopId, error: 'loop_not_found' };
  if (!isAbsolute(template.outputDirectory)) {
    return {
      ok: false,
      loopId,
      error: 'output_directory_relative_legacy',
      pathLabel: template.outputDirectory,
    };
  }
  if (!isSafeLoopOutputFileName(template.outputFileName)) {
    return {
      ok: false,
      loopId,
      error: 'output_file_name_invalid',
      pathLabel: template.outputFileName,
    };
  }
  const outputDirectory = resolve(template.outputDirectory);
  const outputPath = resolve(outputDirectory, template.outputFileName);
  if (dirname(outputPath) !== outputDirectory) {
    return {
      ok: false,
      loopId,
      error: 'output_file_escapes_directory',
      pathLabel: outputPath,
    };
  }
  return { ok: true, outputDirectory, outputPath };
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function readCreateUserLoopTemplateInput(input: unknown): CreateUserLoopTemplateInput {
  if (!isRecord(input)) {
    throw new Error('user loop template input must be an object');
  }
  if (input.kind !== 'markdown_file' && input.kind !== 'task_completion') {
    throw new Error('user loop template kind must be markdown_file or task_completion');
  }
  const base = {
    loopId: readLoopId(input.loopId),
    title: readNonEmptyString(input.title, 'title'),
    description: typeof input.description === 'string' ? input.description : undefined,
    prompt: readNonEmptyString(input.prompt, 'prompt'),
    now: Date.now(),
  };
  let result: CreateUserLoopTemplateInput;
  if (input.kind === 'task_completion') {
    result = { ...base, kind: 'task_completion' };
  } else {
    result = {
      ...base,
      kind: 'markdown_file',
      outputDirectory: readNonEmptyString(input.outputDirectory, 'outputDirectory'),
      outputFileName: readNonEmptyString(input.outputFileName, 'outputFileName'),
    };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleEnabled')) {
    result.scheduleEnabled = input.scheduleEnabled === true;
  }
  if (isRecord(input.scheduleTrigger)) {
    result.scheduleTrigger = input.scheduleTrigger;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'autoRunApproved')) {
    result.autoRunApproved = input.autoRunApproved === true;
  }
  return result;
}

function readNonEmptyString(input: unknown, fieldName: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export async function expandSelectedMaterialPaths(paths: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    try {
      const entry = await stat(path);
      if (entry.isFile()) {
        files.add(path);
      } else if (entry.isDirectory()) {
        for (const file of await listFilesInDirectory(path)) files.add(file);
      }
    } catch {
      // Skip non-existent paths (e.g. pasted text that looks like a path)
    }
  }
  return [...files].sort();
}

async function listFilesInDirectory(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesInDirectory(path));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
