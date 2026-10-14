import { registerGoalNativeQueryIpc } from './goal-native-query-typed-ipc.js';
import { registerMeetingActions10Ipc, captureMeeting10LiveUpdate } from './meeting-actions10-typed-ipc.js';
import { safeMeeting10Thrown } from './meeting-actions10-error-policy.js';
import { registerTask7Ipc, callTask7Producer, captureTask7Output, captureTask7Event } from './task7-typed-ipc.js';
import { registerMaterialAccessIpc } from './material-access-typed-ipc.js';
import { captureMaterialAccessPromise } from './material-access-data.js';
import { registerProjectPlanningIpc } from './project-planning-typed-ipc.js';
import { registerPluginActionIpc } from './plugin-action-typed-ipc.js';
import { openPluginPermissionSettings } from './plugin-action-service.js';
import { registerComputerUseCapabilityReadonlyIpc } from './runtime-status-readonly-typed-ipc.js';
import { registerSkillMutationIpc } from './skill-mutation-typed-ipc.js';
import { registerChannelMcpMutationIpc } from './channel-mcp-mutation-typed-ipc.js';
import { createMeetingMutationService } from './meeting-mutation-service.js';
import { registerMeetingMutationIpc } from './meeting-mutation-typed-ipc.js';
import { registerMeetingReadonlyIpc } from './meeting-readonly-typed-ipc.js';
import { readMeetingAsrReadonly } from './meeting-readonly-data.js';
import { registerChannelMcpReadonlyIpc } from './channel-mcp-readonly-typed-ipc.js';
import { registerSkillListIpc } from './skill-list-typed-ipc.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { createObservationRegistrar } from './observation-typed-ipc.js';
import { createObservationServiceFacade } from './observation-service-facade.js';
import { captureSkillListServiceResult } from './skill-readonly-data.js';
import { registerPluginCatalogIpc } from './plugin-catalog-typed-ipc.js';
import { registerKnowledgeIpc, captureKnowledgeOutput } from './knowledge-typed-ipc.js';
import { registerPrinciplesIpc } from './principles-typed-ipc.js';
import { registerDiagnosticsIpc } from './diagnostics-typed-ipc.js';
import { registerModelProviderIpc } from './model-provider-typed-ipc.js';
import { registerLoopManagementIpc } from './loop-management-typed-ipc.js';
import { MEMORY_IPC_CONTRACTS, type MemoryIpcOperation } from './memory-ipc-contract.js';
import { ARTIFACT_WORKSPACE_OUTPUT_SCHEMAS, ARTIFACT_WORKSPACE_RISK_TAGS } from './artifact-workspace-ipc-contract.js';
import { registerConversationActivityIpc } from './conversation-activity-ipc.js';
import {z, type ZodSchema} from 'zod';
import {registerIpcHandler, type RiskTag} from './ipc-runtime.js';
import {absoluteFilePath, filePathInput, saveFileInput, openFileResult, readFileResult, saveFileResult, ignoredClipboardInput, clipboardFilePathsResult, showSaveDialogInput, showSaveDialogResult} from './file-ipc-schemas.js';
import { parseGoalVerificationDefinition } from '../../src/runtime/goal/verification-definition.js';
import { authorizeDesktopValidationMaterials } from './desktop-validation-materials.js';
import { createDesktopObservationApprovals } from './desktop-observation-approval.js';
import { parseObservationPolicyFile, describeProductObservationPolicy } from '../../src/runtime/sol-pi/product-bootstrap.js';
import { readClipboardPathCandidates } from './clipboard-file-paths.js';
import { app, BrowserWindow, clipboard, dialog, shell, systemPreferences, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';
import type { DesktopLoopRuntime } from './loop-executor.js';
import type { MeetingTranscriber } from './meeting-service.js';
import { createMeetingAudioPermissionService } from './meeting-audio-permission.js';
import type { ArtifactWorkspaceErrorCode } from '../shared/artifact-workspace-types.js';
import { OFFICE_EXTENSIONS } from '../../src/runtime/materials/document-formats.js';
import {
  computeKnowledgeContentHash,
  reconstructKnowledgeSourceText,
} from './kb-source-identity.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { registerDesktopMultiAgentIpc, type MultiAgentIpcEvent } from './desktop-multi-agent-ipc.js';
import { parseGoalRequestId } from '../shared/goal-attachment.js';

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

const GOAL_EVIDENCE_KINDS = new Set([
  'answer', 'file_artifact', 'command_action', 'project_update',
]);

function parseGoalThreadId(value: unknown): string {
  const threadId = typeof value === 'string' ? value.trim() : '';
  if (!threadId || threadId.length > 200) throw new Error('invalid_goal_thread_id');
  return threadId;
}

function parseGoalInput(raw: unknown, operation: 'create' | 'replace'): {
  verificationDefinition?: unknown;
  threadId: string;
  requestId?: string;
  objective: string;
  completionCriterion?: string;
  expectedEvidenceKinds: Array<'answer' | 'file_artifact' | 'command_action' | 'project_update'>;
  turnLimit?: number;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_goal_input');
  const input = raw as Record<string, unknown>;
  const allowed = new Set([
    'threadId', 'objective', 'completionCriterion', 'expectedEvidenceKinds', 'turnLimit', 'requestId', 'verificationDefinition',
  ]);
  const unknown = Object.keys(input).find(key => !allowed.has(key));
  if (unknown) throw new Error(`invalid_goal_field:${unknown}`);
  const requestId = parseGoalRequestId(input.requestId);
  const objective = typeof input.objective === 'string' ? input.objective.trim() : '';
  if (!objective || objective.length > 4_000) throw new Error(`invalid_goal_${operation}_objective`);
  const completionCriterion = typeof input.completionCriterion === 'string'
    ? input.completionCriterion.trim()
    : undefined;
  if (completionCriterion && completionCriterion.length > 4_000) {
    throw new Error('invalid_goal_completion_criterion');
  }
  if (!Array.isArray(input.expectedEvidenceKinds) || input.expectedEvidenceKinds.length === 0) {
    throw new Error('invalid_goal_evidence_kinds');
  }
  const expectedEvidenceKinds = [...new Set(input.expectedEvidenceKinds)].map(value => {
    if (typeof value !== 'string' || !GOAL_EVIDENCE_KINDS.has(value)) {
      throw new Error('invalid_goal_evidence_kind');
    }
    return value as 'answer' | 'file_artifact' | 'command_action' | 'project_update';
  });
  const turnLimit = input.turnLimit;
  if (turnLimit !== undefined && (!Number.isSafeInteger(turnLimit) || (turnLimit as number) < 1 || (turnLimit as number) > 50)) {
    throw new Error('invalid_goal_turn_limit');
  }
  return {
    threadId: parseGoalThreadId(input.threadId), objective,
    ...(input.verificationDefinition === undefined ? {} : { verificationDefinition: parseGoalVerificationDefinition(input.verificationDefinition) }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(completionCriterion ? { completionCriterion } : {}),
    expectedEvidenceKinds,
    ...(turnLimit === undefined ? {} : { turnLimit: turnLimit as number }),
  };
}

function sanitizeTaskContext(raw: unknown): { threadId?: string; taskIds?: string[] } | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_task_context');
  const context = raw as Record<string, unknown>;
  const threadId = context.threadId === undefined ? undefined : parseGoalThreadId(context.threadId);
  let taskIds: string[] | undefined;
  if (context.taskIds !== undefined) {
    if (!Array.isArray(context.taskIds)) throw new Error('invalid_task_context_task_ids');
    taskIds = context.taskIds.map(value => {
      if (typeof value !== 'string' || !value.trim() || value.length > 200) {
        throw new Error('invalid_task_context_task_id');
      }
      return value.trim();
    });
  }
  return {
    ...(threadId ? { threadId } : {}),
    ...(taskIds ? { taskIds } : {}),
  };
}

function sanitizeTaskCreateInput(raw: unknown): {
  prompt: string;
  materials: Array<{ materialId: string; role?: 'customer_material' | 'product_material' | 'template_material' | 'unknown' }>;
  context?: { threadId?: string; taskIds?: string[] };
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_task_input');
  const input = raw as Record<string, unknown>;
  if (typeof input.prompt !== 'string') throw new Error('invalid_task_prompt');
  if (!Array.isArray(input.materials)) throw new Error('invalid_task_materials');
  const roles = new Set(['customer_material', 'product_material', 'template_material', 'unknown']);
  const materials = input.materials.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_task_material');
    const material = value as Record<string, unknown>;
    if (typeof material.materialId !== 'string' || !material.materialId.trim()) throw new Error('invalid_task_material_id');
    if (material.role !== undefined && (typeof material.role !== 'string' || !roles.has(material.role))) {
      throw new Error('invalid_task_material_role');
    }
    return {
      materialId: material.materialId.trim(),
      ...(material.role ? { role: material.role as 'customer_material' | 'product_material' | 'template_material' | 'unknown' } : {}),
    };
  });
  const context = sanitizeTaskContext(input.context);
  return { prompt: input.prompt, materials, ...(context ? { context } : {}) };
}

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
  multiAgentAuthorize?: (event: MultiAgentIpcEvent) => { actorId: string } | null;
  getMainWindow?: () => BrowserWindow | null;
  registerLifetimeDisposer?: (dispose: () => void) => void;
}

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
  const message = safeMeeting10Thrown(error, 'meeting_live_failed');
  if (message === 'aliyun_asr_not_configured'
    || message === 'volcengine_asr_not_configured'
    || /^(?:aliyun|volcengine|meeting)_live_[a-z0-9_]+(?::[a-z0-9_.-]+)?$/i.test(message)) {
    return message;
  }
  return 'meeting_live_failed';
}

export async function registerDesktopIpc(
  ipcMain: IpcHandleRegistrar,
  window: BrowserWindow,
  services: DesktopServices,
  options: RegisterDesktopIpcOptions = {}
): Promise<void> {
  const fileHandler = <I, O>(channel: string, input: ZodSchema<I>, output: ZodSchema<O>, riskTags: RiskTag[], handler: (input: I, event: IpcMainInvokeEvent) => Promise<O>, rolloutRound: 1 | 2 | 3 = 1) => registerIpcHandler({
    registrar: ipcMain, channel, input, output, riskTags, sourceFile: 'desktop/electron/ipc.ts', rolloutRound, handler,
  });
  const primaryWindow = () => options.getMainWindow?.() ?? window;
  const taskActor = (event: IpcMainInvokeEvent) => {
    const actor = options.multiAgentAuthorize?.(event);
    if (!actor) throw new Error('task_actor_forbidden');
    return { ...actor, requestSource: 'user' as const };
  };
  const recheckTaskActor = (event: IpcMainInvokeEvent, actor: { actorId: string }) => {
    if (taskActor(event).actorId !== actor.actorId) throw Error('task_actor_forbidden');
  };
  const task7Producers = new Map<string, IpcHandlerListener>();
  const disposeMultiAgentViews = registerDesktopMultiAgentIpc(ipcMain, services.multiAgent, {
    authorize: event => options.multiAgentAuthorize?.(event) ?? null,
  });
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
  const unsubscribeGoalChanges = services.subscribeGoalChanged?.((change) => {
    const targets = typeof BrowserWindow?.getAllWindows === 'function'
      ? BrowserWindow.getAllWindows()
      : [window];
    for (const target of targets.length > 0 ? targets : [window]) {
      if (!target.isDestroyed()) target.webContents.send('desktop:goal:changed', change);
    }
  });
  const unsubscribeGoalTaskPrepared = services.subscribeGoalTaskPrepared?.((prepared) => {
    const targets = typeof BrowserWindow?.getAllWindows === 'function'
      ? BrowserWindow.getAllWindows()
      : [window];
    for (const target of targets.length > 0 ? targets : [window]) {
      if (!target.isDestroyed()) target.webContents.send('desktop:goal:taskPrepared', prepared);
    }
  });
  const disposeApplicationViews = () => {
    disposeMultiAgentViews();
    unsubscribeArtifactWorkspaceChanges?.();
    unsubscribeGoalChanges?.();
    unsubscribeGoalTaskPrepared?.();
  };
  options.registerLifetimeDisposer?.(disposeApplicationViews);
  const onPrimaryClosed = () => {
    if (!options.registerLifetimeDisposer) disposeApplicationViews();
    artifactWorkspaceServices.closeArtifactWorkspaceViewKey?.('primary');
  };
  if (typeof window.once === 'function') window.once('closed', onPrimaryClosed);
  const secondaryArtifactWorkspaceViewKeys = new Map<number, string>();
  const artifactWorkspaceViewKey = (event: IpcMainInvokeEvent): string => {
    const senderWindow = typeof BrowserWindow?.fromWebContents === 'function'
      ? BrowserWindow.fromWebContents(event.sender)
      : undefined;
    if (senderWindow === primaryWindow() || senderWindow?.webContents.id === primaryWindow().webContents.id || event.sender.id === primaryWindow().webContents.id) {
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

  const artifactHandler = (
    operation: ArtifactWorkspaceOperation,
    handler: (input: ArtifactWorkspaceIpcRecord, event: IpcMainInvokeEvent) => Promise<unknown>,
  ) => registerIpcHandler({
    registrar: ipcMain,
    channel: `desktop:artifactWorkspace:${operation}`,
    input: z.custom<ArtifactWorkspaceIpcRecord>(isRecordValue, {
      message: 'Artifact workspace input must be an object',
    }).transform(raw => sanitizeArtifactWorkspaceIpcInput(operation, raw)),
    output: ARTIFACT_WORKSPACE_OUTPUT_SCHEMAS[operation],
    sourceFile: 'desktop/electron/ipc.ts',
    rolloutRound: 3,
    riskTags: ARTIFACT_WORKSPACE_RISK_TAGS[operation],
    inputError: error => normalizeArtifactWorkspaceIpcError(error instanceof z.ZodError
      ? { code: 'invalid_target', message: 'Artifact workspace input must be an object' }
      : error),
    outputError: () => normalizeArtifactWorkspaceIpcError(new Error('ipc_contract_violation')),
    handler,
  });
  artifactHandler('getArtifactWorkspaceSnapshot', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'getArtifactWorkspaceSnapshot', rawInput, {
      viewKey: artifactWorkspaceViewKey(event),
      sanitizeData: sanitizeArtifactWorkspaceSnapshotOutput,
    });
  });
  artifactHandler('closeArtifactWorkspace', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'closeArtifactWorkspace', rawInput, {
      viewKey: artifactWorkspaceViewKey(event),
    });
  });
  artifactHandler('readArtifactWorkspaceVersionPreview', async (rawInput, _event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'readArtifactWorkspaceVersionPreview', rawInput, {
      sanitizeData: sanitizeArtifactWorkspacePreviewOutput,
    });
  });
  artifactHandler('exportArtifactWorkspaceVersion', async (rawInput, event) => {
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
  artifactHandler('createArtifactPlaceholder', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactPlaceholder', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('submitArtifactGeneration', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'submitArtifactGeneration', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('cancelArtifactGeneration', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'cancelArtifactGeneration', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('retryArtifactGeneration', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'retryArtifactGeneration', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('preferArtifactVersion', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'preferArtifactVersion', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('removeArtifactWorkspaceNode', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'removeArtifactWorkspaceNode', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('updateArtifactWorkspaceLayout', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'updateArtifactWorkspaceLayout', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('saveArtifactWorkspaceViewport', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'saveArtifactWorkspaceViewport', rawInput, {
      viewKey: artifactWorkspaceViewKey(event),
    });
  });
  artifactHandler('createArtifactWorkspaceCollection', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactWorkspaceCollection', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('createArtifactWorkspaceNote', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactWorkspaceNote', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('updateArtifactWorkspaceNote', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'updateArtifactWorkspaceNote', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('createArtifactWorkspaceRelation', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'createArtifactWorkspaceRelation', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('setArtifactCollectionMembership', async (rawInput, event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'setArtifactCollectionMembership', rawInput, { viewKey: artifactWorkspaceViewKey(event) });
  });
  artifactHandler('recordArtifactWorkspaceEvent', async (rawInput, _event) => {
    return invokeArtifactWorkspaceIpcOperation(artifactWorkspaceServices, 'recordArtifactWorkspaceEvent', rawInput);
  });
  registerModelProviderIpc(ipcMain, services, options.multiAgentAuthorize as Parameters<typeof registerModelProviderIpc>[2]);
  registerProjectPlanningIpc(ipcMain, async (_event, input) => {
    log('info', 'startProjectPlanning', { projectId: input?.projectId });
    const r = services.startProjectPlanning(input, 'user');
    log('info', 'startProjectPlanning ok', { ok: r?.ok });
    return r;
  });
  fileHandler('desktop:readClipboardFilePaths', ignoredClipboardInput, clipboardFilePathsResult, ['clipboard', 'fs-read'], async () => expandSelectedMaterialPaths(readClipboardPathCandidates(clipboard)), 2);
  const materialAccessProducers = new Map<string, IpcHandlerListener>([
    ['desktop:readClipboardImage', async () => {
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
  }],
    ['desktop:selectDirectory', async () => {
    log('info', 'selectDirectory');
    const result = await captureMaterialAccessPromise(dialog.showOpenDialog(primaryWindow(), {
      properties: ['openDirectory', 'createDirectory'],
    }), value => captureIpcData(value, 'material_access_projection_unavailable'));
    if (result.canceled || !result.filePaths[0]) {
      log('info', 'selectDirectory cancelled');
      return { filePath: '' };
    }
    log('info', 'selectDirectory ok', { filePath: result.filePaths[0] });
    return { filePath: result.filePaths[0] };
  }],
    ['desktop:selectMaterials', async () => {
    log('info', 'selectMaterials');
    const result = await captureMaterialAccessPromise(dialog.showOpenDialog(primaryWindow(), {
      properties: ['openFile', 'multiSelections'],
    }), value => captureIpcData(value, 'material_access_projection_unavailable'));
    if (result.canceled) {
      log('info', 'selectMaterials cancelled');
      return { filePaths: [] };
    }
    const expanded = await expandSelectedMaterialPaths(result.filePaths);
    log('info', 'selectMaterials ok', { fileCount: expanded.length });
    return { filePaths: expanded };
  }],
    ['desktop:importMaterial', (_event, input) => { log('info', 'importMaterial', { filePath: input.filePath }); return services.importMaterial(input, 'user'); }],
    ['desktop:openArtifact', (_event, input) => { log('info', 'openArtifact', { artifactId: input.artifactId }); return services.openArtifact(input.artifactId); }],
    ['desktop:selectHtmlEditMedia', async (_event, input) => {
    const kind = input?.kind as 'image' | 'svg' | undefined;
    if (kind !== 'image' && kind !== 'svg') {
      return { canceled: true, filePath: '', content: '', error: 'invalid_kind' };
    }

    const result = await captureMaterialAccessPromise(dialog.showOpenDialog(primaryWindow(), {
      properties: ['openFile'],
      filters: kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }]
        : [{ name: 'SVG', extensions: ['svg'] }],
    }), value => captureIpcData(value, 'material_access_projection_unavailable'));
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
      return { canceled: true, filePath, content: '', error: 'media_read_failed' };
    }
  }],
  ]);
  registerMaterialAccessIpc(ipcMain, materialAccessProducers);
  const observationSenders = new Map<string, {sender:IpcMainInvokeEvent['sender'];control:object}>();
  const watchedObservationSenders = new WeakSet<object>();
  const observationApprovals = createDesktopObservationApprovals({
    async selectPolicy(sender) {
      const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender as IpcMainInvokeEvent['sender'])!, { properties: ['openFile'], filters: [{ name: 'Observation policy', extensions: ['json'] }] });
      if (selected.canceled || selected.filePaths.length !== 1) return null;
      const policy = parseObservationPolicyFile(selected.filePaths[0]); return {policy,summary:describeProductObservationPolicy(policy)};
    },
    async confirm(sender, summary, kind) {
      const zh = app.getLocale().startsWith('zh');
      const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(sender as IpcMainInvokeEvent['sender'])!, {
        type:'warning',defaultId:0,cancelId:0,buttons:zh?['取消','明确同意']:['Cancel','Explicitly agree'],
        message:kind==='compound'
          ? (zh?'允许本次任务试用编辑后验证的融合执行？每一步仍需通过工具权限检查；执行结果不明时将停止后续变更。':'Allow the edit-and-validate execution experiment for this task? Each step still requires tool permission; uncertain execution stops further mutations.')
          : kind==='semantic'
          ? (zh?'允许在所列次数和预留预算内，额外调用模型压缩本次任务的上下文？按发送前核验的价格预留，实际账单由服务商计费；实验模式可能增加费用。':'Allow extra model calls to summarize this task within the listed call and reservation budget? Reservations use verified pre-dispatch prices; the provider determines the actual bill. Experiment mode may increase costs.')
          : kind==='persistence' ? (zh?'允许本次任务本地保存所选来源的未分类全文（包含原本被截断的尾部）？':'Allow this task to store unclassified full text from these exact sources, including truncated tails?') : (zh?'允许向以下精确模型和目的地披露这些内容并召回？':'Allow disclosure and recall of this content to this exact model and destination?'),
        detail:JSON.stringify(summary,null,2),
      });return result.response===1;
    },
  });
  const observationSender = (event:IpcMainInvokeEvent) => {
    if (!options.multiAgentAuthorize?.(event) || event.sender.isDestroyed()) throw new Error('observation_user_sender_required');
    if(!watchedObservationSenders.has(event.sender)) {
      watchedObservationSenders.add(event.sender);event.sender.once('destroyed',()=>{
        observationApprovals.destroySender(event.sender);
        for(const [taskId,record]of observationSenders)if(record.sender===event.sender){void services.revokeObservationTask(taskId,{requestSource:'user',control:record.control}).catch(()=>{});observationSenders.delete(taskId);}
      });
    }return event.sender;
  };
  const observationService = createObservationServiceFacade(services);
  // Provisional round36; final allocation remains with integration owner.
  const observationIpc = createObservationRegistrar(ipcMain, event => { observationSender(event); }, 36);
  observationIpc.handle('desktop:prepareObservationTask', async(event,input) => {
    if(input!==undefined)throw new Error('observation_input_invalid');return observationApprovals.prepare(observationSender(event));
  });
  observationIpc.handle('desktop:createObservationTask', async(event,raw) => {
    const sender=observationSender(event);
    if(!raw||typeof raw!=='object'||Object.keys(raw).some(key=>!['draftId','prompt','threadId'].includes(key))||typeof raw.draftId!=='string'||typeof raw.prompt!=='string'||!raw.prompt.trim()||raw.prompt.length>100000||raw.threadId!==undefined&&(typeof raw.threadId!=='string'||!/^[a-zA-Z0-9_-]{1,256}$/.test(raw.threadId)))throw new Error('observation_input_invalid');
    const approval=observationApprovals.consume(sender,raw.draftId);
    const result=await observationService.createObservationTask({prompt:raw.prompt,materials:[],permissionMode:'default',...(raw.threadId?{threadId:raw.threadId}:{})}, {requestSource:'user',approval,
      authorizeValidationMaterials:async request=>{
        if(sender.isDestroyed())throw Error('observation_sender_destroyed');
        const window=BrowserWindow.fromWebContents(sender);if(!window||window.isDestroyed())throw Error('observation_sender_destroyed');
        return authorizeDesktopValidationMaterials({...request,requestSource:'user',window,cwd:request.workspaceRoot});
      },
      onPrompt:async(tool,input)=>{
        if(sender.isDestroyed())return false;const detail=JSON.stringify({tool,input},null,2);if(detail.length>65536)return false;
        const zh=app.getLocale().startsWith('zh');const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(sender)!, {type:'question',defaultId:0,cancelId:0,buttons:zh?['拒绝','仅本次允许']:['Deny','Allow once'],message:zh?'确认本次工具执行？':'Approve this exact tool execution?',detail});
        return !sender.isDestroyed()&&answer.response===1;
      }});
    if(sender.isDestroyed()){await services.revokeObservationTask(result.taskId,{requestSource:'user',control:result.control}).catch(()=>{});throw new Error('observation_sender_destroyed');}
    observationSenders.set(result.taskId,{sender,control:result.control});return {taskId:result.taskId};
  });
  const observationControl=(action:'stop'|'revoke'|'status')=>async(event:IpcMainInvokeEvent,input:unknown)=>{
      const value=input as {taskId:string};
      const sender=observationSender(event);
      if(!input||typeof input!=='object'||Object.keys(input).length!==1||typeof value.taskId!=='string'||(action!=='status'&&observationSenders.get(value.taskId)?.sender!==sender))throw new Error('observation_task_owner_required');
      if(action==='stop')await observationService.stopObservationTask(value.taskId,{requestSource:'user',control:observationSenders.get(value.taskId)!.control});
      if(action==='revoke')await observationService.revokeObservationTask(value.taskId,{requestSource:'user',control:observationSenders.get(value.taskId)!.control});
      const facts=observationService.observationTaskDiagnosticFacts(value.taskId);
      return {mode:await observationService.observationTaskStatus(value.taskId),...facts};
  };
  observationIpc.handle('desktop:stopObservationTask',observationControl('stop'));
  observationIpc.handle('desktop:revokeObservationTask',observationControl('revoke'));
  observationIpc.handle('desktop:getObservationTaskStatus',observationControl('status'));
  task7Producers.set('desktop:createTask', async (_event, input) => {
    const actor = taskActor(_event);
    const clean = sanitizeTaskCreateInput(input);
    log('info', 'createTask', { prompt: clean.prompt.slice(0, 50) });
    const r = captureTask7Output('createTask', await callTask7Producer(() => services.createTask(clean, actor)));
    log('info', 'createTask ok', { taskId: r?.taskId });
    return r;
  });
  ipcMain.handle('desktop:goal:get', async (_event, input) => (
    services.getGoal(parseGoalThreadId(input?.threadId))
  ));
  ipcMain.handle('desktop:goal:create', async (_event, input) => (
    services.createGoal(parseGoalInput(input, 'create'))
  ));
  ipcMain.handle('desktop:goal:pause', async (_event, input) => (
    services.pauseGoal(parseGoalThreadId(input?.threadId))
  ));
  ipcMain.handle('desktop:goal:resume', async (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_goal_resume_input');
    const fields = Object.keys(input).filter(key => !['threadId', 'turnLimit', 'requestId'].includes(key));
    if (fields.length > 0) throw new Error(`invalid_goal_field:${fields[0]}`);
    const requestId = parseGoalRequestId(input.requestId);
    const turnLimit = input.turnLimit;
    if (turnLimit !== undefined && (!Number.isSafeInteger(turnLimit) || turnLimit < 1 || turnLimit > 50)) {
      throw new Error('invalid_goal_turn_limit');
    }
    return services.resumeGoal({
      threadId: parseGoalThreadId(input.threadId),
      ...(requestId === undefined ? {} : { requestId }),
      ...(turnLimit === undefined ? {} : { turnLimit }),
    });
  });
  const parseGoalPublicationInput = (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_goal_publication_input');
    if (Object.keys(input).some(key => key !== 'threadId')) throw Error('invalid_goal_publication_field');
    return { threadId: parseGoalThreadId((input as { threadId?: unknown }).threadId), requestSource: 'user' as const };
  };
  registerGoalNativeQueryIpc(ipcMain,
    threadId => services.getGoalNativeMutation(threadId),
    parseGoalPublicationInput,
    event => {
      if (!options.multiAgentAuthorize?.(event) || event.sender.isDestroyed()) throw Error('goal_native_query_sender_forbidden');
    });
  ipcMain.handle('desktop:goal:recoverNativeMutation', async (_event, input) => services.recoverGoalNativeMutation(parseGoalPublicationInput(input)));
  ipcMain.handle('desktop:goal:cancelNativeMutation', async (_event, input) => services.cancelGoalNativeMutation(parseGoalPublicationInput(input)));
  ipcMain.handle('desktop:goal:continueNativeMutation', async (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['threadId','requestId'].includes(key))) throw Error('invalid_goal_native_input');
    const requestId = parseGoalRequestId(input.requestId);
    return services.continueGoalNativeMutation({ threadId: parseGoalThreadId(input.threadId), requestSource: 'user', ...(requestId === undefined ? {} : { requestId }) });
  });
  ipcMain.handle('desktop:goal:recoverPublication', async (_event, input) => services.recoverGoalPublication(parseGoalPublicationInput(input)));
  ipcMain.handle('desktop:goal:continuePublication', async (_event, input) => services.continueGoalPublication(parseGoalPublicationInput(input)));
  ipcMain.handle('desktop:goal:cancel', async (_event, input) => (
    services.cancelGoal(parseGoalThreadId(input?.threadId))
  ));
  ipcMain.handle('desktop:goal:replace', async (_event, input) => (
    services.replaceGoal(parseGoalInput(input, 'replace'))
  ));
  ipcMain.handle('desktop:goal:ackTaskAttached', async (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_goal_attachment');
    const attachmentId = typeof input.attachmentId === 'string' ? input.attachmentId.trim() : '';
    if (!attachmentId || attachmentId.length > 200) throw new Error('invalid_goal_attachment');
    return services.ackGoalTaskAttached({
      threadId: parseGoalThreadId(input.threadId), attachmentId,
    });
  });
  ipcMain.handle('desktop:goal:setUserQueuePending', async (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.pending !== 'boolean') {
      throw new Error('invalid_goal_queue_state');
    }
    return services.setGoalUserQueuePending({
      threadId: parseGoalThreadId(input.threadId), pending: input.pending,
    });
  });
  task7Producers.set('desktop:answerQuestion', async (_event, input) => {
    const actor = taskActor(_event); await callTask7Producer(() => services.authorizeTaskRead(input.taskId, actor)); recheckTaskActor(_event, actor);
    log('info', 'answerQuestion', { taskId: input?.taskId });
    const r = captureTask7Output('answerQuestion', await callTask7Producer(() => services.answerQuestion(input, actor)));
    log('info', 'answerQuestion ok');
    return r;
  });
  task7Producers.set('desktop:cancelTask', async (_event, input) => {
    const actor = taskActor(_event); await callTask7Producer(() => services.authorizeTaskRead(input.taskId, actor)); recheckTaskActor(_event, actor);
    log('info', 'cancelTask', { taskId: input?.taskId });
    captureTask7Output('cancelTask', await callTask7Producer(() => services.cancelTask(input.taskId, actor)));
    log('info', 'cancelTask ok');
  });
  task7Producers.set('desktop:getActiveTask', async (_event) => {
    const actor = taskActor(_event);
    const r = captureTask7Output('getActiveTask', await callTask7Producer(() => services.getActiveTask()));
    recheckTaskActor(_event, actor);
    if (r) await callTask7Producer(() => services.authorizeTaskRead(r.taskId, actor));
    log('debug', 'getActiveTask', { taskId: r?.taskId ?? null });
    return r;
  });
  task7Producers.set('desktop:recoverTask', async (_event, input) => {
    const actor = taskActor(_event); await callTask7Producer(() => services.authorizeTaskRead(input.taskId, actor)); recheckTaskActor(_event, actor);
    log('info', 'recoverTask', { taskId: input?.taskId });
    const r = captureTask7Output('recoverTask', await callTask7Producer(() => services.recoverTask(input.taskId, input.legacyPrompt)));
    await callTask7Producer(() => services.authorizeTaskRead(r.snapshot.taskId, actor));
    recheckTaskActor(_event, actor);
    log('info', 'recoverTask ok', { status: r?.snapshot?.status });
    return r;
  });
  fileHandler('desktop:openFileInSystemApp', filePathInput, openFileResult, ['shell-open'], async (input) => {
    const filePath = input?.filePath as string;
    if (!filePath || !isAbsolute(filePath)) return { ok: false as const, error: 'invalid_path' };
    const error = await shell.openPath(filePath);
    return error ? { ok: false as const, error } : { ok: true as const };
  });
  fileHandler('desktop:readFileContent', filePathInput, readFileResult, ['fs-read'], async (input) => {
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
  const disposeActivity = registerConversationActivityIpc(ipcMain, services.conversationActivity, event => options.multiAgentAuthorize?.(event) ?? null);
  options.registerLifetimeDisposer?.(disposeActivity);
  const activeTaskSubs = new Map<string, AbortController>();
  const activeTaskSubIds = new Map<string, string>();
  options.registerLifetimeDisposer?.(() => { for (const controller of activeTaskSubs.values()) controller.abort(); activeTaskSubs.clear(); activeTaskSubIds.clear(); });
  ipcMain.handle('desktop:unsubscribeTask', async (_event, ...args) => {
    taskActor(_event);
    const data = captureIpcData(args, 'task_input_invalid');
    const parsed = z.tuple([z.object({ taskId: z.string().min(1), subscriptionId: z.string().min(1).max(256).optional() }).strict()]).safeParse(data);
    if (!parsed.success) throw Error('task_input_invalid');
    const [input] = parsed.data;
    const key = `${(_event?.sender ?? primaryWindow().webContents).id}:${input.taskId}`;
    if (typeof input.subscriptionId === 'string' && activeTaskSubIds.get(key) === input.subscriptionId) {
      activeTaskSubs.get(key)?.abort(); activeTaskSubs.delete(key); activeTaskSubIds.delete(key);
    }
  });
  task7Producers.set('desktop:subscribeTask', async (_event, input) => {
    const actor = taskActor(_event); await callTask7Producer(() => services.authorizeTaskRead(input.taskId, actor)); recheckTaskActor(_event, actor);
    if (input.sinceIndex !== undefined && (!Number.isSafeInteger(input.sinceIndex) || input.sinceIndex < 0)) throw new Error('invalid_task_event_cursor');
    if (input.subscriptionId !== undefined && (typeof input.subscriptionId !== 'string' || !input.subscriptionId.length || input.subscriptionId.length > 256)) throw new Error('invalid_task_subscription_id');
    const taskId = input.taskId as string;
    const target = _event?.sender ?? primaryWindow().webContents;
    const subscriptionKey = `${target.id}:${taskId}`;
    const sinceIndex = typeof input.sinceIndex === 'number' ? input.sinceIndex : undefined;
    log('info', 'subscribeTask', { taskId, sinceIndex });

    // Cancel any existing subscription for this taskId to prevent duplicate streams
    const prev = activeTaskSubs.get(subscriptionKey);
    if (prev) {
      prev.abort();
      activeTaskSubs.delete(subscriptionKey);
    }

    const controller = new AbortController();
    activeTaskSubs.set(subscriptionKey, controller);
    activeTaskSubIds.set(subscriptionKey, input.subscriptionId ?? 'legacy');
    const onDestroyed = () => controller.abort();
    target.once?.('destroyed', onDestroyed);

    void (async () => {
      try {
        const stream = sinceIndex !== undefined
          ? services.subscribeTask(taskId, { sinceIndex, signal: controller.signal })
          : services.subscribeTask(taskId, { signal: controller.signal });
        for await (const event of stream) {
          if (controller.signal.aborted || target.isDestroyed?.()) {
            break;
          }
          const dto = captureTask7Event(event);
          await callTask7Producer(() => services.authorizeTaskRead(taskId, actor));
          if (controller.signal.aborted || target.isDestroyed?.()) break;
          recheckTaskActor(_event, actor);
          target.send(`desktop:taskEvent:${taskId}`, dto);
        }
        log('info', 'subscribeTask stream ended', { taskId });
      } catch (e) {
        if (!controller.signal.aborted) {
          log('error', 'subscribeTask error', { taskId, message: 'task_subscription_failed' });
        }
      } finally {
        target.removeListener?.('destroyed', onDestroyed);
        if (activeTaskSubs.get(subscriptionKey) === controller) {
          activeTaskSubs.delete(subscriptionKey);
          activeTaskSubIds.delete(subscriptionKey);
        }
      }
    })();
  });
  const skillListProducers = new Map<string, IpcHandlerListener>([
    ['desktop:listSkills', () => captureSkillListServiceResult(services.listSkills(), count => log('info', 'listSkills', { count }))],
  ]);
  registerSkillListIpc(ipcMain, skillListProducers);
  const skillMutationProducers = new Map<string, IpcHandlerListener>([
    ['desktop:installSkill', (_event, skillName) => services.installSkill(skillName, { requestSource: 'user' })],
    ['desktop:uninstallSkill', (_event, skillName) => services.uninstallSkill(skillName, { requestSource: 'user' })],
  ]);
  registerSkillMutationIpc(ipcMain, skillMutationProducers);
  // Channel IPC
  const channelMcpReadonlyProducers = new Map<string, IpcHandlerListener>([
    ['desktop:listChannels', () => services.listChannels()],
    ['desktop:listMCPInstalls', () => services.listMCPInstalls()],
  ]);
  registerChannelMcpReadonlyIpc(ipcMain, channelMcpReadonlyProducers);
  const channelMcpMutationProducers = new Map<string, IpcHandlerListener>([
    ['desktop:testChannel', (_event, id) => services.testChannel(id, 'user')],
    ['desktop:createChannel', (_event, input) => services.createChannel(input, 'user')],
    ['desktop:updateChannel', (_event, id, input) => services.updateChannel(id, input, 'user')],
    ['desktop:deleteChannel', (_event, id) => services.deleteChannel(id, 'user')],
    ['desktop:createMCPInstall', (_event, input) => services.createMCPInstall(input, 'user')],
    ['desktop:updateMCPInstall', (_event, id, input) => services.updateMCPInstall(id, input, 'user')],
    ['desktop:deleteMCPInstall', (_event, id) => services.deleteMCPInstall(id, 'user')],
  ]);
  registerChannelMcpMutationIpc(ipcMain, channelMcpMutationProducers);
  // Plugin MCP servers
  registerPluginCatalogIpc(ipcMain, services);
  // Design v58 §7.2: `setPluginMcpServerEnabled` only mutated a view model and
  // had no durable desired-state store, and the blanket restart bypassed the CUA
  // preference. Both are deleted; retry is component-scoped and user-sourced.
  registerComputerUseCapabilityReadonlyIpc(ipcMain, () => services.getComputerUseCapabilityStatus());
  ipcMain.handle('desktop:enableComputerUse', () => services.enableComputerUse({ requestSource: 'user' }));
  ipcMain.handle('desktop:reconnectComputerUse', () => services.reconnectComputerUse({ requestSource: 'user' }));
  ipcMain.handle('desktop:disableComputerUse', () => services.disableComputerUse({ requestSource: 'user' }));
  const pluginActionProducers = new Map<string, IpcHandlerListener>([
    ['desktop:installPlugin', (_event, name) => services.installPlugin(name, 'user')],
    ['desktop:installPluginDependency', (_event, input) => services.installPluginDependency({ ...input, requestSource: 'user' })],
    ['desktop:updatePluginDependency', (_event, input) => services.updatePluginDependency({ ...input, requestSource: 'user' })],
    ['desktop:cancelPluginDependencyTask', (_event, input) => services.cancelPluginDependencyTask({ ...input, requestSource: 'user' })],
    ['desktop:diagnosePluginDependency', (_event, input) => services.diagnosePluginDependency(input, 'user')],
    ['desktop:retryPluginComponent', (_event, input) => services.retryPluginComponent({ componentId: input.componentId, requestSource: 'user' })],
    ['desktop:openPluginDependencyPermissionSettings', (_event, input) => openPluginPermissionSettings(input, 'user', url => shell.openExternal(url))],
  ]);
  registerPluginActionIpc(ipcMain, pluginActionProducers);
  task7Producers.set('desktop:createTaskWithFiles', async (_event, input) => {
    const actor = taskActor(_event);
    const context = sanitizeTaskContext(input.context);
    log('info', 'createTaskWithFiles', { prompt: input.prompt.slice(0, 50), files: input.filePaths.length });
    const expanded = await callTask7Producer(() => expandSelectedMaterialPaths(input.filePaths));
    recheckTaskActor(_event, actor);
    const r = captureTask7Output('createTaskWithFiles', await callTask7Producer(() => services.createTaskWithFiles({
      prompt: input.prompt,
      filePaths: expanded,
      ...(context ? { context } : {}),
    }, actor)));
    log('info', 'createTaskWithFiles ok', { taskId: r?.taskId });
    return r;
  });
  registerTask7Ipc(ipcMain, task7Producers, event => { taskActor(event); });
  registerDiagnosticsIpc(ipcMain, services);

  registerLoopManagementIpc(ipcMain, options.loopRuntime);

  // ---- Memory ----
  const { getDesktopMemoryStore } = await import('./desktop-services.js');
  const { parseMemories } = await import('./memory-import-parser.js');
  const memoryStore = getDesktopMemoryStore(services.getDataRoot());

  const memoryHandler = (operation: MemoryIpcOperation, listener: IpcHandlerListener) => {
    const contract = MEMORY_IPC_CONTRACTS[operation];
    const common = {
      registrar: ipcMain, channel: `desktop:${operation}`, output: contract.output,
      sourceFile: 'desktop/electron/ipc.ts', rolloutRound: 4 as const,
      riskTags: contract.riskTags, inputError: contract.inputError, outputError: contract.outputError,
    };
    if (contract.payloadMode === 'tuple') {
      registerIpcHandler({ ...common, payloadMode: 'tuple', input: contract.input as ZodSchema<unknown[]>, handler: async (args, event) => listener(event, ...args) });
    } else {
      registerIpcHandler({ ...common, input: contract.input, handler: async (input, event) => listener(event, input) });
    }
  };
  memoryHandler('listMemories', async () => {
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
  memoryHandler('createMemory', async (_event, input: { content: string; tags: string[]; source?: string }) => {
    try {
      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await memoryStore.save({
        id, scope: 'global', title: input.content.slice(0, 80),
        summary: input.content, tags: input.tags, updatedAt: Date.now(), type: 'user',
      });
      return { id, content: input.content, tags: input.tags, createdAt: Date.now() };
    } catch (e) { log('error', 'createMemory failed', e); throw e; }
  });
  memoryHandler('updateMemory', async (_event, input: { id: string; content?: string; tags?: string[] }) => {
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
  memoryHandler('deleteMemory', async (_event, id: string) => {
    try { return await memoryStore.delete?.(id) ?? false; }
    catch (e) { log('error', 'deleteMemory failed', e); throw e; }
  });
  memoryHandler('importMemories', async (_event, raw: string) => {
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
  memoryHandler('memoryStats', async () => {
    try { return memoryStore.getStats?.() ?? null; }
    catch (e) { log('error', 'memoryStats failed', e); return null; }
  });
  memoryHandler('memoryCompact', async () => {
    try { await memoryStore.compact?.(); return true; }
    catch (e) { log('error', 'memoryCompact failed', e); return false; }
  });
  memoryHandler('memoryPersonaTraits', async () => {
    try { return memoryStore.getPersonaTraits?.() ?? []; }
    catch (e) { log('error', 'memoryPersonaTraits failed', e); return []; }
  });
  memoryHandler('memoryListLayer', async (_event, layer: number, limit?: number, offset?: number) => {
    try { return memoryStore.listLayer?.(layer, limit ?? 50, offset ?? 0) ?? []; }
    catch (e) { log('error', 'memoryListLayer failed', e); return []; }
  });
  memoryHandler('memoryDeleteEntry', async (_event, id: string, layer: number) => {
    try { return await memoryStore.delete?.(id, layer) ?? false; }
    catch (e) { log('error', 'memoryDeleteEntry failed', e); return false; }
  });
  memoryHandler('memoryClearAll', async () => {
    try { memoryStore.clearAll?.(); return true; }
    catch (e) { log('error', 'memoryClearAll failed', e); return false; }
  });
  memoryHandler('memoryGetModelId', async () => {
    try {
      const config = await (await import('../../src/utils/config.js')).loadConfig();
      return config.memory?.modelId ?? null;
    } catch { return null; }
  });
  memoryHandler('memorySetModelId', async (_event, modelId: string | null) => {
    try {
      const { loadConfig, saveConfig: saveConfigFn } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      if (!config.memory) config.memory = {};
      config.memory.modelId = modelId ?? undefined;
      await saveConfigFn(config);
      return true;
    } catch (e) { log('error', 'memorySetModelId failed', e); return false; }
  });

  memoryHandler('getEmbeddingModels', async () => {
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

  memoryHandler('downloadEmbeddingModel', async (_event, modelId: string) => {
    const { downloadModel } = await import('../../src/ai/memory/model-registry.js');
    await downloadModel(modelId);
  });

  memoryHandler('setEmbeddingModel', async (_event, modelId: string) => {
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

  fileHandler('desktop:artifactBackup', absoluteFilePath, z.string().nullable(), ['fs-read', 'fs-write'], async (filePath) => {
    const sid = sessionHash(filePath);
    return backupArtifact(filePath, sid);
  });

  fileHandler('desktop:artifactRevert', absoluteFilePath, z.boolean(), ['fs-write'], async (filePath) => {
    const sid = sessionHash(filePath);
    const ok = revertArtifact(filePath, sid);
    if (ok && !primaryWindow().isDestroyed()) primaryWindow().webContents.send('desktop:artifactFileChanged', filePath);
    return ok;
  });

  fileHandler('desktop:artifactCleanup', absoluteFilePath, z.void(), ['fs-delete'], async (filePath) => {
    const sid = sessionHash(filePath);
    cleanupBackups(sid);
  });

  fileHandler('desktop:artifactWatch', absoluteFilePath, z.void(), ['fs-watch'], async (filePath) => {
    watchArtifactFile(filePath, () => {
      if (!primaryWindow().isDestroyed()) primaryWindow().webContents.send('desktop:artifactFileChanged', filePath);
    });
  });

  fileHandler('desktop:artifactUnwatch', absoluteFilePath, z.void(), ['fs-watch'], async (filePath) => {
    unwatchArtifactFile(filePath);
  });

  // ---- File Export ----
  fileHandler('desktop:showSaveDialog', showSaveDialogInput, showSaveDialogResult, ['dialog'], async (input) => {
    log('info', 'showSaveDialog', { defaultPath: input?.defaultPath });
    const result = await dialog.showSaveDialog(primaryWindow(), {
      defaultPath: input?.defaultPath,
      // Generic downloads retain their extension; callers specify format filters for exports.
      filters: input?.filters ?? undefined,
    });
    if (result.canceled || !result.filePath) {
      log('info', 'showSaveDialog cancelled');
      return { canceled: true, filePath: '' };
    }
    log('info', 'showSaveDialog ok', { filePath: result.filePath });
    return { canceled: false, filePath: result.filePath };
  }, 2);

  fileHandler('desktop:saveFile', saveFileInput, saveFileResult, ['fs-write'], async (input) => {
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

  registerPrinciplesIpc(ipcMain, principlesStore, log);

  // ---- Knowledge Base ----
  const { createKbStoreSqlite } = await import('./kb-store-sqlite.js');
  const { createChunker } = await import('./kb-chunker.js');
  const { createSourceExtractor } = await import('./kb-source-extractor.js');
  const { app } = await import('electron');
  const kbSourceExtractor = createSourceExtractor({
    officeParser: { parse: input => services.parseOfficeDocument(input) },
  });
  const kbChunker = createChunker();

  const sourceExtractionMetadata = (result: import('./kb-store.js').SourceExtractionResult): Record<string, unknown> => ({
    ...(result.engine ? { engine: result.engine } : {}),
    ...(result.engineVersion ? { engineVersion: result.engineVersion } : {}),
    ...(result.truncated !== undefined ? { truncated: result.truncated } : {}),
  });

  const finishSourceExtraction = (
    store: import('./kb-store.js').KbStore,
    sourceId: string,
    result: import('./kb-store.js').SourceExtractionResult,
    requestSource: import('./kb-types.js').RequestSource,
  ) => {
    if (result.ok && result.text) {
      const claim = store.claimSourceContentHash(
        sourceId,
        computeKnowledgeContentHash(result.text),
        requestSource,
      );
      if (!claim.created) return claim.source;
      const chunks = kbChunker.chunk({ text: result.text, mimeType: result.mimeType });
      store.insertChunks(sourceId, chunks, requestSource);
      return store.updateSourceParseResult(sourceId, {
        parseStatus: 'parsed',
        metadata: sourceExtractionMetadata(result),
      }, requestSource);
    }
    return store.updateSourceParseResult(sourceId, {
      parseStatus: result.errorCode === 'unsupported_format' ? 'unsupported' : 'failed',
      errorCode: result.errorCode ?? 'extraction_failed',
      errorMessage: result.error ?? 'unknown',
      metadata: sourceExtractionMetadata(result),
    }, requestSource);
  };

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
        }, 'user');
      }
      const pendingSources = kbStore.listCollections()
        .flatMap(collection => kbStore!.listSources(collection.id))
        .filter(source => source.parseStatus === 'pending');
      if (pendingSources.length) {
        const store = kbStore!;
        setImmediate(async () => {
          for (const src of pendingSources) {
            try {
              if (store.listChunks(src.id).length > 0) {
                const chunks = store.listChunks(src.id);
                store.claimSourceContentHash(
                  src.id,
                  computeKnowledgeContentHash(reconstructKnowledgeSourceText(chunks)),
                  'scheduler',
                );
                store.updateSourceParseResult(src.id, { parseStatus: 'parsed' }, 'scheduler');
                continue;
              }
              if (!src.rawPath) continue;
              const extractResult = await kbSourceExtractor.extract({
                filePath: src.rawPath,
                mimeType: src.mimeType || 'application/octet-stream',
              });
              finishSourceExtraction(store, src.id, extractResult, 'scheduler');
            } catch (error) {
              try {
                store.updateSourceParseResult(src.id, {
                  parseStatus: 'failed',
                  errorCode: 'io_error',
                  errorMessage: error instanceof Error ? error.message : String(error),
                }, 'scheduler');
              } catch {
                // Another recovery path already finalized this source.
              }
            }
          }
        });
      }
    }
    return kbStore;
  }

  const knowledgeProducers = new Map<string, IpcHandlerListener>();
  const knowledgeIpc: IpcHandleRegistrar = { handle(channel, listener) { knowledgeProducers.set(channel, listener); } };
  registerKnowledgeIpc(ipcMain, knowledgeProducers);

  knowledgeIpc.handle('desktop:kb:listCollections', () => {
    log('info', 'kb:listCollections');
    return getKbStore().listCollections();
  });

  knowledgeIpc.handle('desktop:kb:createCollection', (_event, input) => {
    log('info', 'kb:createCollection', { name: input?.name });
    return getKbStore().createCollection(input, 'user');
  });

  knowledgeIpc.handle('desktop:kb:deleteCollection', (_event, id: string) => {
    log('info', 'kb:deleteCollection', { id });
    getKbStore().deleteCollection(id, 'user');
  });

  knowledgeIpc.handle('desktop:kb:listSources', (_event, collectionId: string) => {
    log('info', 'kb:listSources', { collectionId });
    return getKbStore().listSources(collectionId);
  });

  knowledgeIpc.handle('desktop:kb:addSource', async (_event, input) => {
    log('info', 'kb:addSource', { kind: input?.kind, title: input?.title });
    const store = getKbStore();
    const unsafeMetadata = input?.metadata && typeof input.metadata === 'object'
      ? input.metadata as Record<string, unknown>
      : {};
    const { createdBy: _createdBy, requestSource: _requestSource, ...metadata } = unsafeMetadata;
    const source = store.addSource({
      collectionId: input?.collectionId,
      kind: input?.kind,
      title: input?.title,
      uri: input?.uri,
      filePath: input?.filePath,
      mimeType: input?.mimeType,
      text: input?.text,
      byteSize: input?.byteSize,
      rawPath: input?.rawPath,
      parseStatus: 'pending',
      metadata,
    }, 'user');
    try {
      let extractResult: import('./kb-store.js').SourceExtractionResult | null = null;
      if (input?.kind === 'paste' && input?.text) {
        extractResult = kbSourceExtractor.extractFromText(input.text, input.title || '粘贴文本');
      } else if (input?.kind === 'file' && input?.filePath) {
        extractResult = await kbSourceExtractor.extract({ filePath: input.filePath, mimeType: input.mimeType || 'application/octet-stream' });
      } else if (input?.kind === 'url' && input?.uri) {
        extractResult = await kbSourceExtractor.extractFromUrl(input.uri);
      }
      const finalized = finishSourceExtraction(store, source.id, extractResult ?? {
        ok: false,
        errorCode: 'invalid_source_input',
        error: 'Source content is missing.',
      }, 'user');
      return captureKnowledgeOutput('addSource', finalized);
    } catch (e) {
      log('error', 'kb:addSource processing failed', String(e));
      try {
        store.updateSourceParseResult(source.id, {
          parseStatus: 'failed',
          errorCode: 'io_error',
          errorMessage: e instanceof Error ? e.message : String(e),
        }, 'user');
      } catch {
        // The source may already have reached a terminal parse state.
      }
    }
    return captureKnowledgeOutput('addSource', store.getSource(source.id) ?? source);
  });

  knowledgeIpc.handle('desktop:kb:pickFiles', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '文档',
          extensions: [
            'pdf', 'txt', 'md', 'html', 'json', 'csv',
            ...Array.from(OFFICE_EXTENSIONS, extension => extension.slice(1)),
          ],
        },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled) return captureKnowledgeOutput('pickFiles', []);
    return captureKnowledgeOutput('pickFiles', result.filePaths);
  });

  const meetingActions10Producers = new Map<string, IpcHandlerListener>();
  const meetingActions10Raw: IpcHandleRegistrar = { handle: (channel, producer) => { meetingActions10Producers.set(channel, producer); } };

  meetingActions10Raw.handle('desktop:meeting:pickAudioFile', async () => {
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

  const meetingMutations = createMeetingMutationService(meetingAudioPermissionService);
  const meetingMutationProducers = new Map<string, IpcHandlerListener>([
    ['desktop:meeting:requestMicrophonePermission', () => meetingMutations.requestMicrophonePermission('user')],
    ['desktop:meeting:saveAsrConfig', (_event, input) => meetingMutations.saveAsrConfig(input, 'user')],
    ['desktop:meeting:downloadModel', (_event, id) => meetingMutations.downloadModel(id, 'user')],
    ['desktop:meeting:uninstallModel', (_event, id) => meetingMutations.uninstallModel(id, 'user')],
  ]);
  registerMeetingMutationIpc(ipcMain, meetingMutationProducers);

  const meetingReadonlyProducers = new Map<string, IpcHandlerListener>([
    ['desktop:meeting:getMicrophonePermission', () => meetingAudioPermissionService.getStatus()],
    ['desktop:meeting:getAsrConfig', () => readMeetingAsrReadonly()],
    ['desktop:meeting:listModels', async () => { const { createMeetingModelService } = await import('./meeting-model-service.js'); return createMeetingModelService({ readonlyIoPolicy: 'truthful' }).listModels(); }],
  ]);
  registerMeetingReadonlyIpc(ipcMain, meetingReadonlyProducers);

  meetingActions10Raw.handle('desktop:meeting:saveRecordedAudio', async (_event, input) => {
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

  meetingActions10Raw.handle('desktop:meeting:transcribePreview', async (_event, input) => {
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
        error: safeMeeting10Thrown(error, 'preview_transcription_failed'),
      };
    } finally {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  });

  meetingActions10Raw.handle('desktop:meeting:live:start', async (event, input) => {
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
          event.sender.send('desktop:meeting:live:update', captureMeeting10LiveUpdate(activeSessionId, update));
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

  meetingActions10Raw.handle('desktop:meeting:live:pushAudio', async (event, input) => {
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

  meetingActions10Raw.handle('desktop:meeting:live:finish', async (event, input) => {
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

  meetingActions10Raw.handle('desktop:meeting:live:cancel', async (event, input) => {
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

  meetingActions10Raw.handle('desktop:meeting:processRecording', async (_event, input) => {
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

  meetingActions10Raw.handle('desktop:meeting:draftRecording', async (_event, input) => {
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

  meetingActions10Raw.handle('desktop:meeting:saveTranscript', async (_event, input) => {
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

  registerMeetingActions10Ipc(ipcMain, meetingActions10Producers);

  knowledgeIpc.handle('desktop:kb:deleteSource', (_event, id: string) => {
    log('info', 'kb:deleteSource', { id });
    getKbStore().deleteSource(id, 'user');
  });

  knowledgeIpc.handle('desktop:kb:getCollectionState', (_event, collectionId: string) => {
    log('info', 'kb:getCollectionState', { collectionId });
    return getKbStore().getCollectionState(collectionId);
  });

  knowledgeIpc.handle('desktop:kb:getSourceContent', (_event, input) => {
    const sourceId = String(input?.sourceId ?? '');
    const offset = Math.max(0, Number(input?.offset ?? 0) || 0);
    const requestedLimit = Number(input?.limit ?? 64_000) || 64_000;
    const limit = Math.min(Math.max(1, requestedLimit), 128_000);
    log('info', 'kb:getSourceContent', { sourceId, offset, limit });
    return getKbStore().getSourceWithContent(sourceId, offset, limit);
  });

  knowledgeIpc.handle('desktop:kb:search', async (_event, input) => {
    log('info', 'kb:search', { collectionId: input?.collectionId, query: input?.query?.slice(0, 50) });
    const store = getKbStore();
    const query = (input?.query ?? '').trim();
    const topK = input?.topK ?? 10;
    if (!query) return captureKnowledgeOutput('search', []);
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
    return captureKnowledgeOutput('search', results.slice(0, topK));
  });
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
