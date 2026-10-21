import { isAbsolute, win32 } from 'node:path';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { parseMaterialPrepareRequest, parseMaterialRequestObservation } from '../verification/material-request.js';
import { parseVerificationObligationObservation } from '../verification/verification-obligation-observation.js';
import { parseVerificationOperationRequestObservation } from '../verification/verification-operation-request.js';
import { loopHostSubjectOwner } from '../verification/loop-host-subject.js';
import { goalVerificationRegistration } from '../goal/verification-definition.js';
import { freezeLoopPublicationValue } from './publication-config.js';
export function executionIdentity(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('loop_verification_execution_identity');
}
export function executionFields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(k => typeof k !== 'string')
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
        || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d)))
        throw Error('loop_verification_execution_input');
}
export function captureExecutionValue(value) {
    const seen = new WeakSet();
    let nodes = 0;
    const check = (v, depth) => {
        if (++nodes > 200000 || depth > 64)
            throw Error('loop_verification_execution_input');
        if (v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v))
            return;
        if (!v || typeof v !== 'object' || seen.has(v) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(v)))
            throw Error('loop_verification_execution_input');
        seen.add(v);
        for (const key of Reflect.ownKeys(v)) {
            const d = Object.getOwnPropertyDescriptor(v, key);
            if (typeof key !== 'string' || !('value' in d))
                throw Error('loop_verification_execution_input');
            check(d.value, depth + 1);
        }
    };
    check(value, 0);
    const encoded = json(value);
    if (Buffer.byteLength(encoded) > 4 * 1024 ** 2)
        throw Error('loop_verification_execution_size');
    return JSON.parse(encoded);
}
export function parseLoopVerificationCommand(raw) {
    const value = captureExecutionValue(raw);
    executionFields(value, ['argv', 'cwdRelative']);
    if (!Array.isArray(value.argv) || !value.argv.length || value.argv.length > 256
        || value.argv.some((v) => typeof v !== 'string' || !v || Buffer.byteLength(v) > 65536 || /[\0\r\n]/.test(v))
        || typeof value.cwdRelative !== 'string' || !value.cwdRelative || Buffer.byteLength(value.cwdRelative) > 4096 || /[\0\r\n]/.test(value.cwdRelative)
        || isAbsolute(value.cwdRelative) || win32.isAbsolute(value.cwdRelative) || value.cwdRelative.split(/[\\/]/).includes('..'))
        throw Error('loop_verification_execution_command');
    if (Buffer.byteLength(json(value)) > 1024 ** 2)
        throw Error('loop_verification_execution_command');
    return freezeLoopPublicationValue(value);
}
export function parseLoopVerificationObligationForTarget(raw, session, target) {
    const o = parseVerificationObligationObservation(raw), owner = loopHostSubjectOwner(target.binding.subject);
    const definition = goalVerificationRegistration(target.definition).obligations.find(v => v.obligation.obligationId === session.obligationId)?.obligation;
    if (o.owner.ownerKind !== owner.ownerKind || o.owner.ownerId !== owner.ownerId || o.obligationId !== session.obligationId || o.definitionHash !== definition?.definitionHash || o.application.state !== 'active' || o.application.pendingTransitionId !== null || json(o.application.current?.binding) !== json(target.binding))
        throw Error('loop_verification_execution_obligation');
    return o;
}
export function parseLoopVerificationExecution(raw, session, target) {
    const row = captureExecutionValue(raw);
    executionFields(row, ['id', 'sessionRecordId', 'nativeAttemptId', 'candidateId', 'obligationId', 'invocation', 'exactCommand', 'expiresAt', 'materialRequestId', 'verificationRequestId', 'phase', 'revision', 'createdAt', 'updatedAt', 'draft', 'challengeId', 'obligationObservation', 'operationId', 'attemptId', 'materialObservation', 'verificationObservation']);
    for (const k of ['id', 'sessionRecordId', 'nativeAttemptId', 'candidateId', 'obligationId', 'materialRequestId', 'verificationRequestId'])
        executionIdentity(row[k]);
    const invocation = { sessionIdentity: session.sessionId, compoundOperationId: session.operationId, validationInvocationId: session.validationInvocationId };
    if (session.phase !== 'enrolled' || row.sessionRecordId !== session.id || row.nativeAttemptId !== session.nativeAttemptId || row.candidateId !== session.candidateId || row.obligationId !== session.obligationId || json(row.invocation) !== json(invocation)
        || new Set([row.id, row.materialRequestId, row.verificationRequestId, session.id, session.sessionId, session.operationId, session.validationInvocationId, session.enrollmentRequestId]).size !== 8)
        throw Error('loop_verification_execution_target');
    const phases = ['selecting', 'preparing_material', 'authorizing_material', 'staging_material', 'preparing_verification', 'dispatching', 'observing', 'terminal', 'retired'];
    if (!phases.includes(row.phase) || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.createdAt) || row.createdAt < session.updatedAt || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < row.createdAt || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= row.createdAt || row.expiresAt > row.createdAt + 86400000)
        throw Error('loop_verification_execution_state');
    row.exactCommand = parseLoopVerificationCommand(row.exactCommand);
    if (row.draft !== null) {
        row.draft = parseMaterialPrepareRequest({ requestId: row.materialRequestId, requestSource: 'user', draft: row.draft }).draft;
        if (row.draft.purpose !== 'isolated-command' || json(row.draft.invocation) !== json(invocation) || json(row.draft.exactCommand) !== json(row.exactCommand) || row.draft.expiresAt !== row.expiresAt)
            throw Error('loop_verification_execution_material');
    }
    if (row.challengeId !== null)
        executionIdentity(row.challengeId);
    const owner = loopHostSubjectOwner(target.binding.subject);
    if (row.obligationObservation !== null)
        row.obligationObservation = parseLoopVerificationObligationForTarget(row.obligationObservation, session, target);
    if ((row.operationId === null) !== (row.attemptId === null))
        throw Error('loop_verification_execution_operation');
    if (row.operationId !== null) {
        executionIdentity(row.operationId);
        executionIdentity(row.attemptId);
    }
    if (row.materialObservation !== null) {
        row.materialObservation = parseMaterialRequestObservation(row.materialObservation);
        const m = row.materialObservation;
        if (m.requestId !== row.materialRequestId || row.challengeId !== null && m.challengeId !== undefined && m.challengeId !== row.challengeId || m.handoff && json(m.handoff.invocation) !== json(invocation))
            throw Error('loop_verification_execution_material');
    }
    if (row.verificationObservation !== null) {
        row.verificationObservation = parseVerificationOperationRequestObservation(row.verificationObservation);
        const v = row.verificationObservation;
        if (v.requestId !== row.verificationRequestId || v.obligationId !== row.obligationId || json(v.invocation) !== json(invocation) || v.owner.ownerKind !== owner.ownerKind || v.owner.ownerId !== owner.ownerId
            || row.obligationObservation && json(v.owner) !== json(row.obligationObservation.owner))
            throw Error('loop_verification_execution_observation');
        if (v.state === 'operation' && (v.operation.id !== row.operationId || v.operation.attemptId !== row.attemptId))
            throw Error('loop_verification_execution_operation');
        if (v.state !== 'operation' && row.operationId !== null)
            throw Error('loop_verification_execution_operation');
    }
    if (['preparing_material', 'authorizing_material', 'staging_material', 'preparing_verification', 'dispatching'].includes(row.phase) && !row.draft
        || ['authorizing_material', 'staging_material', 'preparing_verification', 'dispatching'].includes(row.phase) && !row.challengeId
        || ['preparing_verification', 'dispatching'].includes(row.phase) && !row.obligationObservation
        || row.phase === 'dispatching' && !row.operationId)
        throw Error('loop_verification_execution_state');
    if (row.phase === 'terminal' && (row.verificationObservation?.state !== 'operation' || row.verificationObservation.operation.state !== 'terminal' || !row.verificationObservation.operation.terminalResult))
        throw Error('loop_verification_execution_terminal');
    if (row.phase === 'retired' && row.draft !== null && !(['not_prepared', 'retired'].includes(row.verificationObservation?.state ?? '') || row.verificationObservation?.state === 'operation' && row.verificationObservation.operation.state === 'cancelled'))
        throw Error('loop_verification_execution_retired');
    return freezeLoopPublicationValue(row);
}
