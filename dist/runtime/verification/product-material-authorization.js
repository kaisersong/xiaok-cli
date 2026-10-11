import { isDeepStrictEqual as initialIsDeepStrictEqual } from 'node:util';
const isDeepStrictEqual = initialIsDeepStrictEqual;
import { isAbsolute } from 'node:path';
import { parseMaterialPrepareResult } from './material-request.js';
import { canonicalVerificationJson } from './protocol.js';
const privatePlans = new WeakMap();
function fail(reason) { throw Error(`validation_material_${reason}`); }
function record(value, keys, reason = 'invalid_request') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        fail(reason);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length !== keys.length || Object.keys(descriptors).some(key => !keys.includes(key) || !('value' in descriptors[key])))
        fail(reason);
    return value;
}
function text(value, max = 4096) { if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > max || /[\0\r\n]/.test(value))
    fail('invalid_request'); }
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('invalid_hash'); }
function freeze(value) { if (value && typeof value === 'object') {
    for (const item of Object.values(value))
        freeze(item);
    Object.freeze(value);
} return value; }
function invocation(value) {
    const v = record(value, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId']);
    for (const item of Object.values(v))
        text(item, 160);
}
export function parseValidationMaterialDraft(value, now) {
    const hasEdited = !!value && typeof value === 'object' && Object.hasOwn(value, 'editedFile');
    const v = record(value, ['purpose', 'invocation', 'materials', 'exactCommand', 'expiresAt', ...(hasEdited ? ['editedFile'] : [])]);
    if (!['isolated-validation', 'isolated-command'].includes(v.purpose) || (v.purpose === 'isolated-validation') !== hasEdited || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= now || v.expiresAt > now + 86400000)
        fail('invalid_request');
    invocation(v.invocation);
    if (!Array.isArray(v.materials) || !v.materials.length || v.materials.length > 1024)
        fail('invalid_request');
    let total = 0;
    const paths = new Set();
    for (const raw of v.materials) {
        const item = record(raw, ['path', 'byteLimit']);
        text(item.path);
        if (!isAbsolute(item.path) || paths.has(item.path) || !Number.isSafeInteger(item.byteLimit) || item.byteLimit < 1)
            fail('invalid_request');
        paths.add(item.path);
        total += item.byteLimit;
    }
    if (total > 2 * 1024 ** 3)
        fail('invalid_request');
    const command = record(v.exactCommand, ['argv', 'cwdRelative']);
    if (!Array.isArray(command.argv) || !command.argv.length || command.argv.length > 256)
        fail('invalid_request');
    for (const arg of command.argv)
        text(arg, 65536);
    text(command.cwdRelative);
    if (isAbsolute(command.cwdRelative) || command.cwdRelative.split(/[\\/]/).includes('..'))
        fail('invalid_request');
    if (hasEdited) {
        const edited = record(v.editedFile, ['path', 'afterHash']);
        text(edited.path);
        hash(edited.afterHash);
        if (!paths.has(edited.path))
            fail('edited_file_not_selected');
    }
    const copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy)) > 1024 ** 2)
        fail('invalid_request');
    return freeze(copy);
}
function reviewSnapshot(raw, draft) {
    const value = record(raw, ['purpose', 'invocation', 'materials', 'exactCommand', 'expiresAt', 'engineBinding', 'scopeDigest', ...(draft.editedFile ? ['editedFile'] : [])], 'challenge_mismatch');
    const engine = record(value.engineBinding, ['engineId', 'incarnation'], 'challenge_mismatch');
    text(engine.engineId, 160);
    text(engine.incarnation, 160);
    hash(value.scopeDigest);
    if (!Array.isArray(value.materials) || value.materials.length !== draft.materials.length)
        fail('challenge_mismatch');
    const materials = value.materials.map(raw => { const entry = record(raw, ['path', 'byteLimit', 'sha256', 'size'], 'challenge_mismatch'); hash(entry.sha256); if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > entry.byteLimit)
        fail('challenge_mismatch'); return { path: entry.path, byteLimit: entry.byteLimit }; });
    const actual = { purpose: value.purpose, invocation: value.invocation, materials, exactCommand: value.exactCommand, ...(draft.editedFile ? { editedFile: value.editedFile } : {}), expiresAt: value.expiresAt };
    if (!isDeepStrictEqual(actual, draft))
        fail('challenge_mismatch');
    if (draft.editedFile) {
        const edited = value.materials.find(item => item.path === draft.editedFile.path);
        if (edited?.sha256 !== draft.editedFile.afterHash)
            fail('challenge_edited_hash_mismatch');
    }
    return freeze(structuredClone(value));
}
function handleSnapshot(raw) { const value = record(raw, ['id', 'secret'], 'invalid_handle'); text(value.id, 160); text(value.secret, 4096); if (value.secret.length < 16)
    fail('invalid_handle'); return freeze({ ...value }); }
/** Product main/CLI only. Review displays facts; only the installed service's OS
 * authorization may issue a grant. No approved boolean exists in this protocol. */
export async function authorizeProductValidationMaterials(input) {
    if (input.requestSource !== 'user')
        fail('user_required');
    // Capture the actual private ports and request before any guard or await.
    const client = input.client, prepare = client.prepareMaterialAuthorization.bind(client), prepareRequest = client.prepareMaterialAuthorizationRequest?.bind(client), authorize = client.authorizeMaterialChallenge.bind(client), stage = client.prepareValidationInput.bind(client);
    const reviewPort = input.review.bind(input), ownerCurrent = input.assertCurrent.bind(input), now = Date.now.bind(Date), draftValue = JSON.parse(canonicalVerificationJson(input.draft));
    const signal = input.signal ?? new AbortController().signal;
    const originalRequest = input.request;
    let requestId, beforeStep;
    if (originalRequest !== undefined) {
        const request = record(originalRequest, ['requestId', 'beforeStep']);
        text(request.requestId, 160);
        if (/[\x00-\x1f\x7f]/.test(request.requestId) || typeof request.beforeStep !== 'function' || !prepareRequest)
            fail('request_unsupported');
        requestId = request.requestId;
        beforeStep = request.beforeStep.bind(originalRequest);
    }
    const assertCurrent = () => { signal.throwIfAborted(); const returned = ownerCurrent(); if (returned !== undefined) {
        if (returned && typeof returned.then === 'function')
            void Promise.resolve(returned).catch(() => { });
        fail('owner_guard_must_be_synchronous');
    } signal.throwIfAborted(); };
    const draft = parseValidationMaterialDraft(draftValue, now());
    assertCurrent();
    const current = () => { assertCurrent(); if (now() >= draft.expiresAt)
        fail('expired'); signal.throwIfAborted(); };
    const before = async (phase, challengeId) => { if (beforeStep)
        await beforeStep(freeze({ requestId: requestId, phase, draft, ...(challengeId ? { challengeId } : {}) })); current(); };
    await before('prepare');
    current();
    let challenge;
    if (requestId !== undefined) {
        const result = parseMaterialPrepareResult(await prepareRequest({ requestId, draft }, { signal }));
        current();
        if (result.requestId !== requestId || !result.created || !result.challengeId)
            fail('request_not_fresh');
        challenge = { challengeId: result.challengeId, canonicalReview: result.canonicalReview };
    }
    else {
        challenge = await prepare(draft, { signal });
        current();
    }
    record(challenge, ['challengeId', 'canonicalReview'], 'challenge_mismatch');
    text(challenge.challengeId, 160);
    const challengeId = challenge.challengeId, review = reviewSnapshot(challenge.canonicalReview, draft);
    await reviewPort(review);
    current();
    await before('authorize', challengeId);
    current();
    const grant = handleSnapshot(await authorize(challengeId, { signal }));
    current();
    await before('stage', challengeId);
    current();
    const prepared = await stage({ grantHandle: grant, invocation: draft.invocation }, { signal });
    current();
    record(prepared, ['mountPlanHandle', 'command', 'scopeDigest', 'invocation'], 'prepared_mismatch');
    const mountPlanHandle = handleSnapshot(prepared.mountPlanHandle);
    if (prepared.scopeDigest !== review.scopeDigest || !isDeepStrictEqual(prepared.invocation, draft.invocation) || !isDeepStrictEqual(prepared.command, draft.exactCommand))
        fail('prepared_mismatch');
    const result = freeze({ publicReceipt: { authorizationId: grant.id, scopeDigest: review.scopeDigest, invocation: structuredClone(draft.invocation) } });
    privatePlans.set(result, freeze({ plan: { mountPlanHandle, command: structuredClone(draft.exactCommand), scopeDigest: review.scopeDigest, invocation: structuredClone(draft.invocation) }, authorization: { purpose: draft.purpose, invocation: draft.invocation, exactCommand: draft.exactCommand, ...(draft.editedFile ? { editedFile: draft.editedFile } : {}) } }));
    return result;
}
/** Consumed once by the installed execution client; never serialize into model history or renderer IPC. */
export function consumeProductValidationMaterials(value, expectedAuthorization) {
    const entry = privatePlans.get(value);
    if (!entry)
        fail('plan_missing_or_consumed');
    privatePlans.delete(value);
    if (expectedAuthorization && !isDeepStrictEqual(entry.authorization, expectedAuthorization))
        fail('authorization_mismatch');
    return entry.plan;
}
