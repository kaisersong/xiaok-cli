import { isDeepStrictEqual } from 'node:util';
import { validateCompoundOperationLedger } from '../../../runtime/sol-pi/compound-operation.js';
import { validateSemanticCompactionLedger } from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import { mergeProtectedObservationClosures } from '../protected-observation-closure.js';
import { captureIntentSnapshot } from '../../../runtime/intent-delegation/intent-snapshot-data.js';
import { cloneSessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import { cloneSessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import { cloneSessionSkillExecutionState } from '../../skills/execution-state.js';
import { parseCapturedSourceJson, capturedFields, capturedIdentity, capturedInteger, freezeCapturedData } from '../../../runtime/verification/captured-source-json.js';
import { assertCapturedMessageSchema } from '../provider-private-data.js';
import { parseIntentHostSubject } from '../../../runtime/verification/intent-host-subject.js';
import { parseIntentNativeContracts } from '../../../runtime/intent-delegation/native-contract-journal.js';
import { parseIntentPublicationCandidates } from '../../../runtime/intent-delegation/publication-candidate-journal.js';
import { parseIntentVerificationExecutions } from '../../../runtime/intent-delegation/verification-execution-journal.js';
export const SESSION_SCHEMA_VERSION = 1;
export function parseFileSessionSnapshot(raw, sessionId, preserveIntent = false) {
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== SESSION_SCHEMA_VERSION) {
        throw new Error('session_snapshot_schema_unsupported');
    }
    const { schemaVersion: _schemaVersion, ...snapshot } = parsed;
    return {
        ...snapshot,
        compoundOperations: snapshot.compoundOperations === undefined ? undefined : validateCompoundOperationLedger(snapshot.compoundOperations),
        semanticCompaction: snapshot.semanticCompaction === undefined ? undefined : validateSemanticCompactionLedger(snapshot.semanticCompaction),
        protectedObservationClosure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure),
        lineage: snapshot.lineage
            ?? [snapshot.sessionId ?? sessionId].filter(Boolean),
        compactions: snapshot.compactions ?? [],
        memoryRefs: snapshot.memoryRefs ?? [],
        approvalRefs: snapshot.approvalRefs ?? [],
        backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
        intentDelegation: snapshot.intentDelegation
            ? (preserveIntent || snapshot.intentDelegation.nativeContracts !== undefined ? captureIntentSnapshot(snapshot).intentDelegation : cloneSessionIntentLedger(snapshot.intentDelegation))
            : undefined,
        skillEval: snapshot.skillEval
            ? cloneSessionSkillEvalState(snapshot.skillEval)
            : undefined,
        skillExecution: snapshot.skillExecution
            ? cloneSessionSkillExecutionState(snapshot.skillExecution)
            : undefined,
    };
}
/** Statements contained in one captured file; the full collector must verify
 * their native registrations and references before forming any attribution. */
export function readCapturedFileSession(raw, sessionId) {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId))
        throw Error('captured_session_selector');
    return readCapturedSessionDocument(raw, sessionId);
}
/** Common serialized snapshot declarations. SQLite callers validate their
 * original JSON columns before passing the original normalized document here;
 * only the File wrapper applies its physical filename identity restriction. */
export function readCapturedSessionDocument(raw, sessionId) {
    const parsed = parseCapturedSourceJson(raw);
    capturedFields(parsed, ['schemaVersion', 'cwd', 'createdAt', 'updatedAt', 'messages', 'usage'], ['sessionId', 'semanticCompaction', 'compoundOperations', 'storeRevision', 'historyDigest', 'executionProtected',
        'protectedObservationClosure', 'model', 'forkedFromSessionId', 'lineage', 'compactions', 'promptSnapshotId',
        'memoryRefs', 'approvalRefs', 'backgroundJobRefs', 'intentDelegation', 'skillEval', 'skillExecution']);
    capturedIdentity(sessionId);
    const storedSessionIdentity = !Object.hasOwn(parsed, 'sessionId') ? 'absent'
        : parsed.sessionId === null ? 'null' : 'present';
    if (storedSessionIdentity === 'present' && parsed.sessionId !== sessionId)
        throw Error('captured_session_identity');
    if (typeof parsed.cwd !== 'string' || !Array.isArray(parsed.messages) || !parsed.usage
        || typeof parsed.usage !== 'object' || Array.isArray(parsed.usage))
        throw Error('captured_session_core');
    assertCapturedMessageSchema(parsed.messages);
    capturedFields(parsed.usage, ['inputTokens', 'outputTokens'], ['cacheCreationInputTokens', 'cacheReadInputTokens']);
    capturedInteger(parsed.usage.inputTokens);
    capturedInteger(parsed.usage.outputTokens);
    for (const key of ['cacheCreationInputTokens', 'cacheReadInputTokens'])
        if (parsed.usage[key] !== undefined)
            capturedInteger(parsed.usage[key]);
    capturedInteger(parsed.createdAt);
    capturedInteger(parsed.updatedAt, parsed.createdAt);
    const snapshot = parseFileSessionSnapshot(raw, sessionId);
    const lineage = parsed.lineage ?? [];
    if (!Array.isArray(lineage))
        throw Error('captured_session_lineage');
    lineage.forEach(capturedIdentity);
    if (snapshot.forkedFromSessionId !== undefined)
        capturedIdentity(snapshot.forkedFromSessionId);
    const subjects = new Map();
    const add = (intentId, stageId) => {
        const subject = parseIntentHostSubject({ version: 1, sessionId, intentId, stageId });
        subjects.set(JSON.stringify([intentId, stageId]), subject);
    };
    const ledger = snapshot.intentDelegation;
    const nativeContracts = parseIntentNativeContracts(ledger?.nativeContracts, sessionId);
    const candidates = parseIntentPublicationCandidates(ledger);
    const verificationExecutions = parseIntentVerificationExecutions(ledger);
    if (ledger) {
        if (ledger.sessionId !== sessionId || !Array.isArray(ledger.intents))
            throw Error('captured_session_intent');
        const ids = new Set();
        for (const record of ledger.intents) {
            if (!record || record.sessionId !== sessionId || ids.has(record.intentId) || !Array.isArray(record.stages))
                throw Error('captured_session_intent');
            add(record.intentId, null);
            ids.add(record.intentId);
            const stages = new Set();
            for (const stage of record.stages) {
                if (!stage || stages.has(stage.stageId))
                    throw Error('captured_session_intent_stage');
                add(record.intentId, stage.stageId);
                stages.add(stage.stageId);
            }
        }
        if (ledger.latestPlan !== null && (!ledger.latestPlan
            || !isDeepStrictEqual(ledger.latestPlan, ledger.intents.find(row => row.intentId === ledger.latestPlan.intentId))))
            throw Error('captured_session_intent_mirror');
        if (ledger.activeIntentId !== undefined && !ids.has(ledger.activeIntentId))
            throw Error('captured_session_intent_active');
        for (const contract of nativeContracts) {
            // Retained native contracts are historical statements even if no longer
            // selected by the ordinary active intent pointer.
            add(contract.intentId, null);
            for (const stage of contract.subjects)
                add(contract.intentId, stage.stageId);
        }
    }
    const sessionReferences = [];
    const ref = (relation, recordId, identity, childStoreRoot) => {
        capturedIdentity(recordId);
        capturedIdentity(identity);
        sessionReferences.push({ relation, recordId, sessionIdentity: identity, ...(childStoreRoot === undefined ? {} : { childStoreRoot }) });
    };
    const compound = snapshot.compoundOperations;
    if (compound) {
        for (const record of compound.operations)
            ref('compound-operation', record.id, record.dispatch.sessionIdentity);
        for (const record of compound.directOperations ?? []) {
            ref('compound-direct', record.id, record.dispatch.sessionIdentity);
            if (record.delegation)
                ref('compound-delegation', record.delegation.admissionId, record.delegation.childSessionIdentity, record.delegation.childStoreRoot);
        }
        for (const record of compound.providerAttempts ?? [])
            ref('compound-provider', record.id, record.dispatch.sessionIdentity);
        for (const record of compound.tombstones)
            ref('compound-tombstone', record.id, record.dispatch.sessionIdentity);
        if (compound.treeBudget) {
            ref('compound-tree-root', compound.treeBudget.rootSessionIdentity, compound.treeBudget.rootSessionIdentity);
            for (const record of compound.treeBudget.allocations)
                ref('compound-tree-allocation', record.id, record.dispatch.sessionIdentity);
        }
        for (const record of compound.managedTurns?.records ?? [])
            ref('compound-managed-turn', record.admissionId, record.childSessionId);
    }
    // Inspect the raw structures too: ordinary clone helpers intentionally retain
    // only their known fields and cannot establish capture completeness by themselves.
    if (parsed.skillExecution !== undefined) {
        capturedFields(parsed.skillExecution, ['invocations', 'updatedAt']);
        if (!Array.isArray(parsed.skillExecution.invocations))
            throw Error('captured_session_skill');
        capturedInteger(parsed.skillExecution.updatedAt);
        for (const record of parsed.skillExecution.invocations) {
            capturedFields(record, ['invocationId', 'sessionId', 'agentId', 'skillName', 'requested', 'strategy', 'strictMode', 'bundleHash', 'status', 'plan', 'evidence', 'createdAt', 'updatedAt'], ['compliance']);
            ref('skill-invocation', record.invocationId, record.sessionId);
        }
    }
    if (parsed.skillEval !== undefined) {
        capturedFields(parsed.skillEval, ['observations', 'feedback', 'promptedIntentIds', 'updatedAt']);
        if (!Array.isArray(parsed.skillEval.observations) || !Array.isArray(parsed.skillEval.feedback) || !Array.isArray(parsed.skillEval.promptedIntentIds))
            throw Error('captured_session_skill');
        capturedInteger(parsed.skillEval.updatedAt);
        parsed.skillEval.promptedIntentIds.forEach(capturedIdentity);
        for (const record of parsed.skillEval.observations) {
            capturedFields(record, ['observationId', 'sessionId', 'intentId', 'stageId', 'stepId', 'intentType', 'stageRole', 'deliverable', 'deliverableFamily', 'selectedSkillName', 'status', 'artifactRecorded', 'createdAt', 'updatedAt'], ['actualSkillName', 'structuralValidation', 'semanticValidation']);
            ref('skill-observation', record.observationId, record.sessionId);
            [record.intentId, record.stageId, record.stepId].forEach(capturedIdentity);
        }
        for (const record of parsed.skillEval.feedback) {
            capturedFields(record, ['feedbackId', 'sessionId', 'intentId', 'kind', 'sentiment', 'observationIds', 'createdAt'], ['note']);
            ref('skill-feedback', record.feedbackId, record.sessionId);
            capturedIdentity(record.intentId);
            if (!Array.isArray(record.observationIds))
                throw Error('captured_session_skill');
            record.observationIds.forEach(capturedIdentity);
        }
    }
    const typedReferences = [];
    if (parsed.promptSnapshotId !== undefined) {
        capturedIdentity(parsed.promptSnapshotId);
        typedReferences.push({ namespace: 'prompt-snapshot', identity: parsed.promptSnapshotId });
    }
    for (const [field, namespace] of [['memoryRefs', 'memory'], ['approvalRefs', 'approval'], ['backgroundJobRefs', 'background-job']]) {
        const values = parsed[field] ?? [];
        if (!Array.isArray(values))
            throw Error('captured_session_references');
        for (const identity of values) {
            capturedIdentity(identity);
            typedReferences.push({ namespace, identity });
        }
    }
    return freezeCapturedData({ kind: 'captured-source-declarations', containerSessionId: sessionId,
        sessionReferences, typedReferences, publicationDeclarations: { nativeContracts, candidates, verificationExecutions }, storedSessionIdentity, lineageReferences: Object.freeze([...lineage]),
        forkReference: snapshot.forkedFromSessionId ?? null,
        intentSubjects: Object.freeze([...subjects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)),
        observationReferences: Object.freeze(structuredClone(snapshot.protectedObservationClosure?.observations ?? [])), });
}
/** Original deletion body validator; raw-byte hash linkage is checked by its caller. */
export function parseSessionDeletionJournal(raw, sessionId) {
    const value = raw;
    if (!value || Object.keys(value).sort().join(',') !== 'closure,deletedAt,operationId,sessionId,snapshotHash,state,version'
        || value.version !== 1 || value.sessionId !== sessionId || !['pending', 'committed'].includes(value.state)
        || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId)
        || !Number.isSafeInteger(value.deletedAt) || value.deletedAt < 0 || typeof value.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotHash))
        throw new Error('session_delete_invalid_journal');
    let closure;
    try {
        closure = mergeProtectedObservationClosures(undefined, value.closure);
    }
    catch {
        throw new Error('session_delete_invalid_journal');
    }
    if (!closure)
        throw new Error('session_delete_invalid_journal');
    return { ...value, closure };
}
