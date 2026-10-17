import { parseIntentVerificationOperation, applyIntentVerificationOperation } from './verification-operation-journal.js';
import { parseOwnerEnrollmentReview, parseOwnerEnrollmentRegistration } from '../verification/owner-enrollment-review.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { intentContractOriginalRegistration, intentOriginalRegistrationHash } from '../verification/intent-contract-enrollment.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureIntentData } from './data.js';
import { intentNativeLedgerHash } from './native-contract-journal.js';
import { parseIntentPublicationCandidates, intentPublicationTarget, intentPublicationRouteVector, applyIntentPublicationMutation } from './publication-candidate-journal.js';
import { assertSessionWriteOwnership } from './ownership.js';
import { parseValidationMaterialDraft } from '../verification/product-material-authorization.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
function shape(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(' ').sort().join(','))
    throw Error('intent_verification_shape'); }
function identity(v) { if (typeof v !== 'string' || !v.length || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('intent_verification_identity'); }
function frozen(v) { if (v && typeof v === 'object') {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
} return v; }
function target(ledger, candidateId, obligationId, registration) {
    const candidate = parseIntentPublicationCandidates(ledger).find(row => row.id === candidateId);
    if (!candidate)
        throw Error('intent_verification_candidate');
    const binding = intentPublicationTarget(ledger, candidate), definition = binding.subject.stageId === null ? binding.contract.verification : binding.contract.stages.find(stage => stage.stageId === binding.subject.stageId).verification;
    if (!(registration ? parseOwnerEnrollmentRegistration(registration).obligations.some(o => o.obligation.obligationId === obligationId) : definition.obligations.some(o => o.obligationId === obligationId)))
        throw Error('intent_verification_obligation');
    return { candidate, binding, definition };
}
/** Durable identity and source facts only. No returned row grants native/execution/publication. */
export function parseIntentVerificationExecutions(ledger) {
    const rows = captureIntentData(ledger?.verificationExecutions ?? []);
    if (!Array.isArray(rows))
        throw Error('intent_verification_shape');
    const identities = new Set(), subjects = new Set();
    for (const row of rows) {
        shape(row, 'version id candidateId obligationId bindingHash sourceHash invocation enrollmentRequestId materialRequestId verificationRequestId draft registration route originalSource phase enrollmentObservation operation revision createdAt updatedAt');
        if (row.version !== 1 || row.originalSource !== 'user' || !['reserved', 'enrolling', 'enrolled', 'retired'].includes(row.phase) || row.revision !== { reserved: 1, enrolling: 2, enrolled: 3, retired: 3 }[row.phase] + (row.operation?.revision ?? 0) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < row.createdAt || row.phase === 'reserved' && row.updatedAt !== row.createdAt)
            throw Error('intent_verification_state');
        [row.id, row.candidateId, row.obligationId, row.enrollmentRequestId, row.materialRequestId, row.verificationRequestId].forEach(identity);
        shape(row.invocation, 'sessionIdentity compoundOperationId validationInvocationId');
        Object.values(row.invocation).forEach(identity);
        if (!ledger || row.invocation.sessionIdentity !== ledger.sessionId)
            throw Error('intent_verification_session');
        for (const id of [row.id, row.invocation.compoundOperationId, row.invocation.validationInvocationId, row.enrollmentRequestId, row.materialRequestId, row.verificationRequestId]) {
            if (identities.has(id))
                throw Error('intent_verification_identity');
            identities.add(id);
        }
        const key = json([row.candidateId, row.obligationId]);
        if (subjects.has(key))
            throw Error('intent_verification_duplicate');
        subjects.add(key);
        const { candidate, binding } = target(ledger, row.candidateId, row.obligationId, row.registration);
        const registration = parseOwnerEnrollmentRegistration(row.registration);
        if (!candidate.applicationAttempts.some(a => a.phase === 'ready' && a.route === row.route && a.observation?.registrationHash === intentOriginalRegistrationHash(registration)))
            throw Error('intent_verification_registration');
        const original = intentContractOriginalRegistration({ subject: binding.subject, contract: binding.contract });
        if (original.obligations.some(entry => !registration.obligations.some(actual => json(actual) === json(entry))))
            throw Error('intent_verification_registration');
        if (row.phase !== 'enrolled' && row.operation !== null)
            throw Error('intent_operation_phase');
        parseIntentVerificationOperation(row.operation, row, binding);
        validateFact(row.enrollmentObservation, row, binding);
        if (row.phase !== phaseForFact(row.enrollmentObservation, row.phase === 'reserved'))
            throw Error('intent_verification_state');
        if (row.bindingHash !== candidate.bindingHash || row.sourceHash !== candidate.sourceHash || !candidate.applicationAttempts.some(a => a.phase === 'ready' && a.route === row.route))
            throw Error('intent_verification_original');
        const draft = parseValidationMaterialDraft(row.draft, row.createdAt);
        if (draft.purpose !== 'isolated-command' || json(draft.invocation) !== json(row.invocation))
            throw Error('intent_verification_draft');
    }
    return frozen(rows);
}
export function captureIntentVerificationReserve(raw) {
    if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
        throw Error('intent_verification_input');
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !('value' in d)))
        throw Error('intent_verification_accessor');
    const { lease, ...fields } = descriptors;
    if (!lease)
        throw Error('intent_verification_lease');
    const input = captureIntentData(Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, d.value])));
    shape(input, 'sessionId instanceId candidateId obligationId expectedLedgerHash requestSource now registration exactCommand materials expiresAt');
    [input.sessionId, input.instanceId, input.candidateId, input.obligationId].forEach(identity);
    if (input.requestSource !== 'user' || !Number.isSafeInteger(input.now) || input.now < 0 || typeof input.expectedLedgerHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedLedgerHash))
        throw Error('intent_verification_source');
    return { input: { ...input, verificationAction: 'reserve', publicationAction: 'verification' }, lease: lease.value };
}
export function captureIntentVerificationClaim(raw) {
    if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
        throw Error('intent_verification_input');
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !('value' in d)))
        throw Error('intent_verification_accessor');
    const { lease, ...fields } = descriptors;
    if (!lease)
        throw Error('intent_verification_lease');
    const input = captureIntentData(Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, d.value])));
    shape(input, 'sessionId instanceId id expectedLedgerHash expectedRevision requestSource now');
    [input.sessionId, input.instanceId, input.id].forEach(identity);
    if (input.requestSource !== 'user' || !Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.expectedLedgerHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedLedgerHash))
        throw Error('intent_verification_source');
    return { input: { ...input, verificationAction: 'claim-enrollment', publicationAction: 'verification' }, lease: lease.value };
}
const hash = (value) => createHash('sha256').update(json(value)).digest('hex');
function phaseForFact(fact, reserved = false) { return fact === null ? (reserved ? 'reserved' : 'enrolling') : fact.state === 'committed' ? 'enrolled' : 'retired'; }
function proposal(row, binding) { return { enrollment: { ...intentHostSubjectOwner(binding.subject), invocations: [row.invocation] }, registration: row.registration }; }
function validateFact(raw, row, binding) {
    if (raw === null)
        return;
    shape(raw, raw && typeof raw === 'object' && raw.state === 'not_prepared' ? 'state' : 'state challengeId reviewHash enrollmentHash registrationHash authorityId');
    if (raw.state === 'not_prepared')
        return;
    if (!['not_approved', 'committed'].includes(raw.state))
        throw Error('intent_verification_enrollment');
    const original = proposal(row, binding), route = JSON.parse(row.route);
    identity(raw.challengeId);
    if (raw.authorityId !== route.authorityId || raw.enrollmentHash !== hash(original.enrollment) || raw.registrationHash !== hash(original.registration) || typeof raw.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.reviewHash))
        throw Error('intent_verification_enrollment');
}
function enrollmentFact(raw, row, binding) {
    const value = captureIntentData(raw);
    shape(value, value.state === 'not_prepared' ? 'state' : value.state === 'committed' ? 'state challenge owner' : 'state challenge');
    if (value.state === 'not_prepared')
        return { state: 'not_prepared' };
    if (value.state !== 'not_approved' && value.state !== 'committed')
        throw Error('intent_verification_enrollment');
    shape(value.challenge, 'challengeId canonicalReview');
    const review = parseOwnerEnrollmentReview(value.challenge.canonicalReview), original = proposal(row, binding), route = JSON.parse(row.route);
    if (value.challenge.challengeId !== review.challengeId || review.authorityId !== route.authorityId || json(review.enrollment) !== json(original.enrollment) || json(review.registration) !== json(original.registration) || value.state === 'committed' && json(value.owner) !== json(route.owner))
        throw Error('intent_verification_enrollment');
    return { state: value.state, challengeId: review.challengeId, reviewHash: hash(review), authorityId: review.authorityId, enrollmentHash: hash(review.enrollment), registrationHash: hash(review.registration) };
}
export function captureIntentVerificationObservation(raw) {
    if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
        throw Error('intent_verification_input');
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !('value' in d)))
        throw Error('intent_verification_accessor');
    const { lease, ...fields } = descriptors;
    if (!lease)
        throw Error('intent_verification_lease');
    const input = captureIntentData(Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, d.value])));
    shape(input, 'sessionId instanceId id expectedLedgerHash expectedRevision requestSource now observation');
    [input.sessionId, input.instanceId, input.id].forEach(identity);
    if (!['user', 'scheduler'].includes(input.requestSource) || !Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.expectedLedgerHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedLedgerHash))
        throw Error('intent_verification_source');
    return { input: { ...input, verificationAction: 'observe-enrollment', publicationAction: 'verification' }, lease: lease.value };
}
export function captureIntentVerificationOperation(raw) {
    if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
        throw Error('intent_verification_input');
    const d = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(p => !('value' in p)))
        throw Error('intent_verification_accessor');
    const { lease, ...fields } = d;
    if (!lease)
        throw Error('intent_verification_lease');
    const input = captureIntentData(Object.fromEntries(Object.entries(fields).map(([k, p]) => [k, p.value])));
    shape(input, 'sessionId instanceId id expectedLedgerHash expectedRevision requestSource now action');
    [input.sessionId, input.instanceId, input.id].forEach(identity);
    if (!['user', 'scheduler'].includes(input.requestSource) || input.action?.kind !== 'observe' && input.requestSource !== 'user' || !Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.expectedLedgerHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedLedgerHash))
        throw Error('intent_verification_source');
    return { input: { ...input, verificationAction: 'operation', publicationAction: 'verification' }, lease: lease.value };
}
function currentCandidate(previous, ledger, input, candidate) {
    const attempt = candidate.applicationAttempts.at(-1);
    if (attempt.phase !== 'ready' || !attempt.route || input.now < attempt.updatedAt || ledger.activeIntentId !== candidate.intentId || (candidate.stageId === null ? ledger.intents.find(r => r.intentId === candidate.intentId)?.overallStatus !== 'publication_pending' || ledger.intents.find(r => r.intentId === candidate.intentId).stages.some(s => s.status !== 'completed') : ledger.intents.find(r => r.intentId === candidate.intentId)?.activeStageId !== candidate.stageId) || intentPublicationRouteVector(ledger, candidate.id) !== attempt.route)
        throw Error('intent_verification_candidate_current');
    applyIntentPublicationMutation(previous, { sessionId: input.sessionId, instanceId: input.instanceId, expectedLedgerHash: input.expectedLedgerHash, requestSource: 'user', now: input.now, fileObservations: candidate.fileObservations, ...(candidate.body.kind === 'intent-parent' ? { publicationAction: 'reserve-parent', references: candidate.body.stages } : { publicationAction: 'reserve', artifactSelections: candidate.body.artifacts.map(a => ({ artifactId: a.artifactId, obligationId: a.selection.obligationId, path: a.selection.path })) }) });
    return attempt.route;
}
export function applyIntentVerificationMutation(previous, input) {
    const next = captureIntentData(previous), ledger = next.intentDelegation;
    if (!ledger || next.sessionId !== input.sessionId || intentNativeLedgerHash(ledger) !== input.expectedLedgerHash)
        throw Error('intent_verification_basis');
    assertSessionWriteOwnership(ledger, input.instanceId, 'reserve intent verification');
    const rows = parseIntentVerificationExecutions(ledger);
    if (input.verificationAction === 'operation') {
        const row = rows.find(r => r.id === input.id);
        if (!row || row.phase !== 'enrolled' || row.revision !== input.expectedRevision || input.now < row.updatedAt)
            throw Error('intent_verification_stale');
        const original = target(ledger, row.candidateId, row.obligationId, row.registration);
        if (input.action.kind !== 'observe') {
            if (input.requestSource !== 'user' || input.now >= row.draft.expiresAt)
                throw Error('intent_verification_expired');
            currentCandidate(previous, ledger, input, original.candidate);
        }
        const operation = applyIntentVerificationOperation(row, original.binding, input.action);
        if (isDeepStrictEqual(operation, row.operation))
            return next;
        ledger.verificationExecutions = rows.map(old => old.id === row.id ? { ...row, operation, revision: row.revision + 1, updatedAt: input.now } : old);
        ledger.updatedAt = Math.max(ledger.updatedAt, input.now);
        next.updatedAt = Math.max(next.updatedAt, input.now);
        parseIntentVerificationExecutions(ledger);
        return next;
    }
    if (input.verificationAction === 'observe-enrollment') {
        const row = rows.find(row => row.id === input.id);
        if (!row || row.revision !== input.expectedRevision || input.now < row.updatedAt)
            throw Error('intent_verification_stale');
        const fact = enrollmentFact(input.observation, row, target(ledger, row.candidateId, row.obligationId, row.registration).binding);
        if (row.phase === 'enrolled' || row.phase === 'retired') {
            if (!isDeepStrictEqual(row.enrollmentObservation, fact))
                throw Error('intent_verification_conflict');
            return next;
        }
        if (row.phase !== 'enrolling')
            throw Error('intent_verification_stale');
        ledger.verificationExecutions = rows.map(old => old.id === row.id ? { ...row, phase: phaseForFact(fact), enrollmentObservation: fact, revision: 3, updatedAt: input.now } : old);
        ledger.updatedAt = Math.max(ledger.updatedAt, input.now);
        next.updatedAt = Math.max(next.updatedAt, input.now);
        parseIntentVerificationExecutions(ledger);
        return next;
    }
    if (input.verificationAction === 'claim-enrollment') {
        const row = rows.find(row => row.id === input.id);
        if (!row || row.phase !== 'reserved' || row.revision !== input.expectedRevision || input.now < row.updatedAt)
            throw Error('intent_verification_stale');
        if (input.now >= row.draft.expiresAt)
            throw Error('intent_verification_expired');
        currentCandidate(previous, ledger, input, target(ledger, row.candidateId, row.obligationId, row.registration).candidate);
        ledger.verificationExecutions = rows.map(old => old.id === row.id ? { ...row, phase: 'enrolling', revision: 2, updatedAt: input.now } : old);
        ledger.updatedAt = Math.max(ledger.updatedAt, input.now);
        next.updatedAt = Math.max(next.updatedAt, input.now);
        parseIntentVerificationExecutions(ledger);
        return next;
    }
    const { candidate } = target(ledger, input.candidateId, input.obligationId, input.registration), existing = rows.find(row => row.candidateId === input.candidateId && row.obligationId === input.obligationId);
    if (existing) {
        if (json(existing.registration) !== json(input.registration) || json(existing.draft.exactCommand) !== json(input.exactCommand) || json(existing.draft.materials) !== json(input.materials) || existing.draft.expiresAt !== input.expiresAt)
            throw Error('intent_verification_conflict');
        return next;
    }
    const route = currentCandidate(previous, ledger, input, candidate), registration = parseOwnerEnrollmentRegistration(input.registration);
    if (candidate.applicationAttempts.at(-1).observation?.registrationHash !== intentOriginalRegistrationHash(registration))
        throw Error('intent_verification_registration');
    const invocation = { sessionIdentity: input.sessionId, compoundOperationId: randomUUID(), validationInvocationId: randomUUID() };
    const draft = parseValidationMaterialDraft({ purpose: 'isolated-command', invocation, exactCommand: input.exactCommand, materials: input.materials, expiresAt: input.expiresAt }, input.now);
    const row = { version: 1, id: randomUUID(), candidateId: candidate.id, obligationId: input.obligationId, bindingHash: candidate.bindingHash, sourceHash: candidate.sourceHash, invocation, enrollmentRequestId: randomUUID(), materialRequestId: randomUUID(), verificationRequestId: randomUUID(), draft, registration, route, originalSource: 'user', phase: 'reserved', enrollmentObservation: null, operation: null, revision: 1, createdAt: input.now, updatedAt: input.now };
    ledger.verificationExecutions = [...rows, row];
    ledger.updatedAt = Math.max(ledger.updatedAt, input.now);
    next.updatedAt = Math.max(next.updatedAt, input.now);
    parseIntentVerificationExecutions(ledger);
    return next;
}
export function assertIntentVerificationRetained(before, after, primitive = false) {
    const a = parseIntentVerificationExecutions(before), b = parseIntentVerificationExecutions(after);
    if (!primitive) {
        if (!isDeepStrictEqual(a, b))
            throw Error('intent_verification_requires_primitive');
        return;
    }
    const strip = (ledger) => { if (!ledger)
        return ledger; const value = captureIntentData(ledger); delete value.verificationExecutions; delete value.updatedAt; return value; };
    let changed = 0;
    if (!isDeepStrictEqual(strip(before), strip(after)) || b.length < a.length || b.length > a.length + 1 || a.some((row, i) => { const next = b[i]; if (isDeepStrictEqual(row, next))
        return false; changed++; if (!next || b.length !== a.length || !((row.phase === 'reserved' && next.phase === 'enrolling') || (row.phase === 'enrolling' && ['enrolled', 'retired'].includes(next.phase)) || (row.phase === 'enrolled' && next.phase === 'enrolled' && isDeepStrictEqual(row.enrollmentObservation, next.enrollmentObservation) && next.operation?.revision === (row.operation?.revision ?? 0) + 1)) || next.revision !== row.revision + 1)
        return true; return !isDeepStrictEqual({ ...row, phase: next.phase, enrollmentObservation: next.enrollmentObservation, operation: next.operation, revision: next.revision, updatedAt: next.updatedAt }, next); }) || changed > 1)
        throw Error('intent_verification_original');
}
