import { types as nodeTypes } from 'node:util';
import type {
  Message,
  MessageBlock,
  ToolExecutionContext,
} from '../../types.js';
import type { PromptSnapshot } from '../prompts/types.js';
import type {
  ArtifactGenerationTarget,
  TaskExecutionScope,
} from '../../runtime/task-host/types.js';
import { resolveRegisteredStrictKimiK3Profile } from './model-harness-identity.js';

const SYNTHESIZED_CONTEXT_LIMIT = 40_000;
const MESSAGE_ROLES = ['user', 'assistant'] as const;
const IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
const REASONING_SOURCES = [
  'reasoning_content',
  'reasoning',
  'reasoning_details',
  'reasoning_text',
  'thinking',
  'thought',
  'raw_think_tag',
  'synthetic',
] as const;
const PROMPT_SEGMENT_KEYS = [
  'static_identity',
  'dynamic_context',
  'workspace_context',
  'core_identity',
  'session_context',
  'skills',
  'tool_policy',
  'channel_hints',
  'project_context',
  'memory_summary',
  'harness_memory',
  'model_hints',
] as const;
const PROMPT_SEGMENT_KINDS = [
  'system_rule',
  'background_context',
  'derived_summary',
  'user_input',
] as const;
const ARTIFACT_REQUESTED_KINDS = [
  'image',
  'html',
  'markdown',
  'slides',
] as const;

export function isStrictKimiK3Adapter(adapter: object): boolean {
  return resolveRegisteredStrictKimiK3Profile(adapter) !== undefined;
}

export function projectProviderPrivateMessages(messages: readonly Message[]): Message[] {
  assertDenseArray(messages);
  return messages.map((message) => {
    validateMessageSchema(message);
    return {
      role: message.role,
      content: message.content.flatMap(projectVisibleToolContextBlock),
    };
  });
}

export function buildSynthesizedProviderContext(
  kind: 'compaction' | 'subagent',
  messages: readonly Message[],
): string {
  assertDenseArray(messages);
  const records = messages.flatMap((message, ordinal) => {
    validateMessageSchema(message);
    const content = message.content.flatMap(projectBlockForSynthesizedContext);
    return content.length > 0
      ? [{
          ordinal,
          role: message.role,
          content,
        }]
      : [];
  });
  let firstRecord = 0;
  while (firstRecord < records.length) {
    const envelope = JSON.stringify({
      kind: `xiaok.synthesized-${kind}-context`,
      version: 1,
      records: records.slice(firstRecord),
    });
    if (envelope.length <= SYNTHESIZED_CONTEXT_LIMIT) {
      return envelope;
    }
    firstRecord += 1;
  }
  return JSON.stringify({
    kind: `xiaok.synthesized-${kind}-context`,
    version: 1,
    records: [],
  });
}

export function projectStrictToolExecutionContext(
  context: ToolExecutionContext,
): ToolExecutionContext {
  assertExactOwnKeys(context, [
    'taskId',
    'session',
    'messages',
    'systemPrompt',
    'toolDefinitions',
  ], [
    'executionScope',
    'promptSnapshot',
    'signal',
    'toolInvocationId',
    'runtimeFactSink',
  ]);
  if (
    typeof context.taskId !== 'string'
    || typeof context.systemPrompt !== 'string'
    || !Array.isArray(context.messages)
    || !Array.isArray(context.toolDefinitions)
    || !context.session
    || typeof context.session !== 'object'
  ) {
    rejectToolContext();
  }
  if (
    context.signal !== undefined
    && (
      typeof AbortSignal === 'undefined'
      || !(context.signal instanceof AbortSignal)
    )
  ) {
    rejectToolContext();
  }
  validateSessionSnapshotSchema(context.session);
  projectProviderPrivateMessages(context.session.messages);
  if (context.executionScope !== undefined) {
    validateExecutionScopeSchema(context.executionScope);
  }
  if (context.promptSnapshot !== undefined) {
    validatePromptSnapshotSchema(context.promptSnapshot);
  }
  assertDenseArray(context.toolDefinitions);
  for (const definition of context.toolDefinitions) {
    assertExactOwnKeys(
      definition,
      ['name', 'description', 'inputSchema'],
    );
    if (
      typeof definition.name !== 'string'
      || typeof definition.description !== 'string'
    ) {
      rejectToolContext();
    }
    assertPlainRecord(definition.inputSchema);
    validatePlainData(definition.inputSchema);
  }
  const messages = projectProviderPrivateMessages(context.messages);
  const session = context.session;
  const projected: ToolExecutionContext = {
    taskId: context.taskId,
    ...(context.executionScope
      ? { executionScope: clonePlainData(context.executionScope) }
      : {}),
    session: {
      sessionId: session.sessionId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ...(session.forkedFromSessionId
        ? { forkedFromSessionId: session.forkedFromSessionId }
        : {}),
      lineage: clonePlainData(session.lineage),
      messages: clonePlainData(messages),
      usage: clonePlainData(session.usage),
      compactions: clonePlainData(session.compactions),
      ...(session.promptSnapshotId
        ? { promptSnapshotId: session.promptSnapshotId }
        : {}),
      memoryRefs: clonePlainData(session.memoryRefs),
      approvalRefs: clonePlainData(session.approvalRefs),
      backgroundJobRefs: clonePlainData(session.backgroundJobRefs),
    },
    messages,
    systemPrompt: context.systemPrompt,
    toolDefinitions: clonePlainData(context.toolDefinitions),
    ...(context.promptSnapshot
      ? { promptSnapshot: clonePlainData(context.promptSnapshot) }
      : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  };
  deepFreezePlainData(projected);
  return Object.freeze({
    ...projected,
    ...(context.toolInvocationId ? { toolInvocationId: context.toolInvocationId } : {}),
    ...(context.runtimeFactSink ? { runtimeFactSink: context.runtimeFactSink } : {}),
  });
}

function projectBlockForSynthesizedContext(
  block: MessageBlock,
): Array<Record<string, unknown>> {
  validateMessageBlockSchema(block);
  if (block.type !== 'text') return [];
  return [{ type: 'text', text: block.text }];
}

function projectVisibleToolContextBlock(block: MessageBlock): MessageBlock[] {
  validateMessageBlockSchema(block);
  if (block.type === 'thinking') return [];
  switch (block.type) {
    case 'text':
      return [{ type: 'text', text: block.text }];
    case 'image':
      return [{
        type: 'image',
        source: clonePlainData(block.source),
      }];
    case 'tool_use':
      return [{
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: clonePlainData(block.input),
      }];
    case 'tool_result':
      return [{
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        ...(block.is_error === undefined ? {} : { is_error: block.is_error }),
      }];
    default:
      return rejectToolContext();
  }
}

function validateMessageSchema(message: Message): void {
  assertExactOwnKeys(message, ['role', 'content']);
  assertEnumValue(message.role, MESSAGE_ROLES);
  assertDenseArray(message.content);
}

function validateMessageBlockSchema(block: MessageBlock): void {
  validatePlainData(block);
  assertPlainRecord(block);
  const discriminant = readOwnDataValue(block, 'type');
  if (typeof discriminant !== 'string') {
    rejectToolContext();
  }

  switch (discriminant) {
    case 'text':
      assertExactOwnKeys(block, ['type', 'text'], ['cache_control']);
      assertStringValue(readOwnDataValue(block, 'text'));
      validateOptionalCacheControl(block);
      return;
    case 'image': {
      assertExactOwnKeys(block, ['type', 'source'], ['cache_control']);
      const source = readOwnDataValue(block, 'source');
      assertExactOwnKeys(source, ['type', 'media_type', 'data']);
      if (readOwnDataValue(source, 'type') !== 'base64') {
        rejectToolContext();
      }
      assertEnumValue(
        readOwnDataValue(source, 'media_type'),
        IMAGE_MEDIA_TYPES,
      );
      assertStringValue(readOwnDataValue(source, 'data'));
      validateOptionalCacheControl(block);
      return;
    }
    case 'tool_use': {
      assertExactOwnKeys(
        block,
        ['type', 'id', 'name', 'input'],
        ['cache_control'],
      );
      assertStringValue(readOwnDataValue(block, 'id'));
      assertStringValue(readOwnDataValue(block, 'name'));
      const input = readOwnDataValue(block, 'input');
      assertPlainRecord(input);
      validatePlainData(input);
      validateOptionalCacheControl(block);
      return;
    }
    case 'tool_result': {
      assertExactOwnKeys(
        block,
        ['type', 'tool_use_id', 'content'],
        ['is_error', 'cache_control'],
      );
      assertStringValue(readOwnDataValue(block, 'tool_use_id'));
      assertStringValue(readOwnDataValue(block, 'content'));
      const isError = readOptionalOwnDataValue(block, 'is_error');
      if (isError !== undefined) {
        assertBooleanValue(isError);
      }
      validateOptionalCacheControl(block);
      return;
    }
    case 'thinking': {
      assertExactOwnKeys(
        block,
        ['type', 'thinking'],
        ['reasoningSource', 'reasoningProvenance', 'cache_control'],
      );
      assertStringValue(readOwnDataValue(block, 'thinking'));
      const reasoningSource = readOptionalOwnDataValue(
        block,
        'reasoningSource',
      );
      if (reasoningSource !== undefined) {
        assertEnumValue(
          reasoningSource,
          REASONING_SOURCES,
        );
      }
      const reasoningProvenance = readOptionalOwnDataValue(
        block,
        'reasoningProvenance',
      );
      if (reasoningProvenance !== undefined) {
        validateReasoningProvenance(
          reasoningProvenance,
        );
      }
      validateOptionalCacheControl(block);
      return;
    }
    default:
      rejectToolContext();
  }
}

function validateOptionalCacheControl(value: object): void {
  const cacheControl = readOptionalOwnDataValue(value, 'cache_control');
  if (cacheControl === undefined) {
    return;
  }
  assertExactOwnKeys(cacheControl, ['type']);
  if (readOwnDataValue(cacheControl, 'type') !== 'ephemeral') {
    rejectToolContext();
  }
}

function validateReasoningProvenance(value: unknown): void {
  assertExactOwnKeys(
    value,
    ['captureVersion', 'source', 'fieldPresence'],
  );
  if (
    readOwnDataValue(value, 'captureVersion') !== 1
    || readOwnDataValue(value, 'fieldPresence') !== 'present'
  ) {
    rejectToolContext();
  }
  assertEnumValue(readOwnDataValue(value, 'source'), REASONING_SOURCES);
}

function validateSessionSnapshotSchema(
  session: ToolExecutionContext['session'],
): void {
  assertExactOwnKeys(session, [
    'sessionId',
    'cwd',
    'createdAt',
    'updatedAt',
    'lineage',
    'messages',
    'usage',
    'compactions',
    'memoryRefs',
    'approvalRefs',
    'backgroundJobRefs',
  ], [
    'forkedFromSessionId',
    'promptSnapshotId',
  ]);
  assertStringValue(session.sessionId);
  assertStringValue(session.cwd);
  assertFiniteNumber(session.createdAt);
  assertFiniteNumber(session.updatedAt);
  const forkedFromSessionId = readOptionalOwnDataValue(
    session,
    'forkedFromSessionId',
  );
  if (forkedFromSessionId !== undefined) {
    assertStringValue(forkedFromSessionId);
  }
  const promptSnapshotId = readOptionalOwnDataValue(
    session,
    'promptSnapshotId',
  );
  if (promptSnapshotId !== undefined) {
    assertStringValue(promptSnapshotId);
  }
  assertStringArray(session.lineage);
  assertDenseArray(session.messages);
  validateUsageSchema(session.usage);
  validateCompactionsSchema(session.compactions);
  assertStringArray(session.memoryRefs);
  assertStringArray(session.approvalRefs);
  assertStringArray(session.backgroundJobRefs);
}

function validateUsageSchema(
  usage: ToolExecutionContext['session']['usage'],
): void {
  assertExactOwnKeys(
    usage,
    ['inputTokens', 'outputTokens'],
    ['cacheCreationInputTokens', 'cacheReadInputTokens'],
  );
  assertFiniteNumber(usage.inputTokens);
  assertFiniteNumber(usage.outputTokens);
  const cacheCreationInputTokens = readOptionalOwnDataValue(
    usage,
    'cacheCreationInputTokens',
  );
  if (cacheCreationInputTokens !== undefined) {
    assertFiniteNumber(cacheCreationInputTokens);
  }
  const cacheReadInputTokens = readOptionalOwnDataValue(
    usage,
    'cacheReadInputTokens',
  );
  if (cacheReadInputTokens !== undefined) {
    assertFiniteNumber(cacheReadInputTokens);
  }
}

function validateCompactionsSchema(
  compactions: ToolExecutionContext['session']['compactions'],
): void {
  assertDenseArray(compactions);
  for (const compaction of compactions) {
    assertExactOwnKeys(
      compaction,
      ['id', 'createdAt', 'summary', 'replacedMessages'],
    );
    assertStringValue(compaction.id);
    assertFiniteNumber(compaction.createdAt);
    assertStringValue(compaction.summary);
    assertFiniteNumber(compaction.replacedMessages);
  }
}

function validatePromptSnapshotSchema(snapshot: PromptSnapshot): void {
  assertExactOwnKeys(snapshot, [
    'id',
    'createdAt',
    'cwd',
    'channel',
    'rendered',
    'segments',
    'memoryRefs',
  ]);
  assertStringValue(snapshot.id);
  assertFiniteNumber(snapshot.createdAt);
  assertStringValue(snapshot.cwd);
  assertEnumValue(snapshot.channel, ['chat', 'yzj'] as const);
  assertStringValue(snapshot.rendered);
  assertDenseArray(snapshot.segments);
  for (const segment of snapshot.segments) {
    assertExactOwnKeys(
      segment,
      ['key', 'title', 'text', 'cacheable', 'kind'],
    );
    assertEnumValue(segment.key, PROMPT_SEGMENT_KEYS);
    assertStringValue(segment.title);
    assertStringValue(segment.text);
    assertBooleanValue(segment.cacheable);
    assertEnumValue(segment.kind, PROMPT_SEGMENT_KINDS);
  }
  assertStringArray(snapshot.memoryRefs);
}

function validateExecutionScopeSchema(scope: TaskExecutionScope): void {
  if (scope.kind === 'goal_turn') {
    assertExactOwnKeys(scope, [
      'kind', 'origin', 'goalId', 'epoch', 'goalTurnId', 'threadId',
    ]);
    assertEnumValue(scope.origin, ['user', 'continuation'] as const);
    assertStringValue(scope.goalId);
    assertFiniteNumber(scope.epoch);
    assertStringValue(scope.goalTurnId);
    assertStringValue(scope.threadId);
    return;
  }
  assertExactOwnKeys(
    scope,
    ['kind', 'generationRequestId', 'leaseId'],
    ['target'],
  );
  if (scope.kind !== 'artifact_workspace_generation') {
    rejectToolContext();
  }
  assertStringValue(scope.generationRequestId);
  assertStringValue(scope.leaseId);
  const target = readOptionalOwnDataValue(scope, 'target');
  if (target !== undefined) {
    validateExecutionTargetSchema(target as ArtifactGenerationTarget);
  }
}

function validateExecutionTargetSchema(
  target: ArtifactGenerationTarget | undefined,
): void {
  assertExactOwnKeys(target, [
    'workspaceId',
    'nodeId',
    'generationRequestId',
    'leaseId',
    'expectedStructureRevision',
    'requestedKind',
    'referenceVersionIds',
  ], [
    'placeholderId',
    'sourceArtifactVersionId',
    'width',
    'height',
  ]);
  assertStringValue(target.workspaceId);
  assertStringValue(target.nodeId);
  assertStringValue(target.generationRequestId);
  assertStringValue(target.leaseId);
  assertFiniteNumber(target.expectedStructureRevision);
  assertEnumValue(target.requestedKind, ARTIFACT_REQUESTED_KINDS);
  assertStringArray(target.referenceVersionIds);
  const placeholderId = readOptionalOwnDataValue(target, 'placeholderId');
  if (placeholderId !== undefined) {
    assertStringValue(placeholderId);
  }
  const sourceArtifactVersionId = readOptionalOwnDataValue(
    target,
    'sourceArtifactVersionId',
  );
  if (sourceArtifactVersionId !== undefined) {
    assertStringValue(sourceArtifactVersionId);
  }
  const width = readOptionalOwnDataValue(target, 'width');
  if (width !== undefined) {
    assertFiniteNumber(width);
  }
  const height = readOptionalOwnDataValue(target, 'height');
  if (height !== undefined) {
    assertFiniteNumber(height);
  }
}

function clonePlainData<T>(value: T): T {
  validatePlainData(value);
  try {
    return structuredClone(value);
  } catch {
    rejectToolContext();
  }
}

function validatePlainData(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): void {
  const valueType = typeof value;
  if (
    valueType === 'function'
    || valueType === 'symbol'
    || valueType === 'bigint'
  ) {
    rejectToolContext();
  }
  if (value === null || typeof value !== 'object') return;
  if (nodeTypes.isProxy(value)) rejectToolContext();
  if (seen.has(value)) return;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value)
    && prototype !== Object.prototype
    && prototype !== null
  ) {
    rejectToolContext();
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') rejectToolContext();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      rejectToolContext();
    }
    validatePlainData(descriptor.value, seen);
  }
}

function assertExactOwnKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): asserts value is Record<string, unknown> {
  assertPlainRecord(value);
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const observed = new Set<string>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      rejectToolContext();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      rejectToolContext();
    }
    observed.add(key);
  }
  for (const key of required) {
    if (!observed.has(key)) {
      rejectToolContext();
    }
  }
}

function assertPlainRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || nodeTypes.isProxy(value)
  ) {
    rejectToolContext();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    rejectToolContext();
  }
}

function assertDenseArray<T>(
  value: readonly T[] | unknown,
): asserts value is readonly T[] {
  if (!Array.isArray(value) || nodeTypes.isProxy(value)) {
    rejectToolContext();
  }
  const indexKeys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      rejectToolContext();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      rejectToolContext();
    }
    if (key === 'length') {
      continue;
    }
    const index = Number(key);
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= value.length
      || String(index) !== key
    ) {
      rejectToolContext();
    }
    indexKeys.push(key);
  }
  if (indexKeys.length !== value.length) {
    rejectToolContext();
  }
}

function assertStringArray(value: readonly string[] | unknown): void {
  assertDenseArray(value);
  for (const entry of value) {
    assertStringValue(entry);
  }
}

function hasOwnDataValue(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return Boolean(
    descriptor
    && Object.prototype.hasOwnProperty.call(descriptor, 'value'),
  );
}

function readOptionalOwnDataValue(
  value: object,
  key: string,
): unknown | undefined {
  return hasOwnDataValue(value, key)
    ? readOwnDataValue(value, key)
    : undefined;
}

function readOwnDataValue(value: unknown, key: string): unknown {
  assertPlainRecord(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    rejectToolContext();
  }
  return descriptor.value;
}

function assertStringValue(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    rejectToolContext();
  }
}

function assertBooleanValue(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') {
    rejectToolContext();
  }
}

function assertFiniteNumber(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    rejectToolContext();
  }
}

function assertEnumValue<T>(
  value: unknown,
  allowedValues: readonly T[],
): asserts value is T {
  if (!allowedValues.some((allowed) => allowed === value)) {
    rejectToolContext();
  }
}

function deepFreezePlainData(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (!value || typeof value !== 'object') return;
  if (
    typeof AbortSignal !== 'undefined'
    && value instanceof AbortSignal
  ) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      deepFreezePlainData(descriptor.value, seen);
    }
  }
  Object.freeze(value);
}

function rejectToolContext(): never {
  throw new Error('KIMI_STRICT_TOOL_CONTEXT_REJECTED');
}
