import {readCurrentIntentPublicationDependencies} from './published-dependencies.js';
import type {ReserveIntentParentPublicationInput} from './publication-candidate-journal.js';
import { randomUUID, createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureIntentData } from './data.js';
import { intentNativeLedgerHash, parseIntentNativeContracts } from './native-contract-journal.js';
import { parseIntentPublicationCandidates, intentPublicationTarget, applyIntentPublicationMutation, type IntentPublicationCandidate, type IntentArtifactSelection, type IntentFileObservation } from './publication-candidate-journal.js';
import { assertSessionWriteOwnership } from './ownership.js';
import { createInstalledIntentApplicationClient } from '../verification/installed-intent-application.js';
import { createInstalledVerificationClient } from '../verification/controller-client.js';
import { createOwnerEnrollmentClient } from '../verification/completion-client.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { intentContractOriginalRegistration, intentOriginalRegistrationHash } from '../verification/intent-contract-enrollment.js';
import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionAuthority, SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import type { SessionIntentLedger } from './types.js';
const id = (v: unknown): v is string => typeof v === 'string' && !!v && Buffer.byteLength(v) <= 160 && !/[\x00-\x1f\x7f]/.test(v);
export interface IntentParentCandidateWrite {ticket:object;lease:SessionExecutionLease}
const parentWrites=new WeakMap<object,{store:SessionStore;lease:SessionExecutionLease;input:ReserveIntentParentPublicationInput;signal:AbortSignal}>();
/** Consume-only: ordinary observations cannot mint a parent capture ticket. */
export function consumeIntentParentCandidateWrite(store:SessionStore,raw:IntentParentCandidateWrite){
 if(!raw||typeof raw!=='object')throw Error('intent_parent_ticket');const d=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(raw).length!==2||!d.ticket||!d.lease||Object.values(d).some(v=>!('value'in v)))throw Error('intent_parent_ticket');
 const ticket=d.ticket.value;if(!ticket||typeof ticket!=='object')throw Error('intent_parent_ticket');const entry=parentWrites.get(ticket);parentWrites.delete(ticket);
 if(!entry||entry.store!==store||entry.lease!==d.lease.value)throw Error('intent_parent_ticket');entry.signal.throwIfAborted();
 return {input:{...captureIntentData(entry.input),publicationAction:'reserve-parent' as const},lease:entry.lease};
}
/** Fixed product composition. Journal/observations are facts, never business grants. */
export function createIntentPublicationHost(options: {
    store: SessionStore;
    authority: SessionExecutionAuthority;
    sessionId: string;
    instanceId: string;
    workspaceRoot: string;
    assertAdmission: () => void;
    now?: () => number;
}) {
    const d = Object.getOwnPropertyDescriptors(options);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)) || Object.keys(d).some(k => !['store', 'authority', 'sessionId', 'instanceId', 'workspaceRoot', 'assertAdmission', 'now'].includes(k)))
        throw Error('intent_publication_options');
    const store=options.store;
    const { sessionId, instanceId } = options, workspace = resolve(options.workspaceRoot), admission = options.assertAdmission, clock = options.now ?? Date.now;
    if (!id(sessionId) || !id(instanceId) || typeof admission !== 'function' || typeof clock !== 'function')
        throw Error('intent_publication_options');
    const read = store.getIntentNativeLedgerSync?.bind(options.store), reserve = store.reserveIntentPublicationCandidate?.bind(options.store), claim = store.claimIntentPublicationApplication?.bind(options.store), observe = store.observeIntentPublicationApplication?.bind(options.store), retry = store.retryIntentPublicationApplication?.bind(options.store), assertLease = store.assertIntentNativeLease?.bind(options.store), acquire = options.authority.acquire.bind(options.authority);
    if (!read || !reserve || !claim || !observe || !retry || !assertLease)
        throw Error('intent_publication_store');
    const saveObserved = observe, claimRequest = claim, retryRequest = retry, checkLease = assertLease, saveParent = store.reserveIntentParentPublicationCandidate?.bind(store);
    const load = () => { const ledger = read(sessionId); if (!ledger)
        throw Error('intent_publication_session'); parseIntentPublicationCandidates(ledger); return ledger; }, lifetime = new AbortController();
    let closed = false, checking = false, claiming = false, active: Promise<unknown> | undefined;
    const closeReason=Error('intent_publication_closed');let closeDrain:Promise<void>|undefined;const writerFailures=new Set<unknown>();
    function admit(signal: AbortSignal) { if (closed)
        throw closeReason; signal.throwIfAborted(); if (checking)
        throw Error('intent_publication_reentrant'); checking = true; try {
        const result: unknown = admission();
        if (result !== undefined) {
            void Promise.resolve(result).catch(() => { });
            throw Error('intent_publication_admission_sync');
        }
    }
    finally {
        checking = false;
    } if (closed)
        throw closeReason; signal.throwIfAborted(); }
    function now() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0)
        throw Error('intent_publication_time'); return value; }
    function get(candidateId: string) { if (!id(candidateId))
        throw Error('intent_publication_identity'); const row = parseIntentPublicationCandidates(load()).find(r => r.id === candidateId); if (!row)
        throw Error('intent_candidate_missing'); return row; }
    function parse(raw: unknown, keys: string) { if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('intent_publication_input'); const d = Object.getOwnPropertyDescriptors(raw); if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v)))
        throw Error('intent_publication_input'); const { signal, ...rest } = d, data = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.value])), value = captureIntentData(data) as any; json(data); if (Object.keys(value).sort().join(',') !== keys.split(' ').sort().join(',') || !['user', 'scheduler'].includes(value.requestSource) || signal && !(signal.value instanceof AbortSignal))
        throw Error('intent_publication_source'); return { input: value, signal: signal ? AbortSignal.any([lifetime.signal, signal.value]) : lifetime.signal }; }
    function tracked<T>(signal: AbortSignal, work: () => Promise<T>) { if (closed || claiming || active)
        return Promise.reject(Error('intent_publication_busy_or_closed')); claiming = true; try {
        admit(signal);
    }
    catch (e) {
        return Promise.reject(e);
    }
    finally {
        claiming = false;
    } const task = Promise.resolve().then(() => { admit(signal); return work(); }); active = task; void task.then(() => { if(active===task)active=undefined; },error => { if(active===task)active=undefined; if(error!==closeReason)writerFailures.add(error); }); return task; }
    async function leased<T>(source: 'user' | 'scheduler', signal: AbortSignal, work: (lease: SessionExecutionLease) => Promise<T>) { const guard = () => { admit(signal); assertSessionWriteOwnership(load(), instanceId, 'intent application'); }; const lease = await acquire({ kind: source === 'user' ? 'direct-mutation' : 'recovery', invocationId: 'intent-application-' + randomUUID(), signal, assertAdmission: guard }); try {
        guard();
        checkLease(sessionId, source, lease);
        return await lease.trackInFlight(Promise.resolve().then(() => work(lease)));
    }
    finally {
        await lease.releaseAfterDrain();
    } }
    function exact(expected: SessionIntentLedger, signal: AbortSignal) { admit(signal); if (intentNativeLedgerHash(load()) !== intentNativeLedgerHash(expected))
        throw Error('intent_publication_basis_changed'); }
    const fileFacts=(ledger:SessionIntentLedger,row?:IntentPublicationCandidate)=>readIntentPublicationFileFacts(ledger,workspace,row);
    async function registered(ledger: SessionIntentLedger, intentId: string, signal: AbortSignal) { const native = parseIntentNativeContracts(ledger.nativeContracts, sessionId).find(n => n.intentId === intentId); if (!native || native.subjects.some(s => s.attempts.at(-1)?.phase !== 'enrolled'))
        throw Error('intent_publication_registration');
        const routes = native.subjects.map(entry => { const owner = intentHostSubjectOwner({version:1,sessionId,intentId,stageId:entry.stageId}), route = readInstalledCurrentOwner(owner); if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered') throw Error('intent_publication_registration'); return {owner,route,encoded:json(route)}; });
        const registrationCurrent = () => { exact(ledger,signal); for (const route of routes) if (json(readInstalledCurrentOwner(route.owner)) !== route.encoded) throw Error('intent_publication_source_changed'); };
        const client = createInstalledVerificationClient(), enrollment = createOwnerEnrollmentClient(client.completionTransport); try { registrationCurrent();
        for (const entry of native.subjects) {
            const subject = { version: 1 as const, sessionId, intentId, stageId: entry.stageId }, intentContract = { subject, contract: native.contract }, registration = intentContractOriginalRegistration(intentContract);
            exact(ledger, signal);
            registrationCurrent();
            const result = await enrollment.lookupRequest({ requestId: entry.attempts.at(-1)!.requestId, enrollment: { ...intentHostSubjectOwner(subject), intentContract, invocations: [] }, registration }, signal);
            exact(ledger, signal);
            registrationCurrent();
            const route = routes.find(r=>r.owner.ownerId===intentHostSubjectOwner(subject).ownerId)!.route;
            if (result.state !== 'committed' || result.challenge.canonicalReview.authorityId !== route.authorityId || json(result.owner) !== json(route.owner))
                throw Error('intent_publication_registration');
        }
        registrationCurrent();
        const subject = { version: 1 as const, sessionId, intentId, stageId: null }, actual = await enrollment.readIntentContract({ subject }, signal);
        exact(ledger, signal);
        registrationCurrent();
        if (json(actual.contract) !== json(native.contract) || actual.contractHash !== native.contractHash || actual.registrationHash !== intentOriginalRegistrationHash(intentContractOriginalRegistration({ subject, contract: native.contract })))
            throw Error('intent_publication_registration');
    }
    finally {
        client.dispose();
    } }
    function routeCurrent(row: IntentPublicationCandidate): boolean {
        return json(readInstalledCurrentOwner(intentHostSubjectOwner(intentPublicationTarget(load(), row).subject))) === row.applicationAttempts.at(-1)!.route;
    }
    function sourceCurrent(row: IntentPublicationCandidate) { try {
        const ledger = load(), files = fileFacts(ledger, row);
        const route = row.applicationAttempts.at(-1)?.route;
        if (route !== null && route !== json(readInstalledCurrentOwner(intentHostSubjectOwner(intentPublicationTarget(ledger, row).subject)))) return false;
        if (json(files) !== json(row.fileObservations))
            return false;
        applyIntentPublicationMutation({ sessionId, intentDelegation: ledger } as any, { sessionId, instanceId, expectedLedgerHash: intentNativeLedgerHash(ledger), requestSource: 'user', now: ledger.updatedAt, fileObservations: files,...(row.body.kind==='intent-parent'?{publicationAction:'reserve-parent',references:row.body.stages}:{publicationAction:'reserve',artifactSelections:row.body.artifacts.map(a=>({artifactId:a.artifactId,obligationId:a.selection.obligationId,path:a.selection.path}))}) });
        return true;
    }
    catch {
        return false;
    } }
    async function saveObservation(row: IntentPublicationCandidate, observation: unknown, changed: boolean, source: 'user' | 'scheduler', signal: AbortSignal, lease: SessionExecutionLease) { const ledger = load(), timestamp = now(); exact(ledger, signal); const attempt = row.applicationAttempts.at(-1)!; return saveObserved({ sessionId, instanceId, candidateId: row.id, expectedLedgerHash: intentNativeLedgerHash(ledger), expectedRequestId: attempt.requestId, expectedRevision: attempt.revision, observation, sourceChanged: changed, requestSource: source, now: timestamp, lease }); }
    async function run(candidateId: string, source: 'user' | 'scheduler', signal: AbortSignal, fresh: boolean) {
        return leased(source, signal, async (lease) => {
            let row = get(candidateId), attempt = row.applicationAttempts.at(-1)!;
            if (attempt.phase !== 'preparing' && !(fresh && attempt.phase === 'reserved'))
                return row;
            let ledger = load();
            if (fresh && attempt.phase === 'reserved') {
                await registered(ledger, row.intentId, signal);
                exact(ledger, signal);
                if (!sourceCurrent(row))
                    throw Error('intent_publication_source_changed');
                const route = json(readInstalledCurrentOwner(intentHostSubjectOwner(intentPublicationTarget(ledger, row).subject))), timestamp = now();
                exact(ledger, signal);
                row = await claimRequest({ sessionId, instanceId, candidateId: row.id, expectedLedgerHash: intentNativeLedgerHash(ledger), expectedRequestId: attempt.requestId, expectedRevision: attempt.revision, route, requestSource: 'user', now: timestamp, lease });
                attempt = row.applicationAttempts.at(-1)!;
                ledger = { ...ledger, updatedAt: timestamp, publicationCandidates: ledger.publicationCandidates!.map(previous => previous.id === row.id ? row : previous) };
                exact(ledger, signal);
                const client = createInstalledIntentApplicationClient(intentPublicationTarget(ledger, row), 'user');
                try {
                    exact(ledger, signal);
                    if (!sourceCurrent(row))
                        return saveObservation(row, null, true, source, signal, lease);
                    if (!routeCurrent(row)) return saveObservation(row, null, true, source, signal, lease);
                    const prepared = await client.prepareRequest(attempt.requestId, signal);
                    exact(ledger, signal);
                    if (!sourceCurrent(row))
                        return saveObservation(row, null, true, source, signal, lease);
                    if (prepared.created && prepared.challenge.canonicalReview.registrationHash !== intentOriginalRegistrationHash(intentContractOriginalRegistration({ subject: intentPublicationTarget(ledger, row).subject, contract: intentPublicationTarget(ledger, row).contract })))
                        throw Error('intent_publication_registration');
                    if (prepared.created && !prepared.challenge.alreadyCommitted) {
                        if (!routeCurrent(row)) return saveObservation(row, null, true, source, signal, lease);
                        await client.authorize(prepared.challenge, signal);
                        exact(ledger, signal);
                        if (!sourceCurrent(row))
                            return saveObservation(row, null, true, source, signal, lease);
                    }
                    if (!routeCurrent(row) || row.stageId===null&&!sourceCurrent(row)) return saveObservation(row, null, true, source, signal, lease);
                const result = await client.recoverRequest(attempt.requestId, signal);
                    exact(ledger, signal);
                    if(row.stageId===null&&!sourceCurrent(row))return saveObservation(row,result,true,source,signal,lease);
                    if (result.state === 'committed') { try { await registered(ledger, row.intentId, signal); } catch(error) { if (!routeCurrent(row)) return saveObservation(row,result,true,source,signal,lease); throw error; } }
                    exact(ledger, signal);
                    return saveObservation(row, result, !sourceCurrent(row), source, signal, lease);
                }
                finally {
                    client.dispose();
                }
            }
            const target = intentPublicationTarget(ledger, row);
            if (json(readInstalledCurrentOwner(intentHostSubjectOwner(target.subject))) !== attempt.route)
                return saveObservation(row, null, true, source, signal, lease);
            const client = createInstalledIntentApplicationClient(target, source);
            try {
                if (!routeCurrent(row) || row.stageId===null&&!sourceCurrent(row)) return saveObservation(row, null, true, source, signal, lease);
                const result = await client.recoverRequest(attempt.requestId, signal);
                exact(ledger, signal);
                if(row.stageId===null&&!sourceCurrent(row))return saveObservation(row,result,true,source,signal,lease);
                if (result.state === 'committed') { try { await registered(ledger, row.intentId, signal); } catch(error) { if (!routeCurrent(row)) return saveObservation(row,result,true,source,signal,lease); throw error; } }
                exact(ledger, signal);
                return saveObservation(row, result, !sourceCurrent(row), source, signal, lease);
            }
            finally {
                client.dispose();
            }
        });
    }
    return Object.freeze({
        draft(raw: {
            requestSource: 'user';
        }) { const { input, signal } = parse(raw, 'requestSource'); if (input.requestSource !== 'user')
            throw Error('intent_publication_source'); return tracked(signal, () => leased('user', signal, async () => { admit(signal); const ledger = load(); assertSessionWriteOwnership(ledger, instanceId, 'intent application draft'); const record = ledger.intents.find(r => r.intentId === ledger.activeIntentId), native = parseIntentNativeContracts(ledger.nativeContracts, sessionId).find(n => n.intentId === record?.intentId), stage = native?.contract.stages.find(s => s.stageId === record?.activeStageId); if (!record || !stage || record.overallStatus !== 'publication_pending')
            throw Error('intent_publication_current'); const originalSelections = stage.verification.obligations.flatMap(o => { const recipe = o.recipe, paths = recipe.kind === 'artifact-content' ? recipe.checks.map(c => c.path) : recipe.kind === 'blackbox' ? ['verification-report.json'] : ('sources' in recipe ? recipe.sources : [recipe]).map(s => s.diagnosisPath); return [...new Set(paths)].map(path => ({ obligationId: o.obligationId, path })); }), artifacts = (record.artifacts ?? []).filter(a => a.stageId === stage.stageId), configuration = { artifactSelections: artifacts.map(a => ({ artifactId: a.artifactId, ...(originalSelections.length === 1 ? originalSelections[0] : { obligationId: null, path: null }) })) }; exact(ledger, signal); const result = captureIntentData({ intentId: record.intentId, stageId: stage.stageId, artifacts, originalSelections, configuration }); const freeze = (v: unknown): void => { if (v && typeof v === 'object') {
            Object.values(v).forEach(freeze);
            Object.freeze(v);
        } }; freeze(result); return result; })); },
        captureParent(raw:{requestSource:'user';signal?:AbortSignal}){try{const {input,signal}=parse(raw,'requestSource');if(input.requestSource!=='user')throw Error('intent_publication_source');
         return tracked(signal,()=>leased('user',signal,async lease=>{
          const ledger=load(),intentId=ledger.activeIntentId;if(!intentId)throw Error('intent_publication_current');
          const write=saveParent;if(!write)throw Error('intent_parent_store');
          await registered(ledger,intentId,signal);exact(ledger,signal);
          const observed=await readCurrentIntentPublicationDependencies({version:1,sessionId,intentId,stageId:null},signal);exact(ledger,signal);
          const references=observed.publications.map(p=>{const local=ledger.publicationCandidates?.find(c=>c.intentId===intentId&&c.stageId===p.application.binding.subject.stageId);if(!local||json(intentPublicationTarget(ledger,local))!==json(p.application.binding))throw Error('intent_parent_current');return {subject:p.application.binding.subject,candidateId:local.id,candidateRevision:local.candidateRevision,bindingHash:p.application.bindingHash,immutablePayloadHash:p.payloadHash,operationId:p.operationId,fullTupleHash:p.fullTupleHash,committedBusinessRevision:p.businessRevision,receiverId:p.receiverId,receiverProtocolVersion:p.receiverProtocolVersion,receiverInstanceEpoch:p.receiverInstanceEpoch};});
          const files=readIntentPublicationFileFacts(ledger,workspace,{intentId,stageId:null}),timestamp=now();exact(ledger,signal);
          const value:ReserveIntentParentPublicationInput={sessionId,instanceId,expectedLedgerHash:intentNativeLedgerHash(ledger),fileObservations:files,references,requestSource:'user',now:timestamp};
          applyIntentPublicationMutation({sessionId,intentDelegation:ledger} as any,{...value,publicationAction:'reserve-parent'});
          exact(ledger,signal);if(json(readIntentPublicationFileFacts(ledger,workspace,{intentId,stageId:null}))!==json(files))throw Error('intent_parent_files');signal.throwIfAborted();const ticket=Object.freeze({});parentWrites.set(ticket,{store,lease,input:captureIntentData(value),signal});try{return await write({ticket,lease});}finally{parentWrites.delete(ticket);}
         }));
        }catch(error){return Promise.reject(error);}},
        capture(raw: {
            artifactSelections: IntentArtifactSelection[];
            requestSource: 'user';
            signal?: AbortSignal;
        }) { try {
            const { input, signal } = parse(raw, 'artifactSelections requestSource');
            if (input.requestSource !== 'user')
                throw Error('intent_publication_source');
            return tracked(signal, () => leased('user', signal, async (lease) => { const ledger = load(), intentId = ledger.activeIntentId; if (!intentId)
                throw Error('intent_publication_current'); await registered(ledger, intentId, signal); exact(ledger, signal); const files = fileFacts(ledger), timestamp = now(); exact(ledger, signal); return reserve({ sessionId, instanceId, expectedLedgerHash: intentNativeLedgerHash(ledger), artifactSelections: input.artifactSelections, fileObservations: files, requestSource: 'user', now: timestamp, lease }); }));
        }
        catch (e) {
            return Promise.reject(e);
        } },
        advance(raw: {
            candidateId: string;
            requestSource: 'user';
            signal?: AbortSignal;
        }) { try {
            const { input, signal } = parse(raw, 'candidateId requestSource');
            if (input.requestSource !== 'user')
                throw Error('intent_publication_source');
            return tracked(signal, () => run(input.candidateId, input.requestSource, signal, true));
        }
        catch (e) {
            return Promise.reject(e);
        } },
        recover(raw: {
            candidateId: string;
            requestSource: 'user' | 'scheduler';
            signal?: AbortSignal;
        }) { try {
            const { input, signal } = parse(raw, 'candidateId requestSource');
            return tracked(signal, () => run(input.candidateId, input.requestSource, signal, false));
        }
        catch (e) {
            return Promise.reject(e);
        } },
        retry(raw: {
            candidateId: string;
            requestSource: 'user';
            signal?: AbortSignal;
        }) { try {
            const { input, signal } = parse(raw, 'candidateId requestSource');
            if (input.requestSource !== 'user')
                throw Error('intent_publication_source');
            return tracked(signal, () => leased('user', signal, async (lease) => { const ledger = load(), row = get(input.candidateId), attempt = row.applicationAttempts.at(-1)!; if (attempt.phase !== 'retired' || !['not_prepared', 'not_approved'].includes(attempt.retirementReason!))
                throw Error('intent_publication_retry'); await registered(ledger, row.intentId, signal); exact(ledger, signal); const target = intentPublicationTarget(ledger, row); if (json(readInstalledCurrentOwner(intentHostSubjectOwner(target.subject))) !== attempt.route || !sourceCurrent(row))
                throw Error('intent_publication_source_changed'); const client = createInstalledIntentApplicationClient(target, 'user'); try {
                if (!routeCurrent(row)||row.stageId===null&&!sourceCurrent(row)) throw Error('intent_publication_source_changed');
                const original = await client.recoverRequest(attempt.requestId, signal);
                exact(ledger, signal);
                if(row.stageId===null&&!sourceCurrent(row))throw Error('intent_publication_source_changed');
                if (original.state !== attempt.retirementReason)
                    throw Error('intent_publication_retry');
                if (original.state === 'not_approved' && (!original.challenge || createHash('sha256').update(json(original.challenge.canonicalReview)).digest('hex') !== attempt.observation?.reviewHash))
                    throw Error('intent_publication_retry');
                const timestamp = now();
                exact(ledger, signal);
                if (!sourceCurrent(row))
                    throw Error('intent_publication_source_changed');
                return retryRequest({ sessionId, instanceId, candidateId: row.id, expectedLedgerHash: intentNativeLedgerHash(ledger), expectedRequestId: attempt.requestId, expectedRevision: attempt.revision, requestSource: 'user', now: timestamp, lease });
            }
            finally {
                client.dispose();
            } }));
        }
        catch (e) {
            return Promise.reject(e);
        } },
        get(candidateId: string) { admit(lifetime.signal); return get(candidateId); }, list() { admit(lifetime.signal); return parseIntentPublicationCandidates(load()); }, async close() {
          if(!closeDrain){closed=true;const original=active;closeDrain=Promise.resolve().then(async()=>{
            const results=await Promise.allSettled(original?[original]:[]),errors=[...new Set([...writerFailures,...results.flatMap(r=>r.status==='rejected'&&r.reason!==closeReason?[r.reason]:[])])];
            if(errors.length)throw new AggregateError(errors,'intent publication host physical cleanup failed');
          });lifetime.abort(closeReason);}
          await closeDrain.catch(()=>{});
        },
        waitForClosedResources(){return closeDrain??Promise.reject(Error('intent_publication_cleanup_not_started'));},
    });
}

export function readIntentPublicationFileFacts(ledger: SessionIntentLedger, workspace:string, row?: Pick<IntentPublicationCandidate,'intentId'|'stageId'>): IntentFileObservation[] {
        const record = ledger.intents.find(r => r.intentId === (row?.intentId ?? ledger.activeIntentId)), stageId = row?row.stageId:record?.activeStageId;
        if (!record)
            throw Error('intent_publication_current');
        return (record.artifacts ?? []).filter(a => (stageId===null||a.stageId === stageId) && a.storage === 'file_ref').map(a => {
            if (!a.path)
                throw Error('intent_publication_file');
            const path = resolve(workspace, a.path), before = lstatSync(path, { bigint: true });
            if (!before.isFile() || before.isSymbolicLink() || before.size > 16n * 1024n ** 2n)
                throw Error('intent_publication_file');
            const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
                const opened = fstatSync(fd, { bigint: true });
                if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile())
                    throw Error('intent_publication_file_changed');
                const bytes = readFileSync(fd), after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
                const identity = (s: typeof before) => json({ dev: String(s.dev), ino: String(s.ino), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
                if (identity(before) !== identity(after) || identity(current) !== identity(after) || current.isSymbolicLink() || bytes.length !== Number(before.size))
                    throw Error('intent_publication_file_changed');
                return { artifactId: a.artifactId, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, identity: identity(after) };
            }
            finally {
                closeSync(fd);
            }
        });
    }
