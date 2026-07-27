import { types as nodeUtilTypes } from 'node:util';
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
export class KimiToolSchemaError extends Error {
    code;
    limitKind;
    toolName;
    constructor(code, options = {}) {
        super(options.message ?? code);
        this.name = 'KimiToolSchemaError';
        this.code = code;
        this.limitKind = options.limitKind;
        this.toolName = options.toolName;
    }
}
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
];
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
];
const STRING_HINTS = [
    'contentSchema',
    'contentEncoding',
    'contentMediaType',
    'format',
    'maxLength',
    'minLength',
    'pattern',
];
const NUMBER_HINTS = [
    'exclusiveMaximum',
    'exclusiveMinimum',
    'maximum',
    'minimum',
    'multipleOf',
];
const APPLICATOR_SLOTS = [
    '$ref',
    'allOf',
    'anyOf',
    'oneOf',
    'if',
    'then',
    'else',
    'not',
];
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function limitError(limitKind) {
    return new KimiToolSchemaError('KIMI_SCHEMA_LIMIT_EXCEEDED', {
        limitKind,
        message: `Kimi tool schema exceeded ${limitKind}`,
    });
}
function invalidJsonError(candidate) {
    const code = candidate
        ? 'KIMI_SCHEMA_TYPE_INFERENCE_FAILED'
        : 'KIMI_SCHEMA_INVALID_JSON_VALUE';
    return new KimiToolSchemaError(code, {
        message: candidate
            ? 'Kimi tool schema type candidate is not a JSON value'
            : 'Kimi tool schema contains a non-JSON value or object cycle',
    });
}
function isJsonRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function defineOwn(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });
}
function reserveOutputNode(state) {
    if (state.outputNodes >= KIMI_SCHEMA_LIMITS.maxOutputNodes) {
        throw limitError('output_nodes');
    }
    state.outputNodes += 1;
}
function reserveOutputBytes(state, bytes) {
    if (bytes > KIMI_SCHEMA_LIMITS.maxOutputBytes - state.outputBytes) {
        throw limitError('output_bytes');
    }
    state.outputBytes += bytes;
}
function reserveJsonStringBytes(value, state) {
    reserveOutputBytes(state, 2);
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code === 0x22 || code === 0x5c) {
            reserveOutputBytes(state, 2);
            continue;
        }
        if (code <= 0x1f) {
            reserveOutputBytes(state, code === 0x08
                || code === 0x09
                || code === 0x0a
                || code === 0x0c
                || code === 0x0d
                ? 2
                : 6);
            continue;
        }
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                reserveOutputBytes(state, 4);
                index += 1;
            }
            else {
                reserveOutputBytes(state, 6);
            }
            continue;
        }
        if (code >= 0xdc00 && code <= 0xdfff) {
            reserveOutputBytes(state, 6);
        }
        else if (code <= 0x7f) {
            reserveOutputBytes(state, 1);
        }
        else if (code <= 0x7ff) {
            reserveOutputBytes(state, 2);
        }
        else {
            reserveOutputBytes(state, 3);
        }
    }
}
function beginOutputObject(state) {
    reserveOutputNode(state);
    reserveOutputBytes(state, 2);
    return {};
}
function beginOutputArray(state) {
    reserveOutputNode(state);
    reserveOutputBytes(state, 2);
    return [];
}
function reserveObjectEntry(state, key, index) {
    if (index > 0)
        reserveOutputBytes(state, 1);
    reserveJsonStringBytes(key, state);
    reserveOutputBytes(state, 1);
}
function reserveArrayEntry(state, index) {
    if (index > 0)
        reserveOutputBytes(state, 1);
}
function reserveInputNode(inputDepth, counter) {
    if (inputDepth > KIMI_SCHEMA_LIMITS.maxDepth) {
        throw limitError('depth');
    }
    if (counter.nodes >= KIMI_SCHEMA_LIMITS.maxInputNodes) {
        throw limitError('input_nodes');
    }
    counter.nodes += 1;
}
function isAccessorDescriptor(descriptor) {
    return hasOwn(descriptor, 'get') || hasOwn(descriptor, 'set');
}
function snapshotReservedJsonValue(value, inputDepth, active, candidate, counter) {
    if (value === undefined
        || typeof value === 'bigint'
        || typeof value === 'function'
        || typeof value === 'symbol'
        || (typeof value === 'number' && !Number.isFinite(value))) {
        throw invalidJsonError(candidate);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (nodeUtilTypes.isProxy(value)) {
        throw invalidJsonError(false);
    }
    if (!Array.isArray(value) && !isJsonRecord(value)) {
        throw invalidJsonError(candidate);
    }
    if (active.has(value)) {
        throw invalidJsonError(candidate);
    }
    active.add(value);
    try {
        if (Array.isArray(value)) {
            const snapshot = [];
            const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
            const length = lengthDescriptor?.value;
            if (!Number.isSafeInteger(length) || length < 0) {
                throw invalidJsonError(candidate);
            }
            for (let index = 0; index < length; index += 1) {
                reserveInputNode(inputDepth + 1, counter);
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                if (!descriptor) {
                    throw invalidJsonError(candidate);
                }
                if (isAccessorDescriptor(descriptor)) {
                    throw invalidJsonError(false);
                }
                snapshot.push(snapshotReservedJsonValue(descriptor.value, inputDepth + 1, active, candidate, counter));
            }
            return snapshot;
        }
        const snapshot = {};
        for (const key in value) {
            if (!hasOwn(value, key))
                continue;
            reserveInputNode(inputDepth + 1, counter);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || isAccessorDescriptor(descriptor)) {
                throw invalidJsonError(false);
            }
            defineOwn(snapshot, key, snapshotReservedJsonValue(descriptor.value, inputDepth + 1, active, candidate || key === 'enum' || key === 'const', counter));
        }
        return snapshot;
    }
    finally {
        active.delete(value);
    }
}
function snapshotJsonValue(value, inputDepth, active, candidate, counter) {
    reserveInputNode(inputDepth, counter);
    return snapshotReservedJsonValue(value, inputDepth, active, candidate, counter);
}
function cloneJsonValue(value, state) {
    if (Array.isArray(value)) {
        const cloned = beginOutputArray(state);
        for (let index = 0; index < value.length; index += 1) {
            reserveArrayEntry(state, index);
            cloned.push(cloneJsonValue(value[index], state));
        }
        return cloned;
    }
    if (isJsonRecord(value)) {
        const cloned = beginOutputObject(state);
        const entries = Object.entries(value);
        for (let index = 0; index < entries.length; index += 1) {
            const [key, child] = entries[index];
            reserveObjectEntry(state, key, index);
            defineOwn(cloned, key, cloneJsonValue(child, state));
        }
        return cloned;
    }
    reserveOutputNode(state);
    if (typeof value === 'string') {
        reserveJsonStringBytes(value, state);
    }
    else if (typeof value === 'number') {
        reserveOutputBytes(state, String(Object.is(value, -0) ? 0 : value).length);
    }
    else if (typeof value === 'boolean') {
        reserveOutputBytes(state, value ? 4 : 5);
    }
    else {
        reserveOutputBytes(state, 4);
    }
    return value;
}
function jsonTypeOf(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    if (typeof value === 'number') {
        return Number.isInteger(value) ? 'integer' : 'number';
    }
    return typeof value;
}
function combineCandidateTypes(left, right) {
    if (left === right)
        return left;
    if ((left === 'integer' && right === 'number')
        || (left === 'number' && right === 'integer')) {
        return 'number';
    }
    return undefined;
}
function inferEnumType(values) {
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
function typesAreCompatible(declared, candidate) {
    return declared === candidate
        || (declared === 'number' && candidate === 'integer');
}
function candidateTypeFor(schema, tolerateMixedEnum) {
    const enumValue = schema.enum;
    if (Array.isArray(enumValue) && enumValue.length > 0) {
        let enumType;
        try {
            enumType = inferEnumType(enumValue);
        }
        catch (error) {
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
function hasAnyHint(schema, hints) {
    return hints.some((key) => hasOwn(schema, key));
}
function hasApplicator(schema) {
    return APPLICATOR_SLOTS.some((key) => hasOwn(schema, key));
}
function completeType(schema, isRoot) {
    const declaredType = schema.type;
    if (typeof declaredType === 'string' && declaredType.length > 0) {
        const candidate = candidateTypeFor(schema, true);
        if (candidate
            && !typesAreCompatible(declaredType, candidate)) {
            schema.type = candidate;
            return { type: candidate, changed: true };
        }
        return { type: declaredType, changed: false };
    }
    if (Array.isArray(declaredType)) {
        return { type: undefined, changed: false };
    }
    if (isRoot || hasApplicator(schema)) {
        return { type: undefined, changed: false };
    }
    const candidate = candidateTypeFor(schema, false);
    if (candidate) {
        schema.type = candidate;
        return { type: candidate, changed: true };
    }
    let inferred;
    if (hasAnyHint(schema, OBJECT_HINTS)) {
        inferred = 'object';
    }
    else if (hasAnyHint(schema, ARRAY_HINTS)) {
        inferred = 'array';
    }
    else if (hasAnyHint(schema, STRING_HINTS)) {
        inferred = 'string';
    }
    else if (hasAnyHint(schema, NUMBER_HINTS)) {
        inferred = 'number';
    }
    else {
        inferred = 'string';
    }
    schema.type = inferred;
    return { type: inferred, changed: true };
}
function removeIncompatibleKeys(schema, type) {
    if (!type)
        return;
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
function resolveLocalPointer(root, ref) {
    if (ref === '#')
        return root;
    if (!ref.startsWith('#/'))
        return undefined;
    let current = root;
    for (const encodedSegment of ref.slice(2).split('/')) {
        const segment = encodedSegment
            .replace(/~1/g, '/')
            .replace(/~0/g, '~');
        if ((isJsonRecord(current) || Array.isArray(current))
            && hasOwn(current, segment)) {
            current = current[segment];
            continue;
        }
        return undefined;
    }
    return current;
}
function normalizeSchemaMap(value, state, structuralDepth, activeSchemas, refStack) {
    if (!isJsonRecord(value)) {
        return cloneJsonValue(value, state);
    }
    const normalized = beginOutputObject(state);
    const entries = Object.entries(value);
    for (let index = 0; index < entries.length; index += 1) {
        const [key, child] = entries[index];
        reserveObjectEntry(state, key, index);
        defineOwn(normalized, key, isJsonRecord(child)
            ? normalizeSchemaNode(child, state, structuralDepth + 1, 0, false, activeSchemas, refStack)
            : cloneJsonValue(child, state));
    }
    return normalized;
}
function normalizeSchemaArray(value, state, structuralDepth, activeSchemas, refStack) {
    if (!Array.isArray(value)) {
        return cloneJsonValue(value, state);
    }
    const normalized = beginOutputArray(state);
    for (let index = 0; index < value.length; index += 1) {
        reserveArrayEntry(state, index);
        const child = value[index];
        normalized.push(isJsonRecord(child)
            ? normalizeSchemaNode(child, state, structuralDepth + 1, 0, false, activeSchemas, refStack)
            : cloneJsonValue(child, state));
    }
    return normalized;
}
function normalizeChildSlot(key, value, state, structuralDepth, activeSchemas, refStack) {
    if (SCHEMA_MAP_SLOTS.has(key)) {
        return normalizeSchemaMap(value, state, structuralDepth, activeSchemas, refStack);
    }
    if (SCHEMA_ARRAY_SLOTS.has(key)) {
        return normalizeSchemaArray(value, state, structuralDepth, activeSchemas, refStack);
    }
    if (key === 'items' && Array.isArray(value)) {
        return normalizeSchemaArray(value, state, structuralDepth, activeSchemas, refStack);
    }
    return isJsonRecord(value)
        ? normalizeSchemaNode(value, state, structuralDepth + 1, 0, false, activeSchemas, refStack)
        : cloneJsonValue(value, state);
}
function normalizeSchemaBody(input, state, structuralDepth, isRoot, activeSchemas, refStack, shouldCompleteType) {
    const draft = {};
    for (const [key, value] of Object.entries(input)) {
        defineOwn(draft, key, value);
    }
    let completion = {
        type: undefined,
        changed: false,
    };
    if (shouldCompleteType) {
        completion = completeType(draft, isRoot);
    }
    if (completion.changed) {
        removeIncompatibleKeys(draft, completion.type);
    }
    const normalized = beginOutputObject(state);
    const entries = Object.entries(draft);
    for (let index = 0; index < entries.length; index += 1) {
        const [key, value] = entries[index];
        reserveObjectEntry(state, key, index);
        defineOwn(normalized, key, CHILD_SCHEMA_SLOTS.has(key)
            ? normalizeChildSlot(key, value, state, structuralDepth, activeSchemas, refStack)
            : cloneJsonValue(value, state));
    }
    return normalized;
}
function normalizeSchemaNode(input, state, structuralDepth, refDepth, isRoot, activeSchemas, refStack, skipTypeCompletion = false) {
    if (structuralDepth > KIMI_SCHEMA_LIMITS.maxDepth
        || refDepth > KIMI_SCHEMA_LIMITS.maxDepth) {
        throw limitError('depth');
    }
    const shouldSkipType = skipTypeCompletion || hasApplicator(input);
    const activeForChildren = new Set(activeSchemas);
    activeForChildren.add(input);
    const ref = input.$ref;
    if (typeof ref === 'string') {
        const target = resolveLocalPointer(state.root, ref);
        if (!isJsonRecord(target)) {
            return normalizeSchemaBody(input, state, structuralDepth, isRoot, activeForChildren, refStack, false);
        }
        if (activeForChildren.has(target) || refStack.has(ref)) {
            return normalizeSchemaBody(input, state, structuralDepth, isRoot, activeForChildren, refStack, false);
        }
        state.refExpansions += 1;
        if (state.refExpansions > KIMI_SCHEMA_LIMITS.maxRefExpansions) {
            throw limitError('ref_expansions');
        }
        const siblings = {};
        for (const [key, value] of Object.entries(input)) {
            if (key !== '$ref') {
                defineOwn(siblings, key, value);
            }
        }
        const merged = {};
        for (const [key, value] of Object.entries(target)) {
            defineOwn(merged, key, value);
        }
        for (const [key, value] of Object.entries(siblings)) {
            defineOwn(merged, key, value);
        }
        const nextActive = new Set(activeForChildren);
        nextActive.add(target);
        const nextRefStack = new Set(refStack);
        nextRefStack.add(ref);
        return normalizeSchemaNode(merged, state, structuralDepth, refDepth + 1, isRoot, nextActive, nextRefStack, true);
    }
    return normalizeSchemaBody(input, state, structuralDepth, isRoot, activeForChildren, refStack, !shouldSkipType);
}
export function normalizeKimiToolSchema(schema) {
    const inputCounter = { nodes: 0 };
    const snapshot = snapshotJsonValue(schema, 0, new Set(), false, inputCounter);
    if (!isJsonRecord(snapshot)) {
        throw invalidJsonError(false);
    }
    const state = {
        root: snapshot,
        refExpansions: 0,
        outputNodes: 0,
        outputBytes: 0,
    };
    const normalized = normalizeSchemaNode(snapshot, state, 0, 0, true, new Set(), new Set());
    return {
        schema: normalized,
        inputNodes: inputCounter.nodes,
        outputNodes: state.outputNodes,
        outputBytes: state.outputBytes,
    };
}
