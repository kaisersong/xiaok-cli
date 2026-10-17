import {deriveIntentParentBody} from './parent-candidate.js';
import {parseIntentBusinessProjection,assertIntentBusinessProjectionTransition,type IntentBusinessProjection} from './business-projection.js';
import {parseIntentReceiverAttempts,assertIntentReceiverRetained,applyIntentReceiverMutation,type IntentReceiverAttempt,type IntentReceiverMutation} from './receiver-publication-journal.js';
import {applyIntentVerificationMutation,type IntentVerificationMutation} from './verification-execution-journal.js';
import {parseMigrationMarker} from '../verification/migration-markers.js';
import { intentContractOriginalRegistration, intentOriginalRegistrationHash } from '../verification/intent-contract-enrollment.js';
import { parseActiveBusinessApplicationBinding, sameBusinessApplicationSubject } from '../verification/business-application-binding.js';
import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { applicationBindingReviewBytes, parseApplicationBindingReview } from '../verification/application-binding-review.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureIntentData } from './data.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { createIntentApplicationBinding, intentApplicationBindingHash, type IntentCandidateBody } from '../verification/intent-application-binding.js';
import { parseIntentNativeContracts, intentNativeLedgerHash } from './native-contract-journal.js';
import { assertSessionWriteOwnership } from './ownership.js';
import type { SessionIntentLedger } from './types.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
export interface IntentArtifactSelection {
    artifactId: string;
    obligationId: string;
    path: string;
}
export interface IntentFileObservation {
    artifactId: string;
    sha256: string;
    size: number;
    identity: string;
}
export interface IntentApplicationObservationFact {
    state: 'not_prepared' | 'not_approved' | 'pending' | 'reauthorization_required' | 'registration_changed' | 'committed';
    challengePhase: null | 'prepared' | 'authorizing' | 'approved' | 'committed' | 'failed' | 'retired' | 'not_approved';
    challengeId: string | null;
    reviewHash: string | null;
    registrationHash: string | null;
    deadline: null | {
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    };
    current: null | {
        bindingHash: string;
        revision: number;
    };
    pendingTransitionId: string | null;
}
export interface IntentApplicationAttempt {
    requestId: string;
    revision: number;
    phase: 'reserved' | 'preparing' | 'ready' | 'retired' | 'stale' | 'needs_reauthorization';
    route: string | null;
    observation: IntentApplicationObservationFact | null;
    retirementReason: null | 'not_prepared' | 'not_approved' | 'registration_changed' | 'source_changed';
    createdAt: number;
    updatedAt: number;
}
/** The same observation disposition is used by durable writes and historical parsing. */
function applicationDisposition(fact: IntentApplicationObservationFact | null, sourceChanged: boolean, bindingHash: string): Pick<IntentApplicationAttempt, 'phase' | 'retirementReason'> {
    if (sourceChanged) return { phase: 'stale', retirementReason: 'source_changed' };
    if (fact === null || fact.state === 'pending') return { phase: 'preparing', retirementReason: null };
    if (fact.state === 'not_prepared' || fact.state === 'not_approved' || fact.state === 'registration_changed')
        return { phase: 'retired', retirementReason: fact.state };
    if (fact.state === 'reauthorization_required') return { phase: 'needs_reauthorization', retirementReason: null };
    return { phase: fact.current?.bindingHash === bindingHash && fact.pendingTransitionId === null ? 'ready' : 'stale', retirementReason: null };
}
export interface IntentPublicationCandidate {
    version: 1;
    id: string;
    intentId: string;
    stageId: string | null;
    candidateRevision: number;
    contractHash: string;
    body: Readonly<IntentCandidateBody>;
    bodyHash: string;
    bindingHash: string;
    sourceHash: string;
    fileObservations: IntentFileObservation[];
    createdAt: number;
    applicationAttempts: IntentApplicationAttempt[];
    receiverAttempts?: IntentReceiverAttempt[];
    businessProjection?: IntentBusinessProjection;
}
export interface ReserveIntentPublicationInput {
    sessionId: string;
    instanceId: string;
    expectedLedgerHash: string;
    artifactSelections: IntentArtifactSelection[];
    fileObservations: IntentFileObservation[];
    requestSource: 'user';
    now: number;
}
export interface ClaimIntentPublicationInput {
    sessionId: string;
    instanceId: string;
    candidateId: string;
    expectedLedgerHash: string;
    expectedRequestId: string;
    expectedRevision: number;
    route: string;
    requestSource: 'user';
    now: number;
}
export interface ObserveIntentPublicationInput {
    sessionId: string;
    instanceId: string;
    candidateId: string;
    expectedLedgerHash: string;
    expectedRequestId: string;
    expectedRevision: number;
    observation: unknown;
    sourceChanged: boolean;
    requestSource: 'user' | 'scheduler';
    now: number;
}
export type RetryIntentPublicationInput = Omit<ClaimIntentPublicationInput, 'route'>;
export type ReserveIntentParentPublicationInput=Omit<ReserveIntentPublicationInput,'artifactSelections'>&{references:readonly import('../verification/intent-application-binding.js').IntentStagePublicationReference[]};
export type IntentPublicationMutation = (ReserveIntentParentPublicationInput&{publicationAction:'reserve-parent'}) | (ReserveIntentPublicationInput & {
    publicationAction: 'reserve';
}) | (ClaimIntentPublicationInput & {
    publicationAction: 'claim';
}) | (ObserveIntentPublicationInput & {
    publicationAction: 'observe';
}) | (RetryIntentPublicationInput & {
    publicationAction: 'retry';
}) | IntentVerificationMutation | IntentReceiverMutation;
const hash = (raw: unknown) => createHash('sha256').update(json(raw)).digest('hex');
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= 160 && !/[\x00-\x1f\x7f]/.test(v);
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function shape(v: unknown, keys: string): asserts v is Record<string, any> { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(' ').sort().join(','))
    throw Error('intent_candidate_shape'); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
} return v; }
function files(values: unknown): asserts values is IntentFileObservation[] { if (!Array.isArray(values))
    throw Error('intent_candidate_files'); const seen = new Set<string>(); for (const v of values) {
    shape(v, 'artifactId sha256 size identity');
    if (!id(v.artifactId) || seen.has(v.artifactId) || !digest(v.sha256) || !Number.isSafeInteger(v.size) || v.size < 0 || v.size > 16 * 1024 ** 2 || typeof v.identity !== 'string' || !v.identity || Buffer.byteLength(v.identity) > 4096)
        throw Error('intent_candidate_files');
    seen.add(v.artifactId);
} }
export function captureIntentPublicationRequest(raw: ReserveIntentPublicationInput & {
    lease: SessionExecutionLease;
}) {
    if (!raw || typeof raw !== 'object')
        throw Error('intent_candidate_input');
    const d = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)) || !d.lease)
        throw Error('intent_candidate_accessor');
    const { lease, ...rest } = d, data = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.value])), input = captureIntentData(data) as unknown as ReserveIntentPublicationInput;
    json(data);
    shape(input, 'sessionId instanceId expectedLedgerHash artifactSelections fileObservations requestSource now');
    if (!id(input.sessionId) || !id(input.instanceId) || !digest(input.expectedLedgerHash) || input.requestSource !== 'user' || !Number.isSafeInteger(input.now) || input.now < 0)
        throw Error('intent_candidate_input');
    if (!Array.isArray(input.artifactSelections))
        throw Error('intent_candidate_selection');
    const ids = new Set<string>();
    for (const v of input.artifactSelections) {
        shape(v, 'artifactId obligationId path');
        if (!id(v.artifactId) || !id(v.obligationId) || typeof v.path !== 'string' || ids.has(v.artifactId))
            throw Error('intent_candidate_selection');
        ids.add(v.artifactId);
    }
    files(input.fileObservations);
    return { input: { ...input, publicationAction: 'reserve' as const }, lease: lease.value as SessionExecutionLease };
}
export function captureIntentPublicationClaim(raw: ClaimIntentPublicationInput & {
    lease: SessionExecutionLease;
}) {
    if (!raw || typeof raw !== 'object')
        throw Error('intent_candidate_input');
    const d = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)) || !d.lease)
        throw Error('intent_candidate_accessor');
    const { lease, ...rest } = d, data = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.value])), input = captureIntentData(data) as unknown as ClaimIntentPublicationInput;
    json(data);
    shape(input, 'sessionId instanceId candidateId expectedLedgerHash expectedRequestId expectedRevision route requestSource now');
    if (!id(input.sessionId) || !id(input.instanceId) || !id(input.candidateId) || !id(input.expectedRequestId) || !digest(input.expectedLedgerHash) || input.requestSource !== 'user' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.now) || input.now < 0 || typeof input.route !== 'string' || Buffer.byteLength(input.route) > 4096 || json(JSON.parse(input.route)) !== input.route)
        throw Error('intent_candidate_input');
    return { input: { ...input, publicationAction: 'claim' as const }, lease: lease.value as SessionExecutionLease };
}
export function captureIntentPublicationObservation(raw: ObserveIntentPublicationInput & {
    lease: SessionExecutionLease;
}) {
    if (!raw || typeof raw !== 'object')
        throw Error('intent_candidate_input');
    const d = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)) || !d.lease)
        throw Error('intent_candidate_accessor');
    const { lease, ...rest } = d, data = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.value])), input = captureIntentData(data) as unknown as ObserveIntentPublicationInput;
    json(data);
    shape(input, 'sessionId instanceId candidateId expectedLedgerHash expectedRequestId expectedRevision observation sourceChanged requestSource now');
    if (!id(input.sessionId) || !id(input.instanceId) || !id(input.candidateId) || !id(input.expectedRequestId) || !digest(input.expectedLedgerHash) || !['user', 'scheduler'].includes(input.requestSource) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.now) || input.now < 0 || typeof input.sourceChanged !== 'boolean')
        throw Error('intent_candidate_input');
    return { input: { ...input, publicationAction: 'observe' as const }, lease: lease.value as SessionExecutionLease };
}
function observationFact(raw: unknown, ledger: SessionIntentLedger, row: IntentPublicationCandidate): IntentApplicationObservationFact {
    const v = captureIntentData(raw) as any, target = intentPublicationTarget(ledger, row);
    json(raw);
    if (v?.state === 'not_prepared') {
        shape(v, 'state');
        return { state: v.state, challengePhase: null, challengeId: null, reviewHash: null, registrationHash: null, deadline: null, current: null, pendingTransitionId: null };
    }
    shape(v, 'state challengePhase challenge' + (v?.state === 'not_approved' ? '' : ' observation'));
    const phases: Record<string, string[]> = { not_approved: ['failed', 'retired', 'not_approved'], pending: ['prepared', 'authorizing', 'approved'], reauthorization_required: ['approved'], registration_changed: ['approved'], committed: ['committed'] };
    if (!Object.hasOwn(phases, v.state) || !phases[v.state].includes(v.challengePhase))
        throw Error('intent_candidate_observation');
    shape(v.challenge, 'challengeId canonicalReview alreadyCommitted');
    const review = parseApplicationBindingReview(v.challenge.canonicalReview), route = JSON.parse(row.applicationAttempts.at(-1)!.route!);
    if (review.registrationHash !== intentOriginalRegistrationHash(intentContractOriginalRegistration({ subject: target.subject, contract: target.contract })) || v.challenge.challengeId !== review.challengeId || v.challenge.alreadyCommitted !== (v.challengePhase === 'committed') || review.authorityId !== route.authorityId || json(review.owner) !== json(route.owner) || json(review.binding) !== json(target))
        throw Error('intent_candidate_observation');
    let current: IntentApplicationObservationFact['current'] = null, pendingTransitionId: string | null = null;
    if (v.state !== 'not_approved') {
        const o = v.observation;
        shape(o, 'state current pendingTransitionId pendingTarget');
        if (!['active', 'pending', 'unbound'].includes(o.state))
            throw Error('intent_candidate_observation');
        const actual = o.current === null ? null : parseActiveBusinessApplicationBinding(o.current);
        if (actual && (!sameBusinessApplicationSubject(actual.binding, target) || actual.binding.kind !== 'intent' || json(actual.binding.contract) !== json(target.contract)))
            throw Error('intent_candidate_observation');
        if (actual)
            current = { bindingHash: actual.bindingHash, revision: actual.revision };
        if (o.state === 'pending') {
            if (!id(o.pendingTransitionId) || !o.pendingTarget)
                throw Error('intent_candidate_observation');
            const pending = createIntentApplicationBinding((({ contractHash, candidatePayloadHash, ...rest }: any) => rest)(o.pendingTarget));
            if (json(pending) !== json(o.pendingTarget) || !sameBusinessApplicationSubject(pending, target) || json(pending.contract) !== json(target.contract))
                throw Error('intent_candidate_observation');
            pendingTransitionId = o.pendingTransitionId;
        }
        else if (o.pendingTransitionId !== null || o.pendingTarget !== null || (o.state === 'active') !== (actual !== null))
            throw Error('intent_candidate_observation');
    }
    return { state: v.state, challengePhase: v.challengePhase, challengeId: review.challengeId, reviewHash: hash(review), registrationHash: review.registrationHash, deadline: review.deadline, current, pendingTransitionId };
}
export function captureIntentPublicationRetry(raw: RetryIntentPublicationInput & {
    lease: SessionExecutionLease;
}) {
    if (!raw || typeof raw !== 'object')
        throw Error('intent_candidate_input');
    const d = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)) || !d.lease)
        throw Error('intent_candidate_accessor');
    const { lease, ...rest } = d, data = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.value])), input = captureIntentData(data) as unknown as RetryIntentPublicationInput;
    json(data);
    shape(input, 'sessionId instanceId candidateId expectedLedgerHash expectedRequestId expectedRevision requestSource now');
    if (!id(input.sessionId) || !id(input.instanceId) || !id(input.candidateId) || !id(input.expectedRequestId) || !digest(input.expectedLedgerHash) || input.requestSource !== 'user' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.now) || input.now < 0)
        throw Error('intent_candidate_input');
    return { input: { ...input, publicationAction: 'retry' as const }, lease: lease.value as SessionExecutionLease };
}
export interface IntentPublicationTargetData {readonly sessionId:string;readonly nativeContracts?:unknown}
export interface IntentPublicationTargetRowData {
    readonly id: unknown; readonly intentId: string; readonly stageId: unknown;
    readonly candidateRevision: unknown; readonly contractHash: unknown; readonly body: unknown;
}
export function intentPublicationTarget(ledger: SessionIntentLedger, row: IntentPublicationCandidate): ReturnType<typeof createIntentApplicationBinding>;
export function intentPublicationTarget(ledger: IntentPublicationTargetData, row: IntentPublicationTargetRowData): ReturnType<typeof createIntentApplicationBinding>;
export function intentPublicationTarget(ledger: IntentPublicationTargetData, row: IntentPublicationTargetRowData) {
    const native = parseIntentNativeContracts(ledger.nativeContracts, ledger.sessionId).find(n => n.intentId === row.intentId);
    if (!native || native.contractHash !== row.contractHash)
        throw Error('intent_candidate_contract');
    return createIntentApplicationBinding({ version: 1, kind: 'intent', subject: { version: 1, sessionId: ledger.sessionId, intentId: row.intentId, stageId: row.stageId }, candidateId: row.id, candidateRevision: row.candidateRevision, contract: native.contract, body: row.body });
}
function parseOriginalApplicationRoute(text:string,target:ReturnType<typeof intentPublicationTarget>):void {
    const route=JSON.parse(text);if(json(route)!==text)throw Error('intent_candidate_route');
    shape(route,route?.kind==='migrated'?'kind authorityId owner marker':'kind authorityId owner');
    shape(route.owner,'profileId ownerKind ownerId');const expected=intentHostSubjectOwner(target.subject);
    if(!['migrated','protected-unregistered'].includes(route.kind)||!id(route.authorityId)||!id(route.owner.profileId)||route.owner.ownerKind!==expected.ownerKind||route.owner.ownerId!==expected.ownerId)throw Error('intent_candidate_route');
    if(route.kind==='migrated'){const marker=parseMigrationMarker(route.marker);if(marker.state!=='migrated'||marker.authorityId!==route.authorityId||json({profileId:marker.profileId,ownerKind:marker.ownerKind,ownerId:marker.ownerId})!==json(route.owner))throw Error('intent_candidate_route');}
}
/** Read-only stored DATA. This is neither a Modern ledger nor an execution port. */
export interface IntentPublicationRecordFactsData {
    readonly intentId: string;
    readonly stages?: unknown;
    readonly overallStatus?: unknown;
    readonly producerReports?: unknown;
    readonly executionTerminals?: unknown;
    readonly artifacts?: unknown;
}
export interface IntentPublicationReaderLedgerData {
    readonly sessionId: string;
    readonly nativeContracts?: unknown;
    readonly publicationCandidates?: unknown;
    readonly intents: readonly IntentPublicationRecordFactsData[];
}
/** Prefix fields are validated with the original candidate/binding/attempt parsers.
 * Source projections and receiver history remain unknown until their real parser runs. */
export type IntentPublicationRowFactsData = Omit<IntentPublicationCandidate, 'receiverAttempts' | 'businessProjection'> & {
    readonly receiverAttempts?: unknown;
    readonly businessProjection?: unknown;
};
export function intentPublicationFactObject(value: unknown, code: string): Record<string, unknown> {
    if (!isIntentPublicationFactObject(value)) throw Error(code);
    return value;
}
function isIntentPublicationFactObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function intentPublicationFactArray(value: unknown, code: string): readonly unknown[] {
    if (!Array.isArray(value)) throw Error(code);
    return value;
}
function readIntentPublicationRowCore(
    ledger: IntentPublicationReaderLedgerData, input: unknown,
    ids: Set<string>, subjects: Set<string>, requests: Set<string>, checkParentSource: boolean,
): IntentPublicationRowFactsData {
    // Explicit DATA error replaces the original Object.hasOwn null/primitive error.
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('intent_candidate_shape');
    const rowInput = input;
    shape(rowInput, 'version id intentId stageId candidateRevision contractHash body bodyHash bindingHash sourceHash fileObservations createdAt applicationAttempts'+(Object.hasOwn(rowInput,'receiverAttempts')?' receiverAttempts':'')+(Object.hasOwn(rowInput,'businessProjection')?' businessProjection':''));
    const row = rowInput;
        if (row.version !== 1 || !id(row.id) || !id(row.intentId) || (row.stageId!==null&&!id(row.stageId)) || ids.has(row.id) || subjects.has(json([row.intentId, row.stageId])) || row.candidateRevision !== 1 || ![row.contractHash, row.bodyHash, row.bindingHash, row.sourceHash].every(digest) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0)
            throw Error('intent_candidate_journal');
        ids.add(row.id);
        subjects.add(json([row.intentId, row.stageId]));
        files(row.fileObservations);
        const target = intentPublicationTarget(ledger, {
            id: row.id, intentId: row.intentId, stageId: row.stageId,
            candidateRevision: row.candidateRevision, contractHash: row.contractHash, body: row.body,
        });
        if(checkParentSource&&row.stageId===null&&(row.body.kind!=='intent-parent'||json(deriveIntentParentBody(ledger,row.intentId,row.body.stages))!==json(row.body)))throw Error('intent_parent_source');
        if (hash(row.body) !== row.bodyHash || intentApplicationBindingHash(target) !== row.bindingHash || row.sourceHash !== hash({ contract: target.contract, body: target.body, fileObservations: row.fileObservations }))
            throw Error('intent_candidate_hash');
        if (!Array.isArray(row.applicationAttempts) || row.applicationAttempts.length < 1 || row.applicationAttempts.length > 32)
            throw Error('intent_candidate_attempts');
        for (let attemptIndex=0;attemptIndex<row.applicationAttempts.length;attemptIndex++) {
            const a=row.applicationAttempts[attemptIndex],previousAttempt=row.applicationAttempts[attemptIndex-1];
            if(previousAttempt&&(previousAttempt.phase!=='retired'||!['not_prepared','not_approved'].includes(previousAttempt.retirementReason!)||a.createdAt<previousAttempt.updatedAt||a.route!==null&&a.route!==previousAttempt.route))throw Error('intent_candidate_attempt_sequence');
            if(attemptIndex===0&&a.createdAt!==row.createdAt||a.phase==='reserved'&&a.updatedAt!==a.createdAt||!['reserved','preparing'].includes(a.phase)&&a.revision<3||a.phase==='preparing'&&(a.revision===2?a.observation!==null:a.observation?.state!=='pending'))throw Error('intent_candidate_attempt_revision');
            shape(a, 'requestId revision phase route observation retirementReason createdAt updatedAt');
            if (!id(a.requestId) || requests.has(a.requestId) || !Number.isSafeInteger(a.revision) || a.revision < 1 || !['reserved', 'preparing', 'ready', 'retired', 'stale', 'needs_reauthorization'].includes(a.phase) || (a.phase === 'reserved' ? (a.route !== null || a.revision !== 1 || a.observation !== null) : (typeof a.route !== 'string' || json(JSON.parse(a.route)) !== a.route || a.revision < 2)) || !Number.isSafeInteger(a.createdAt) || a.createdAt < row.createdAt || !Number.isSafeInteger(a.updatedAt) || a.updatedAt < a.createdAt || ![null, 'not_prepared', 'not_approved', 'registration_changed', 'source_changed'].includes(a.retirementReason))
                throw Error('intent_candidate_attempt');
            if (a.observation !== null) {
                const f = a.observation;
                shape(f, 'state challengePhase challengeId reviewHash registrationHash deadline current pendingTransitionId');
                if (!['not_prepared', 'not_approved', 'pending', 'reauthorization_required', 'registration_changed', 'committed'].includes(f.state) || ![null, 'prepared', 'authorizing', 'approved', 'committed', 'failed', 'retired', 'not_approved'].includes(f.challengePhase) || f.challengeId !== null && !id(f.challengeId) || f.reviewHash !== null && !digest(f.reviewHash) || f.registrationHash !== null && !digest(f.registrationHash))
                    throw Error('intent_candidate_observation');
                if (f.current !== null) {
                    shape(f.current, 'bindingHash revision');
                    if (!digest(f.current.bindingHash) || !Number.isSafeInteger(f.current.revision) || f.current.revision < 1)
                        throw Error('intent_candidate_observation');
                }
                if (f.pendingTransitionId !== null && !id(f.pendingTransitionId))
                    throw Error('intent_candidate_observation');
                if (f.state === 'not_prepared') {
                    if ([f.challengePhase, f.challengeId, f.reviewHash, f.registrationHash, f.deadline, f.current, f.pendingTransitionId].some(v => v !== null))
                        throw Error('intent_candidate_observation');
                }
                else {
                    if (!id(f.challengeId) || !digest(f.reviewHash) || f.registrationHash!==intentOriginalRegistrationHash(intentContractOriginalRegistration({subject:target.subject,contract:target.contract})))
                        throw Error('intent_candidate_observation');
                    shape(f.deadline, 'domainId qualificationEpoch notBefore validUntil');
                    const d = f.deadline;
                    if (!id(d.domainId) || ![d.qualificationEpoch, d.notBefore, d.validUntil].every(v => Number.isSafeInteger(v) && v >= 0) || d.validUntil <= d.notBefore || d.validUntil - d.notBefore > 300000)
                        throw Error('intent_candidate_observation');
                    const phases: Record<string, unknown[]> = { not_approved: ['failed', 'retired', 'not_approved'], pending: ['prepared', 'authorizing', 'approved'], reauthorization_required: ['approved'], registration_changed: ['approved'], committed: ['committed'] };
                    if (!phases[f.state]?.includes(f.challengePhase) || f.state === 'not_approved' && (f.current !== null || f.pendingTransitionId !== null))
                        throw Error('intent_candidate_observation');
                }
            }
            if (a.phase === 'reserved') {
                if (a.retirementReason !== null) throw Error('intent_candidate_observation');
            } else {
                const disposition = applicationDisposition(a.observation, a.retirementReason === 'source_changed', row.bindingHash);
                if (a.phase !== disposition.phase || a.retirementReason !== disposition.retirementReason)
                    throw Error('intent_candidate_observation');
            }
            if(a.route!==null)parseOriginalApplicationRoute(a.route,target);
            requests.add(a.requestId);
        }
    // A selected typed view must not silently replace a nonidentical raw body.
    // This is an explicit NEW rejection policy, not an equality assertion/cast.
    if (json(target.body) !== json(row.body)) throw Error('intent_candidate_body_data');
    return {
        version: 1, id: row.id, intentId: row.intentId, stageId: row.stageId,
        candidateRevision: 1, contractHash: row.contractHash, body: target.body,
        bodyHash: row.bodyHash, bindingHash: row.bindingHash, sourceHash: row.sourceHash,
        fileObservations: row.fileObservations, createdAt: row.createdAt,
        applicationAttempts: row.applicationAttempts,
        ...(Object.hasOwn(row, 'receiverAttempts') ? { receiverAttempts: row.receiverAttempts } : {}),
        ...(Object.hasOwn(row, 'businessProjection') ? { businessProjection: row.businessProjection } : {}),
    };
}
/** Selects one original row, never replaces the ledger, history or hash input.
 * This validates the existing row prefix, not full projection/receiver source or authority. */
export function readIntentPublicationRowFacts(
    ledger: IntentPublicationReaderLedgerData, intentId: string, stageId: unknown,
): IntentPublicationRowFactsData | undefined {
    if (ledger.publicationCandidates === undefined) return undefined;
    const rows = intentPublicationFactArray(ledger.publicationCandidates, 'intent_candidate_journal');
    const selected = rows.find(value => {
        const row = intentPublicationFactObject(value, 'intent_candidate_shape');
        return row.intentId === intentId && row.stageId === stageId;
    });
    if (selected === undefined) return undefined;
    return readIntentPublicationRowCore(ledger, captureIntentData(selected), new Set(), new Set(), new Set(), false);
}
export function parseIntentPublicationCandidates(ledger: SessionIntentLedger | undefined): IntentPublicationCandidate[];
export function parseIntentPublicationCandidates(ledger: IntentPublicationReaderLedgerData | undefined): IntentPublicationCandidate[];
export function parseIntentPublicationCandidates(ledger: IntentPublicationReaderLedgerData | undefined): IntentPublicationCandidate[] {
    if (!ledger || ledger.publicationCandidates === undefined) return [];
    const raw = captureIntentData(ledger.publicationCandidates);
    if (!Array.isArray(raw)) throw Error('intent_candidate_journal');
    const ids = new Set<string>(), subjects = new Set<string>(), requests = new Set<string>();
    for (const row of raw) {
        const facts = readIntentPublicationRowCore(ledger, row, ids, subjects, requests, true);
        parseIntentBusinessProjection(row.businessProjection, facts, ledger);
        for (const attempt of parseIntentReceiverAttempts(row.receiverAttempts, facts)) {
            if (requests.has(attempt.requestId)) throw Error('intent_receiver_identity');
            requests.add(attempt.requestId);
        }
    }
    return freeze(raw);
}
/** Capture source data only; actual native/verification remains in the fixed host. */
export function applyIntentPublicationMutation(previous: PersistedSessionSnapshot, input: IntentPublicationMutation): PersistedSessionSnapshot {
    if (input.publicationAction === 'receiver') return applyIntentReceiverMutation(previous,input);
    if (input.publicationAction === 'verification') return applyIntentVerificationMutation(previous,input);
    return applyIntentPublicationCapture(previous, input);
}

/** Snapshot fields consumed by the existing capture branches; not a full durable snapshot. */
export type IntentPublicationCaptureSnapshot = Pick<PersistedSessionSnapshot, 'sessionId' | 'intentDelegation' | 'updatedAt'>;
export type IntentPublicationCaptureMutation = Exclude<IntentPublicationMutation, IntentReceiverMutation | IntentVerificationMutation>;

/** Plain DATA capture only. Existing owner/hash/journal/route checks remain in the body. */
export function applyIntentPublicationCapture(previous: PersistedSessionSnapshot, input: IntentPublicationCaptureMutation): PersistedSessionSnapshot;
export function applyIntentPublicationCapture(previous: IntentPublicationCaptureSnapshot, input: IntentPublicationCaptureMutation): IntentPublicationCaptureSnapshot;
export function applyIntentPublicationCapture(previous: IntentPublicationCaptureSnapshot, input: IntentPublicationCaptureMutation): IntentPublicationCaptureSnapshot {
    const next = captureIntentData(previous), ledger = next.intentDelegation;
    if (!ledger || next.sessionId !== input.sessionId)
        throw Error('intent_candidate_session');
    assertSessionWriteOwnership(ledger, input.instanceId, 'capture intent application candidate');
    if (intentNativeLedgerHash(ledger) !== input.expectedLedgerHash)
        throw Error('intent_candidate_stale');
    const rows = parseIntentPublicationCandidates(ledger), record = ledger.intents.find(r => r.intentId === ledger.activeIntentId), stage = record?.stages.find(s => s.stageId === record.activeStageId), native = parseIntentNativeContracts(ledger.nativeContracts, input.sessionId).find(n => n.intentId === record?.intentId);
    if (input.publicationAction === 'observe') {
        const index = rows.findIndex(r => r.id === input.candidateId), row = rows[index], attempt = row?.applicationAttempts.at(-1);
        if (!row || !attempt || attempt.phase !== 'preparing' || attempt.requestId !== input.expectedRequestId || attempt.revision !== input.expectedRevision || input.now < attempt.updatedAt)
            throw Error('intent_candidate_stale');
        const fact = input.observation === null && input.sourceChanged ? null : observationFact(input.observation, ledger, row), changed = captureIntentData(row), active = record?.intentId === row.intentId && record.overallStatus === 'publication_pending' && (row.stageId===null?record.stages.every(s=>s.status==='completed'):stage?.stageId===row.stageId&&stage.status==='publication_pending');
        const routeChanged = intentPublicationRouteVector(ledger, row.id) !== attempt.route;
        const disposition = applicationDisposition(fact, input.sourceChanged || !active || routeChanged, row.bindingHash);
        changed.applicationAttempts[changed.applicationAttempts.length - 1] = { ...attempt, revision: attempt.revision + 1, ...disposition, observation: fact, updatedAt: input.now };
        ledger.publicationCandidates = rows.map((r, i) => i === index ? changed : r);
        ledger.updatedAt = Math.max(ledger.updatedAt, input.now);
        next.updatedAt = Math.max(next.updatedAt, input.now);
        return next;
    }
    const parentAction=input.publicationAction==='reserve-parent'||('candidateId'in input&&rows.find(r=>r.id===input.candidateId)?.stageId===null);
    if (!record || !stage || !native || record.overallStatus !== 'publication_pending' || (parentAction?record.stages.some(s=>s.status!=='completed'):stage.status !== 'publication_pending') || native.subjects.some(s => s.attempts.at(-1)?.phase !== 'enrolled') || input.now < ledger.updatedAt)
        throw Error('intent_candidate_current');
    if (input.publicationAction === 'claim' || input.publicationAction === 'retry') {
        const index = rows.findIndex(r => r.id === input.candidateId), original = rows[index];
        if (!original || original.intentId !== record.intentId || original.stageId !== (parentAction?null:stage.stageId))
            throw Error('intent_candidate_missing');
        const attempt = original.applicationAttempts.at(-1)!;
        if ((input.publicationAction === 'claim' ? attempt.phase !== 'reserved' : attempt.phase !== 'retired' || !['not_prepared', 'not_approved'].includes(attempt.retirementReason!) || rows[index].applicationAttempts.length >= 32) || attempt.requestId !== input.expectedRequestId || attempt.revision !== input.expectedRevision)
            throw Error('intent_candidate_stale');
        const route = readInstalledCurrentOwner(intentHostSubjectOwner({ version: 1, sessionId: input.sessionId, intentId: record.intentId, stageId: original.stageId }));
        if (!['migrated', 'protected-unregistered'].includes(route.kind) || json(route) !== (input.publicationAction === 'claim' ? input.route : attempt.route))
            throw Error('intent_candidate_route');
        const fresh = applyIntentPublicationCapture(previous, { sessionId: input.sessionId, instanceId: input.instanceId, expectedLedgerHash: input.expectedLedgerHash, requestSource: 'user', now: input.now, fileObservations: original.fileObservations,...(original.body.kind==='intent-parent'?{publicationAction:'reserve-parent',references:original.body.stages}:{publicationAction:'reserve',artifactSelections:original.body.artifacts.map(a=>({artifactId:a.artifactId,obligationId:a.selection.obligationId,path:a.selection.path}))}) });
        const changed = captureIntentData(original);
        if (input.publicationAction === 'retry')
            changed.applicationAttempts.push({ requestId: randomUUID(), revision: 1, phase: 'reserved', route: null, observation: null, retirementReason: null, createdAt: input.now, updatedAt: input.now });
        else
            changed.applicationAttempts[changed.applicationAttempts.length - 1] = { ...attempt, phase: 'preparing', revision: 2, route: input.route, updatedAt: input.now };
        fresh.intentDelegation!.publicationCandidates = rows.map((r, i) => i === index ? changed : r);
        fresh.intentDelegation!.updatedAt = input.now;
        fresh.updatedAt = Math.max(fresh.updatedAt, input.now);
        return fresh;
    }
    if(input.publicationAction==='reserve-parent'){
        if(input.requestSource!=='user')throw Error('intent_candidate_input');files(input.fileObservations);
        const body=deriveIntentParentBody(ledger,record.intentId,input.references),children=native.contract.stages.map(s=>rows.find(r=>r.intentId===record.intentId&&r.stageId===s.stageId)!);
        if(json(input.fileObservations)!==json(children.flatMap(c=>c.fileObservations)))throw Error('intent_parent_files');
        for(const child of children)if(json(readInstalledCurrentOwner(intentHostSubjectOwner({version:1,sessionId:input.sessionId,intentId:record.intentId,stageId:child.stageId})))!==child.applicationAttempts.at(-1)?.route)throw Error('intent_candidate_route');
        const prior=rows.find(r=>r.intentId===record.intentId&&r.stageId===null),candidateId=prior?.id??randomUUID();
        const binding=createIntentApplicationBinding({version:1,kind:'intent',subject:{version:1,sessionId:input.sessionId,intentId:record.intentId,stageId:null},candidateId,candidateRevision:1,contract:native.contract,body});
        const sourceHash=hash({contract:native.contract,body:binding.body,fileObservations:input.fileObservations});
        if(prior){if(prior.sourceHash!==sourceHash||prior.bindingHash!==intentApplicationBindingHash(binding))throw Error('intent_candidate_conflict');return next;}
        const row:IntentPublicationCandidate={version:1,id:candidateId,intentId:record.intentId,stageId:null,candidateRevision:1,contractHash:native.contractHash,body:binding.body,bodyHash:hash(binding.body),bindingHash:intentApplicationBindingHash(binding),sourceHash,fileObservations:input.fileObservations,createdAt:input.now,applicationAttempts:[{requestId:randomUUID(),revision:1,phase:'reserved',route:null,observation:null,retirementReason:null,createdAt:input.now,updatedAt:input.now}]};
        ledger.publicationCandidates=[...rows,row];ledger.updatedAt=input.now;next.updatedAt=Math.max(next.updatedAt,input.now);parseIntentPublicationCandidates(ledger);return next;
    }
    const originals = (record.artifacts ?? []).filter(a => a.stageId === stage.stageId);
    if (originals.length !== input.artifactSelections.length || input.fileObservations.length !== originals.filter(a => a.storage === 'file_ref').length)
        throw Error('intent_candidate_selection');
    const reports = (record.producerReports ?? []).filter(r => { const a = r.action; return a.kind === 'artifact-report' ? a.stageId === stage.stageId : stage.steps.some(s => s.stepId === a.stepId); });
    const artifacts = originals.map(a => { const selection = input.artifactSelections.find(s => s.artifactId === a.artifactId); if (!selection)
        throw Error('intent_candidate_selection'); const obligation = native.contract.stages.find(s => s.stageId === stage.stageId)!.verification.obligations.find(o => o.obligationId === selection.obligationId), recipe = obligation?.recipe, paths = recipe?.kind === 'artifact-content' ? recipe.checks.map(c => c.path) : recipe?.kind === 'blackbox' ? ['verification-report.json'] : recipe?.kind === 'diagnostic-coverage' ? ('sources' in recipe ? recipe.sources : [recipe]).map(s => s.diagnosisPath) : []; if (!paths.includes(selection.path))
        throw Error('intent_candidate_selection'); const file = input.fileObservations.find(f => f.artifactId === a.artifactId), bytes = a.storage === 'inline' ? Buffer.from(a.inlineValue ?? '', 'utf8') : null; if (a.storage === 'file_ref' && !file)
        throw Error('intent_candidate_files'); return { artifactId: a.artifactId, stageId: a.stageId, kind: a.kind, label: a.label, summary: a.summary ?? null, createdAt: a.createdAt, content: a.storage === 'inline' ? { kind: 'inline', text: a.inlineValue ?? '' } : { kind: 'file', originalPath: a.path }, selection: { kind: 'local', obligationId: selection.obligationId, path: selection.path }, sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : file!.sha256, size: bytes ? bytes.length : file!.size }; });
    const prior = rows.find(r => r.intentId === record.intentId && r.stageId === stage.stageId), candidateId = prior?.id ?? randomUUID(), body = { kind: 'intent-stage', stageId: stage.stageId, summary: [...reports].reverse().find(r => r.action.kind === 'step-report')?.action as any, executionReports: (record.executionTerminals ?? []).filter(t => t.kind === 'step' && stage.steps.some(s => s.stepId === t.identity)), producerReports: reports, artifacts };
    body.summary = body.summary?.breadcrumb ?? stage.deliverable;
    const binding = createIntentApplicationBinding({ version: 1, kind: 'intent', subject: { version: 1, sessionId: input.sessionId, intentId: record.intentId, stageId: stage.stageId }, candidateId, candidateRevision: 1, contract: native.contract, body });
    // Full ASCII binding plus worst legal review metadata overhead, without truncation.
    const maxId = '\u0080'.repeat(80), max = Number.MAX_SAFE_INTEGER;
    // U+0080 occupies two UTF-8 bytes and six native ASCII bytes: the largest
    // allowed identifier expansion. This synthetic envelope is size-only data.
    applicationBindingReviewBytes({ version: 1, purpose: 'completion-application-binding', authorityId: maxId, challengeId: maxId, principal: { uid: 0xfffffffe, auditSessionId: 0xfffffffe, accountGeneration: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF' }, requestSource: 'user', owner: { profileId: maxId, ...intentHostSubjectOwner(binding.subject) }, registrationHash: 'f'.repeat(64), previousBindingHash: 'f'.repeat(64), binding, bindingHash: intentApplicationBindingHash(binding), deadline: { domainId: maxId, qualificationEpoch: max, notBefore: max - 1, validUntil: max } });
    const sourceHash = hash({ contract: native.contract, body: binding.body, fileObservations: input.fileObservations });
    if (prior) {
        if (prior.sourceHash !== sourceHash || prior.bindingHash !== intentApplicationBindingHash(binding))
            throw Error('intent_candidate_conflict');
        return next;
    }
    const row: IntentPublicationCandidate = { version: 1, id: candidateId, intentId: record.intentId, stageId: stage.stageId, candidateRevision: 1, contractHash: native.contractHash, body: binding.body, bodyHash: hash(binding.body), bindingHash: intentApplicationBindingHash(binding), sourceHash, fileObservations: input.fileObservations, createdAt: input.now, applicationAttempts: [{ requestId: randomUUID(), revision: 1, phase: 'reserved', route: null, observation: null, retirementReason: null, createdAt: input.now, updatedAt: input.now }] };
    ledger.publicationCandidates = [...rows, row];
    ledger.updatedAt = input.now;
    next.updatedAt = Math.max(next.updatedAt, input.now);
    parseIntentPublicationCandidates(ledger);
    return next;
}
export function assertIntentPublicationRetained(previous: SessionIntentLedger | undefined, next: SessionIntentLedger | undefined, primitive: boolean|'receiver'|'projection' = false): void {
    const before = parseIntentPublicationCandidates(previous), after = parseIntentPublicationCandidates(next);
    if(primitive==='projection'){assertIntentBusinessProjectionTransition(previous,next);return;}
    if (!primitive) {
        if (!isDeepStrictEqual(before, after))
            throw Error('intent_candidate_requires_primitive');
        return;
    }
    const stripped = (v: SessionIntentLedger | undefined) => { const value = captureIntentData(v ?? null) as any; if (value) {
        delete value.publicationCandidates;
        delete value.updatedAt;
    } return value; };
    if(primitive==='receiver'){if(!isDeepStrictEqual(stripped(previous),stripped(next))||before.length!==after.length||before.filter((r,i)=>!isDeepStrictEqual(r,after[i])).length>1)throw Error('intent_receiver_original');before.forEach((r,i)=>assertIntentReceiverRetained(r,after[i]));return;}
    if (!isDeepStrictEqual(stripped(previous), stripped(next)) || before.some((row, i) => {
        const next = after[i];
        if (!next)
            return true;
        const { applicationAttempts: a, ...original } = row, { applicationAttempts: b, ...changed } = next;
        if (!isDeepStrictEqual(original, changed))
            return true;
        if (isDeepStrictEqual(a, b))
            return false;
        const last = a.at(-1)!, tail = b.at(-1)!;
        if (b.length === a.length + 1)
            return !a.every((v, j) => isDeepStrictEqual(v, b[j])) || last.phase !== 'retired' || !['not_prepared', 'not_approved'].includes(last.retirementReason!) || tail.phase !== 'reserved';
        return b.length !== a.length || a.slice(0, -1).some((v, j) => !isDeepStrictEqual(v, b[j])) || last.requestId !== tail.requestId || last.createdAt !== tail.createdAt || last.revision + 1 !== tail.revision || !((last.phase === 'reserved' && tail.phase === 'preparing') || (last.phase === 'preparing' && tail.phase !== 'reserved'));
    }) || after.length > before.length + 1)
        throw Error('intent_candidate_original_changed');
}
export function intentPublicationRouteVector(ledger: SessionIntentLedger | undefined, candidateId?: string): string {
    const candidate = candidateId === undefined ? undefined : parseIntentPublicationCandidates(ledger!).find(row => row.id === candidateId);
    const record = ledger?.intents.find(r => r.intentId === (candidate?.intentId ?? ledger.activeIntentId));
    if (!ledger || !record || candidateId !== undefined && !candidate)
        throw Error('intent_candidate_current');
    const route = readInstalledCurrentOwner(intentHostSubjectOwner({ version: 1, sessionId: ledger.sessionId, intentId: record.intentId, stageId: candidate?candidate.stageId:record.activeStageId }));
    if (candidateId === undefined && !['migrated', 'protected-unregistered'].includes(route.kind))
        throw Error('intent_candidate_route');
    return json(route);
}
export function assertIntentPublicationRoute(ledger: SessionIntentLedger | undefined, original: string, candidateId?: string|null): void { if (intentPublicationMutationRouteVector(ledger, candidateId) !== original)
    throw Error('intent_candidate_route'); }

/** Fixed local mutation fence, distinct from the stored single application route. */
export function intentPublicationMutationCandidateId(ledger:SessionIntentLedger|undefined,input:IntentPublicationMutation):string|null|undefined{
 if(input.publicationAction==='reserve-parent')return null;
 if('candidateId'in input)return input.candidateId;
 if(input.publicationAction==='verification'&&'id'in input)return ledger?.verificationExecutions?.find(r=>r.id===input.id)?.candidateId;
 return undefined;
}
export function intentPublicationMutationRouteVector(ledger:SessionIntentLedger|undefined,candidateId?:string|null):string{
 const candidate=candidateId?ledger?.publicationCandidates?.find(c=>c.id===candidateId):undefined;
 if(candidateId!==null&&candidate?.stageId!==null)return intentPublicationRouteVector(ledger,candidateId);
 if(!ledger)throw Error('intent_candidate_current');const intentId=candidate?.intentId??ledger.activeIntentId,record=ledger.intents.find(r=>r.intentId===intentId);if(!record)throw Error('intent_candidate_current');
 const root=readInstalledCurrentOwner(intentHostSubjectOwner({version:1,sessionId:ledger.sessionId,intentId:record.intentId,stageId:null}));if(!['migrated','protected-unregistered'].includes(root.kind))throw Error('intent_candidate_route');
 const children=record.stages.map(s=>{const child=ledger.publicationCandidates?.find(c=>c.intentId===record.intentId&&c.stageId===s.stageId),route=readInstalledCurrentOwner(intentHostSubjectOwner({version:1,sessionId:ledger.sessionId,intentId:record.intentId,stageId:s.stageId}));if(!child)throw Error('intent_candidate_route');return route;});
 return json({root,children});
}
