import { types as utilTypes } from 'node:util';
export const CANONICAL_JSON_V1_ENCODER_ID = 'xiaok-canonical-json-direct-v1';
export const CANONICAL_JSON_V1_LIMITS = Object.freeze({
    maxCanonicalDepth: 128,
    maxCanonicalContainerEntries: 100_000,
    maxCanonicalTotalNodes: 1_000_000,
    maxCanonicalUtf16CodeUnits: 16_777_216,
});
const capturedIsProxy = utilTypes.isProxy;
const capturedArrayIsArray = Array.isArray;
const capturedObjectGetPrototypeOf = Object.getPrototypeOf;
const capturedReflectOwnKeys = Reflect.ownKeys;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedJsonStringify = JSON.stringify;
const capturedNumberIsFinite = Number.isFinite;
const capturedNumberIsInteger = Number.isInteger;
const capturedNumber = Number;
const capturedString = String;
const capturedObjectIs = Object.is;
const capturedMathMax = Math.max;
const CapturedArray = Array;
const capturedArrayPrototype = Array.prototype;
const capturedObjectPrototype = Object.prototype;
function grammarError() {
    throw new Error('canonicalJsonV1InvalidGrammar');
}
function limitError() {
    throw new Error('canonicalJsonV1LimitExceeded');
}
function addUtf16(state, count) {
    state.utf16CodeUnits += count;
    if (state.utf16CodeUnits
        > CANONICAL_JSON_V1_LIMITS.maxCanonicalUtf16CodeUnits) {
        limitError();
    }
}
function addNode(state, depth) {
    if (depth > CANONICAL_JSON_V1_LIMITS.maxCanonicalDepth) {
        limitError();
    }
    state.nodes += 1;
    if (state.nodes > CANONICAL_JSON_V1_LIMITS.maxCanonicalTotalNodes) {
        limitError();
    }
}
function assertNotAncestor(state, value) {
    for (let index = 0; index < state.ancestors.length; index += 1) {
        if (state.ancestors[index] === value) {
            grammarError();
        }
    }
}
function sortUtf16(keys) {
    for (let index = 1; index < keys.length; index += 1) {
        const value = keys[index];
        let cursor = index - 1;
        while (cursor >= 0 && keys[cursor] > value) {
            keys[cursor + 1] = keys[cursor];
            cursor -= 1;
        }
        keys[cursor + 1] = value;
    }
}
function primitivePlan(value, state) {
    const token = capturedJsonStringify(value);
    if (typeof token !== 'string') {
        grammarError();
    }
    addUtf16(state, token.length);
    return { kind: 'token', token };
}
function validateArray(value, depth, state) {
    const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor
        || !('value' in lengthDescriptor)
        || lengthDescriptor.value !== value.length
        || lengthDescriptor.enumerable
        || lengthDescriptor.configurable) {
        grammarError();
    }
    const length = value.length;
    if (length > CANONICAL_JSON_V1_LIMITS.maxCanonicalContainerEntries) {
        limitError();
    }
    const keys = capturedReflectOwnKeys(value);
    if (keys.length !== length + 1) {
        grammarError();
    }
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== 'string') {
            grammarError();
        }
        if (key !== 'length') {
            const numericIndex = capturedNumber(key);
            if (!capturedNumberIsInteger(numericIndex)
                || numericIndex < 0
                || numericIndex >= length
                || capturedString(numericIndex) !== key) {
                grammarError();
            }
        }
    }
    addUtf16(state, 2 + capturedMathMax(0, length - 1));
    const values = new CapturedArray(length);
    state.ancestors[state.ancestors.length] = value;
    for (let index = 0; index < length; index += 1) {
        const descriptor = capturedGetOwnPropertyDescriptor(value, capturedString(index));
        if (!descriptor
            || !('value' in descriptor)
            || descriptor.enumerable !== true) {
            grammarError();
        }
        values[index] = validateValue(descriptor.value, depth + 1, state);
    }
    state.ancestors.length -= 1;
    return { kind: 'array', values };
}
function validateObject(value, depth, state) {
    const ownKeys = capturedReflectOwnKeys(value);
    if (ownKeys.length > CANONICAL_JSON_V1_LIMITS.maxCanonicalContainerEntries) {
        limitError();
    }
    const keys = new CapturedArray(ownKeys.length);
    for (let index = 0; index < ownKeys.length; index += 1) {
        const key = ownKeys[index];
        if (typeof key !== 'string') {
            grammarError();
        }
        const descriptor = capturedGetOwnPropertyDescriptor(value, key);
        if (!descriptor
            || !('value' in descriptor)
            || descriptor.enumerable !== true) {
            grammarError();
        }
        keys[index] = key;
    }
    sortUtf16(keys);
    addUtf16(state, 2 + capturedMathMax(0, keys.length - 1));
    const entries = new CapturedArray(keys.length);
    state.ancestors[state.ancestors.length] = value;
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const keyToken = capturedJsonStringify(key);
        if (typeof keyToken !== 'string') {
            grammarError();
        }
        addUtf16(state, keyToken.length + 1);
        const descriptor = capturedGetOwnPropertyDescriptor(value, key);
        entries[index] = {
            keyToken,
            value: validateValue(descriptor.value, depth + 1, state),
        };
    }
    state.ancestors.length -= 1;
    return { kind: 'object', entries };
}
function validateValue(value, depth, state) {
    addNode(state, depth);
    if (value === null) {
        return primitivePlan(null, state);
    }
    if (typeof value === 'boolean' || typeof value === 'string') {
        return primitivePlan(value, state);
    }
    if (typeof value === 'number') {
        if (!capturedNumberIsFinite(value)) {
            grammarError();
        }
        return primitivePlan(capturedObjectIs(value, -0) ? 0 : value, state);
    }
    if (typeof value !== 'object') {
        grammarError();
    }
    if (capturedIsProxy(value)) {
        grammarError();
    }
    assertNotAncestor(state, value);
    if (capturedArrayIsArray(value)) {
        if (capturedObjectGetPrototypeOf(value) !== capturedArrayPrototype) {
            grammarError();
        }
        return validateArray(value, depth, state);
    }
    const prototype = capturedObjectGetPrototypeOf(value);
    if (prototype !== capturedObjectPrototype && prototype !== null) {
        grammarError();
    }
    return validateObject(value, depth, state);
}
function emit(plan) {
    if (plan.kind === 'token') {
        return plan.token;
    }
    if (plan.kind === 'array') {
        let output = '[';
        for (let index = 0; index < plan.values.length; index += 1) {
            if (index > 0)
                output += ',';
            output += emit(plan.values[index]);
        }
        return `${output}]`;
    }
    let output = '{';
    for (let index = 0; index < plan.entries.length; index += 1) {
        if (index > 0)
            output += ',';
        const entry = plan.entries[index];
        output += `${entry.keyToken}:${emit(entry.value)}`;
    }
    return `${output}}`;
}
export function canonicalJsonV1(value) {
    const plan = validateValue(value, 1, {
        nodes: 0,
        utf16CodeUnits: 0,
        ancestors: [],
    });
    return emit(plan);
}
