import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createInstalledVerificationClient } from '../verification/controller-client.js';
import { createOwnerEnrollmentClient } from '../verification/completion-client.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { intentContractOriginalRegistration, intentOriginalRegistrationHash } from '../verification/intent-contract-enrollment.js';
import { captureIntentData } from './intent-commit-boundary.js';
import { intentNativeLedgerHash, parseIntentNativeContracts } from './native-contract-journal.js';
import { assertSessionWriteOwnership } from './ownership.js';
const validId = (value) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 160 && !/[\x00-\x1f\x7f]/.test(value);
/** Actual product host only. Its journal records facts; it never grants execution. */
export function createIntentNativeContractHost(options) {
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !('value' in d)) || Object.keys(descriptors).some(k => !['store', 'authority', 'sessionId', 'instanceId', 'assertAdmission', 'now'].includes(k)))
        throw Error('intent_native_host_options');
    const { sessionId, instanceId } = options, admission = options.assertAdmission, now = options.now ?? Date.now;
    if (typeof admission !== 'function' || typeof now !== 'function')
        throw Error('intent_native_host_options');
    if (!validId(sessionId) || !validId(instanceId))
        throw Error('intent_native_host_identity');
    const checkLease = options.store.assertIntentNativeLease?.bind(options.store);
    const read = options.store.getIntentNativeLedgerSync?.bind(options.store), reserve = options.store.reserveIntentNativeContract?.bind(options.store), advance = options.store.advanceIntentNativeContractSubject?.bind(options.store), retry = options.store.retryIntentNativeContractSubject?.bind(options.store), acquire = options.authority.acquire.bind(options.authority);
    if (!read || !reserve || !advance || !retry || !checkLease)
        throw Error('intent_native_host_store');
    const assertLease = checkLease;
    const load = read, reserveRecord = reserve, advanceRecord = advance, retryRecord = retry, lifetime = new AbortController();
    let claiming = false;
    let closed = false, active, checking = false;
    const closeReason = Error('intent_native_host_closed');
    let closeDrain;
    const writerFailures = new Set();
    function admit(signal) {
        if (closed)
            throw closeReason;
        signal?.throwIfAborted();
        if (checking)
            throw Error('intent_native_admission_reentrant');
        checking = true;
        try {
            const result = admission();
            if (result !== undefined) {
                void Promise.resolve(result).catch(() => { });
                throw Error('intent_native_admission_sync');
            }
        }
        finally {
            checking = false;
        }
        if (closed)
            throw closeReason;
        signal?.throwIfAborted();
    }
    function time() { const value = now(); if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        if (value && typeof value === 'object')
            void Promise.resolve(value).catch(() => { });
        throw Error('intent_native_host_time');
    } return value; }
    function get(intentId) { if (!validId(intentId))
        throw Error('intent_native_host_identity'); const row = parseIntentNativeContracts(load(sessionId)?.nativeContracts, sessionId).find(r => r.intentId === intentId); if (!row)
        throw Error('intent_native_missing'); return row; }
    function basis(row) { const ledger = load(sessionId); if (!ledger)
        throw Error('intent_native_session'); assertSessionWriteOwnership(ledger, instanceId, 'advance intent native contract'); if (ledger.activeIntentId !== row.intentId || !isDeepStrictEqual(ledger.intents.find(r => r.intentId === row.intentId), row.originalDraft))
        throw Error('intent_native_basis_changed'); return ledger; }
    function exact(expected, signal) { admit(signal); if (intentNativeLedgerHash(load(sessionId)) !== intentNativeLedgerHash(expected))
        throw Error('intent_native_basis_changed'); }
    function parseAction(raw, keys = 'intentId requestSource') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
            throw Error('intent_native_host_input');
        const d = Object.getOwnPropertyDescriptors(raw);
        if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)))
            throw Error('intent_native_host_input');
        const { signal, ...rest } = d, input = captureIntentData(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.value])));
        if (Object.keys(input).sort().join(',') !== keys.split(' ').sort().join(',') || !validId(input.intentId) || !['user', 'scheduler'].includes(input.requestSource) || signal && !(signal.value instanceof AbortSignal))
            throw Error('intent_native_host_source');
        return { input, signal: signal ? AbortSignal.any([lifetime.signal, signal.value]) : lifetime.signal };
    }
    function tracked(signal, work) {
        if (closed)
            return Promise.reject(Error('intent_native_host_closed'));
        if (claiming || active)
            return Promise.reject(Error('intent_native_host_busy'));
        claiming = true;
        try {
            admit(signal);
        }
        catch (error) {
            return Promise.reject(error);
        }
        finally {
            claiming = false;
        }
        const task = Promise.resolve().then(() => { admit(signal); return work(); });
        active = task;
        void task.then(() => { if (active === task)
            active = undefined; }, error => { if (active === task)
            active = undefined; if (error !== closeReason)
            writerFailures.add(error); });
        return task;
    }
    async function leased(kind, signal, work, guard = () => admit(signal)) {
        const lease = await acquire({ invocationId: `intent-native-${randomUUID()}`, kind, signal, assertAdmission: guard });
        try {
            guard();
            return await lease.trackInFlight(work(lease));
        }
        finally {
            await lease.releaseAfterDrain();
        }
    }
    async function savePhase(row, stageId, phase, retirementReason, source, signal, terminal, captureCommitted) {
        let guard = () => admit(signal);
        const commit = async (lease) => {
            admit(signal);
            assertLease(sessionId, source, lease);
            const before = load(sessionId);
            if (!before)
                throw Error('intent_native_session');
            // Classify the remote result against the original pre-await ledger while
            // holding the same lease that will write this terminal fact.
            if (terminal && (intentNativeLedgerHash(before) !== intentNativeLedgerHash(terminal.expected) || before.activeIntentId !== row.intentId || !isDeepStrictEqual(before.intents.find(r => r.intentId === row.intentId), row.originalDraft))) {
                phase = 'stale';
                retirementReason = null;
            }
            const timestamp = time();
            admit(signal);
            const subject = row.subjects.find(s => s.stageId === stageId);
            if (!subject)
                throw Error('intent_native_subjects');
            const input = { sessionId, instanceId, intentId: row.intentId, stageId, expectedRevision: row.revision, expectedRequestId: subject.attempts.at(-1).requestId, phase, retirementReason, requestSource: source, now: timestamp };
            const after = captureIntentData(before), predicted = after.nativeContracts.find(r => r.intentId === row.intentId);
            predicted.revision++;
            predicted.updatedAt = timestamp;
            after.updatedAt = timestamp;
            const attempt = predicted.subjects.find(s => s.stageId === stageId).attempts.at(-1);
            attempt.phase = phase;
            attempt.retirementReason = retirementReason;
            const allowed = [intentNativeLedgerHash(before), intentNativeLedgerHash(after)];
            guard = () => { admit(signal); if (!allowed.includes(intentNativeLedgerHash(load(sessionId))))
                throw Error('intent_native_basis_changed'); };
            terminal?.setGuard(guard);
            guard();
            const result = await advanceRecord({ ...input, lease });
            guard();
            captureCommitted?.(after);
            return result;
        };
        return terminal ? commit(terminal.lease) : leased(phase === 'enrolling' ? 'direct-mutation' : 'recovery', signal, commit, () => guard());
    }
    async function run(input, signal, fresh) {
        let row = get(input.intentId);
        const subject = row.subjects.find(s => s.attempts.at(-1).phase !== 'enrolled');
        if (!subject)
            return row;
        const attempt = subject.attempts.at(-1);
        if (attempt.phase !== 'enrolling' && !(fresh && attempt.phase === 'reserved'))
            return row;
        const freshRequest = attempt.phase === 'reserved';
        let expected;
        if (freshRequest) {
            basis(row);
            row = await savePhase(row, subject.stageId, 'enrolling', null, input.requestSource, signal, undefined, next => { expected = next; });
        }
        expected ??= load(sessionId);
        if (!expected)
            throw Error('intent_native_session');
        const originalExpected = expected;
        assertSessionWriteOwnership(expected, instanceId, 'recover intent native contract');
        const target = { version: 1, sessionId, intentId: row.intentId, stageId: subject.stageId }, intentContract = { subject: target, contract: row.contract }, owner = intentHostSubjectOwner(target), registration = intentContractOriginalRegistration(intentContract), request = { requestId: attempt.requestId, enrollment: { ...owner, intentContract, invocations: [] }, registration };
        let guard = () => admit(signal);
        return leased(freshRequest ? 'direct-mutation' : 'recovery', signal, async (lease) => {
            assertLease(sessionId, input.requestSource, lease);
            admit(signal);
            if (freshRequest)
                exact(originalExpected, signal);
            const client = createInstalledVerificationClient(), enrollment = createOwnerEnrollmentClient(client.completionTransport);
            try {
                if (freshRequest) {
                    const prepared = await enrollment.prepareRequest(request, signal);
                    exact(originalExpected, signal);
                    assertLease(sessionId, input.requestSource, lease);
                    if (prepared.created) {
                        await enrollment.authorize(prepared.challenge, signal);
                        admit(signal);
                    }
                }
                const result = await enrollment.recoverRequest(request, signal);
                admit(signal);
                const terminal = { expected: originalExpected, lease, setGuard(next) { guard = next; } };
                if (result.state === 'committed') {
                    // Only the final parent can supply the complete graph registration.
                    if (subject.stageId === null) {
                        const actual = await enrollment.readIntentContract({ subject: target }, signal);
                        admit(signal);
                        if (!isDeepStrictEqual(actual.contract, row.contract) || actual.registrationHash !== intentOriginalRegistrationHash(registration) || !isDeepStrictEqual(actual.owner, result.owner))
                            throw Error('intent_native_receipt_changed');
                    }
                    return savePhase(row, subject.stageId, 'enrolled', null, input.requestSource, signal, terminal);
                }
                return savePhase(row, subject.stageId, 'retired', result.state === 'not_prepared' ? 'not_prepared' : 'not_approved', input.requestSource, signal, terminal);
            }
            finally {
                client.dispose();
            }
        }, () => guard());
    }
    return Object.freeze({
        reserve(raw) { let input; try {
            input = captureIntentData(raw);
            if (Object.keys(input).sort().join(',') !== 'definition,plan,requestSource' || input.requestSource !== 'user')
                throw Error('intent_native_host_source');
        }
        catch (error) {
            return Promise.reject(error);
        } return tracked(lifetime.signal, async () => { const timestamp = time(); admit(lifetime.signal); const expected = load(sessionId); return leased('direct-mutation', lifetime.signal, lease => reserveRecord({ sessionId, instanceId, ...input, expectedLedgerHash: intentNativeLedgerHash(expected), now: timestamp, lease })); }); },
        advance(raw) { try {
            const { input, signal } = parseAction(raw);
            if (input.requestSource !== 'user')
                throw Error('intent_native_host_source');
            return tracked(signal, () => run(input, signal, true));
        }
        catch (error) {
            return Promise.reject(error);
        } },
        recover(raw) { try {
            const { input, signal } = parseAction(raw);
            return tracked(signal, () => run(input, signal, false));
        }
        catch (error) {
            return Promise.reject(error);
        } },
        retrySubject(raw) {
            try {
                const { input, signal } = parseAction(raw, 'intentId requestSource stageId'), stageId = input.stageId;
                if (input.requestSource !== 'user' || stageId !== null && !validId(stageId))
                    throw Error('intent_native_host_source');
                return tracked(signal, async () => {
                    const row = get(input.intentId), subject = row.subjects.find(s => s.stageId === stageId), attempt = subject?.attempts.at(-1);
                    if (!attempt || attempt.phase !== 'retired')
                        throw Error('intent_native_retry');
                    const expected = basis(row), target = { version: 1, sessionId, intentId: row.intentId, stageId }, intentContract = { subject: target, contract: row.contract }, request = { requestId: attempt.requestId, enrollment: { ...intentHostSubjectOwner(target), intentContract, invocations: [] }, registration: intentContractOriginalRegistration(intentContract) };
                    let guard = () => exact(expected, signal);
                    return leased('direct-mutation', signal, async (lease) => {
                        assertLease(sessionId, 'user', lease);
                        exact(expected, signal);
                        const client = createInstalledVerificationClient();
                        try {
                            const result = await createOwnerEnrollmentClient(client.completionTransport).recoverRequest(request, signal);
                            if (result.state !== attempt.retirementReason)
                                throw Error('intent_native_retry');
                            exact(expected, signal);
                            const timestamp = time();
                            exact(expected, signal);
                            guard = () => {
                                admit(signal);
                                const actual = load(sessionId);
                                if (intentNativeLedgerHash(actual) === intentNativeLedgerHash(expected))
                                    return;
                                // Accept only the exact Store-generated reserved append, never another writer.
                                const current = actual?.nativeContracts?.find(r => r.intentId === row.intentId)?.subjects.find(s => s.stageId === stageId)?.attempts.at(-1);
                                if (!current || current.requestId === attempt.requestId)
                                    throw Error('intent_native_basis_changed');
                                const after = captureIntentData(expected), record = after.nativeContracts.find(r => r.intentId === row.intentId);
                                record.revision++;
                                record.updatedAt = timestamp;
                                after.updatedAt = timestamp;
                                record.subjects.find(s => s.stageId === stageId).attempts.push({ requestId: current.requestId, phase: 'reserved', retirementReason: null });
                                if (intentNativeLedgerHash(actual) !== intentNativeLedgerHash(after))
                                    throw Error('intent_native_basis_changed');
                            };
                            const appended = await retryRecord({ sessionId, instanceId, intentId: row.intentId, expectedRevision: row.revision, expectedRequestId: attempt.requestId, stageId, requestSource: 'user', now: timestamp, lease });
                            guard();
                            return appended;
                        }
                        finally {
                            client.dispose();
                        }
                    }, () => guard());
                });
            }
            catch (error) {
                return Promise.reject(error);
            }
        },
        get(intentId) { admit(lifetime.signal); return get(intentId); },
        list() { admit(lifetime.signal); return parseIntentNativeContracts(load(sessionId)?.nativeContracts, sessionId); },
        async close() {
            if (!closeDrain) {
                closed = true;
                const original = active;
                closeDrain = Promise.resolve().then(async () => {
                    const results = await Promise.allSettled(original ? [original] : []), errors = [...new Set([...writerFailures, ...results.flatMap(r => r.status === 'rejected' && r.reason !== closeReason ? [r.reason] : [])])];
                    if (errors.length)
                        throw new AggregateError(errors, 'intent native host physical cleanup failed');
                });
                lifetime.abort(closeReason);
            }
            await closeDrain.catch(() => { });
        },
        waitForClosedResources() { return closeDrain ?? Promise.reject(Error('intent_native_cleanup_not_started')); },
    });
}
