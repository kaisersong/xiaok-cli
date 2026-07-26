export const KIMI_SCHEMA_LIMITS = Object.freeze({
  maxDepth: 64,
  maxInputNodes: 20_000,
  maxRefExpansions: 4_096,
  maxOutputNodes: 50_000,
  maxOutputBytes: 512 * 1024,
  maxRequestToolCount: 256,
  maxRequestInputNodes: 100_000,
  maxRequestOutputNodes: 200_000,
  maxRequestToolBytes: 2 * 1024 * 1024,
});

export type KimiSchemaLimitKind =
  | 'depth'
  | 'input_nodes'
  | 'ref_expansions'
  | 'output_nodes'
  | 'output_bytes'
  | 'request_tool_count'
  | 'request_input_nodes'
  | 'request_output_nodes'
  | 'request_tool_bytes';

export class KimiToolSchemaError extends Error {
  readonly code:
    | 'KIMI_SCHEMA_LIMIT_EXCEEDED'
    | 'KIMI_SCHEMA_TYPE_INFERENCE_FAILED'
    | 'KIMI_SCHEMA_INVALID_JSON_VALUE';
  readonly limitKind?: KimiSchemaLimitKind;
  readonly toolName?: string;

  constructor(
    code: KimiToolSchemaError['code'],
    options: {
      limitKind?: KimiSchemaLimitKind;
      toolName?: string;
      message?: string;
    } = {},
  ) {
    super(options.message ?? code);
    this.name = 'KimiToolSchemaError';
    this.code = code;
    this.limitKind = options.limitKind;
    this.toolName = options.toolName;
  }
}

export interface NormalizedKimiSchema {
  schema: Record<string, unknown>;
  inputNodes: number;
  outputNodes: number;
  outputBytes: number;
}

type JsonTypeName =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

const CHILD_SCHEMA_SLOTS = new Set([
  '$defs',
  'definitions',
  'dependencies',
  'dependentSchemas',
  'patternProperties',
  'properties',
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
  'items',
]);

const SCHEMA_MAP_SLOTS = new Set([
  '$defs',
  'definitions',
  'dependencies',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

const SCHEMA_ARRAY_SLOTS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
]);

const OBJECT_HINTS = [
  'dependencies',
  'dependentSchemas',
  'patternProperties',
  'properties',
  'additionalProperties',
  'propertyNames',
  'unevaluatedProperties',
  'dependentRequired',
  'maxProperties',
  'minProperties',
  'required',
] as const;

const ARRAY_HINTS = [
  'additionalItems',
  'contains',
  'unevaluatedItems',
  'prefixItems',
  'items',
  'maxContains',
  'maxItems',
  'minContains',
  'minItems',
  'uniqueItems',
] as const;

const STRING_HINTS = [
  'contentSchema',
  'contentEncoding',
  'contentMediaType',
  'format',
  'maxLength',
  'minLength',
  'pattern',
] as const;

const NUMBER_HINTS = [
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
  'multipleOf',
] as const;

const COMBINATOR_SLOTS = ['allOf', 'anyOf', 'oneOf'] as const;

interface NormalizeState {
  readonly root: Record<string, unknown>;
  refExpansions: number;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function limitError(limitKind: KimiSchemaLimitKind): KimiToolSchemaError {
  return new KimiToolSchemaError('KIMI_SCHEMA_LIMIT_EXCEEDED', {
    limitKind,
    message: `Kimi tool schema exceeded ${limitKind}`,
  });
}

function invalidJsonError(candidate: boolean): KimiToolSchemaError {
  const code = candidate
    ? 'KIMI_SCHEMA_TYPE_INFERENCE_FAILED'
    : 'KIMI_SCHEMA_INVALID_JSON_VALUE';
  return new KimiToolSchemaError(code, {
    message: candidate
      ? 'Kimi tool schema type candidate is not a JSON value'
      : 'Kimi tool schema contains a non-JSON value or object cycle',
  });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function preflightJsonValue(
  value: unknown,
  depth: number,
  active: Set<object>,
  candidate: boolean,
  counter: { nodes: number },
): void {
  if (depth > KIMI_SCHEMA_LIMITS.maxDepth) {
    throw limitError('depth');
  }

  counter.nodes += 1;
  if (counter.nodes > KIMI_SCHEMA_LIMITS.maxInputNodes) {
    throw limitError('input_nodes');
  }

  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
    || (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw invalidJsonError(candidate);
  }

  if (value === null || typeof value !== 'object') {
    return;
  }
  if (!Array.isArray(value) && !isJsonRecord(value)) {
    throw invalidJsonError(candidate);
  }
  if (active.has(value)) {
    throw invalidJsonError(candidate);
  }

  active.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      preflightJsonValue(item, depth + 1, active, candidate, counter);
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      preflightJsonValue(
        child,
        depth + 1,
        active,
        candidate || key === 'enum' || key === 'const',
        counter,
      );
    }
  }
  active.delete(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (isJsonRecord(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      cloned[key] = cloneJsonValue(child);
    }
    return cloned;
  }
  return value;
}

function jsonTypeOf(value: unknown): JsonTypeName {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value as Exclude<JsonTypeName, 'array' | 'integer' | 'null' | 'number'>;
}

function combineCandidateTypes(
  left: JsonTypeName,
  right: JsonTypeName,
): JsonTypeName | undefined {
  if (left === right) return left;
  if (
    (left === 'integer' && right === 'number')
    || (left === 'number' && right === 'integer')
  ) {
    return 'number';
  }
  return undefined;
}

function inferEnumType(values: unknown[]): JsonTypeName {
  let inferred = jsonTypeOf(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    const combined = combineCandidateTypes(inferred, jsonTypeOf(values[index]));
    if (!combined) {
      throw new KimiToolSchemaError('KIMI_SCHEMA_TYPE_INFERENCE_FAILED', {
        message: 'Kimi tool schema enum values do not share one JSON type',
      });
    }
    inferred = combined;
  }
  return inferred;
}

function typesAreCompatible(
  declared: JsonTypeName,
  candidate: JsonTypeName,
): boolean {
  return declared === candidate
    || (declared === 'number' && candidate === 'integer');
}

function candidateTypeFor(
  schema: Record<string, unknown>,
  tolerateMixedEnum: boolean,
): JsonTypeName | undefined {
  const enumValue = schema.enum;
  if (Array.isArray(enumValue) && enumValue.length > 0) {
    let enumType: JsonTypeName;
    try {
      enumType = inferEnumType(enumValue);
    } catch (error) {
      if (tolerateMixedEnum && error instanceof KimiToolSchemaError) {
        return undefined;
      }
      throw error;
    }

    if (hasOwn(schema, 'const')) {
      const constType = jsonTypeOf(schema.const);
      if (!typesAreCompatible(enumType, constType)) {
        throw new KimiToolSchemaError('KIMI_SCHEMA_TYPE_INFERENCE_FAILED', {
          message: 'Kimi tool schema const conflicts with enum type',
        });
      }
    }
    return enumType;
  }

  if (hasOwn(schema, 'const')) {
    return jsonTypeOf(schema.const);
  }
  return undefined;
}

function hasAnyHint(
  schema: Record<string, unknown>,
  hints: readonly string[],
): boolean {
  return hints.some((key) => hasOwn(schema, key));
}

function hasCombinator(schema: Record<string, unknown>): boolean {
  return COMBINATOR_SLOTS.some((key) => hasOwn(schema, key));
}

function completeType(
  schema: Record<string, unknown>,
  isRoot: boolean,
): JsonTypeName | undefined {
  const declaredType = schema.type;
  if (typeof declaredType === 'string' && declaredType.length > 0) {
    const candidate = candidateTypeFor(schema, true);
    if (
      candidate
      && !typesAreCompatible(declaredType as JsonTypeName, candidate)
    ) {
      schema.type = candidate;
      return candidate;
    }
    return declaredType as JsonTypeName;
  }

  if (Array.isArray(declaredType)) {
    return undefined;
  }
  if (isRoot || hasCombinator(schema)) {
    return undefined;
  }

  const candidate = candidateTypeFor(schema, false);
  if (candidate) {
    schema.type = candidate;
    return candidate;
  }

  let inferred: JsonTypeName;
  if (hasAnyHint(schema, OBJECT_HINTS)) {
    inferred = 'object';
  } else if (hasAnyHint(schema, ARRAY_HINTS)) {
    inferred = 'array';
  } else if (hasAnyHint(schema, STRING_HINTS)) {
    inferred = 'string';
  } else if (hasAnyHint(schema, NUMBER_HINTS)) {
    inferred = 'number';
  } else {
    inferred = 'string';
  }
  schema.type = inferred;
  return inferred;
}

function removeIncompatibleKeys(
  schema: Record<string, unknown>,
  type: JsonTypeName | undefined,
): void {
  if (!type) return;
  if (type !== 'object') {
    for (const key of OBJECT_HINTS) {
      delete schema[key];
    }
  }
  if (type !== 'array') {
    for (const key of ARRAY_HINTS) {
      delete schema[key];
    }
  }
}

function resolveLocalPointer(
  root: Record<string, unknown>,
  ref: string,
): unknown {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;

  let current: unknown = root;
  for (const encodedSegment of ref.slice(2).split('/')) {
    const segment = encodedSegment
      .replace(/~1/g, '/')
      .replace(/~0/g, '~');
    if (
      (isJsonRecord(current) || Array.isArray(current))
      && hasOwn(current, segment)
    ) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function normalizeSchemaMap(
  value: unknown,
  state: NormalizeState,
  depth: number,
  activeSchemas: Set<object>,
  refStack: Set<string>,
): unknown {
  if (!isJsonRecord(value)) {
    return cloneJsonValue(value);
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = isJsonRecord(child)
      ? normalizeSchemaNode(child, state, depth + 1, false, activeSchemas, refStack)
      : cloneJsonValue(child);
  }
  return normalized;
}

function normalizeSchemaArray(
  value: unknown,
  state: NormalizeState,
  depth: number,
  activeSchemas: Set<object>,
  refStack: Set<string>,
): unknown {
  if (!Array.isArray(value)) {
    return cloneJsonValue(value);
  }
  return value.map((child) => isJsonRecord(child)
    ? normalizeSchemaNode(child, state, depth + 1, false, activeSchemas, refStack)
    : cloneJsonValue(child));
}

function normalizeChildSlot(
  key: string,
  value: unknown,
  state: NormalizeState,
  depth: number,
  activeSchemas: Set<object>,
  refStack: Set<string>,
): unknown {
  if (SCHEMA_MAP_SLOTS.has(key)) {
    return normalizeSchemaMap(value, state, depth, activeSchemas, refStack);
  }
  if (SCHEMA_ARRAY_SLOTS.has(key)) {
    return normalizeSchemaArray(value, state, depth, activeSchemas, refStack);
  }
  if (key === 'items' && Array.isArray(value)) {
    return normalizeSchemaArray(value, state, depth, activeSchemas, refStack);
  }
  return isJsonRecord(value)
    ? normalizeSchemaNode(value, state, depth + 1, false, activeSchemas, refStack)
    : cloneJsonValue(value);
}

function normalizeSchemaBody(
  input: Record<string, unknown>,
  state: NormalizeState,
  depth: number,
  isRoot: boolean,
  activeSchemas: Set<object>,
  refStack: Set<string>,
  shouldCompleteType: boolean,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = CHILD_SCHEMA_SLOTS.has(key)
      ? value
      : cloneJsonValue(value);
  }

  if (shouldCompleteType) {
    const completedType = completeType(normalized, isRoot);
    removeIncompatibleKeys(normalized, completedType);
  }

  for (const key of CHILD_SCHEMA_SLOTS) {
    if (!hasOwn(normalized, key)) continue;
    normalized[key] = normalizeChildSlot(
      key,
      normalized[key],
      state,
      depth,
      activeSchemas,
      refStack,
    );
  }
  return normalized;
}

function normalizeSchemaNode(
  input: Record<string, unknown>,
  state: NormalizeState,
  depth: number,
  isRoot: boolean,
  activeSchemas: Set<object>,
  refStack: Set<string>,
): Record<string, unknown> {
  if (depth > KIMI_SCHEMA_LIMITS.maxDepth) {
    throw limitError('depth');
  }

  const activeForChildren = new Set(activeSchemas);
  activeForChildren.add(input);
  const ref = input.$ref;
  if (typeof ref === 'string') {
    const target = resolveLocalPointer(state.root, ref);
    if (!isJsonRecord(target)) {
      return cloneJsonValue(input) as Record<string, unknown>;
    }
    if (activeForChildren.has(target) || refStack.has(ref)) {
      return normalizeSchemaBody(
        input,
        state,
        depth,
        isRoot,
        activeForChildren,
        refStack,
        false,
      );
    }

    state.refExpansions += 1;
    if (state.refExpansions > KIMI_SCHEMA_LIMITS.maxRefExpansions) {
      throw limitError('ref_expansions');
    }

    const siblings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key !== '$ref') {
        siblings[key] = value;
      }
    }
    const merged = { ...target, ...siblings };
    const nextActive = new Set(activeForChildren);
    nextActive.add(target);
    const nextRefStack = new Set(refStack);
    nextRefStack.add(ref);
    return normalizeSchemaNode(
      merged,
      state,
      depth + 1,
      isRoot,
      nextActive,
      nextRefStack,
    );
  }

  return normalizeSchemaBody(
    input,
    state,
    depth,
    isRoot,
    activeForChildren,
    refStack,
    true,
  );
}

function countOutputNodes(value: unknown): number {
  let nodes = 0;
  const visit = (current: unknown): void => {
    nodes += 1;
    if (nodes > KIMI_SCHEMA_LIMITS.maxOutputNodes) {
      throw limitError('output_nodes');
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
    } else if (isJsonRecord(current)) {
      for (const child of Object.values(current)) visit(child);
    }
  };
  visit(value);
  return nodes;
}

export function normalizeKimiToolSchema(
  schema: Record<string, unknown>,
): NormalizedKimiSchema {
  const inputCounter = { nodes: 0 };
  preflightJsonValue(schema, 0, new Set(), false, inputCounter);

  const state: NormalizeState = {
    root: schema,
    refExpansions: 0,
  };
  const normalized = normalizeSchemaNode(
    schema,
    state,
    0,
    true,
    new Set(),
    new Set(),
  );
  const outputNodes = countOutputNodes(normalized);
  const serialized = JSON.stringify(normalized);
  const outputBytes = Buffer.byteLength(serialized, 'utf8');
  if (outputBytes > KIMI_SCHEMA_LIMITS.maxOutputBytes) {
    throw limitError('output_bytes');
  }

  return {
    schema: normalized,
    inputNodes: inputCounter.nodes,
    outputNodes,
    outputBytes,
  };
}
