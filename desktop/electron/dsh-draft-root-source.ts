import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {readOriginalDshClaimedCommand,readOriginalDshDomainMetadata} from './desktop-multi-agent-store.js';
import {readOriginalKSwarmDshReply} from './kswarm-service.js';
import {readOriginalDshBudgetPort,readOriginalDshDraftAdmission,assertOriginalDshDraftAdmissionCurrent} from './harness-optimization-service.js';
import type {KSwarmDshAdmission} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
const freeze=Object.freeze,safe=Number.isSafeInteger,parseTime=Date.parse,NativeError=Error;
export interface OriginalDshDraftRootCandidate {
 readonly kind:'original_dsh_draft_root_candidate_v1';readonly candidateOnly:true;
 readonly scope:Readonly<{profileId:string;workspaceId:string;principalId:string}>;
 readonly ownerWorkId:string;readonly draftInvocationId:string;readonly draftCommitKey:string;readonly deadlineAt:number;
 readonly payloadCanonical:string;readonly authorizationRef:string;
}
/** Fixed original A+B provenance for a capacity candidate. It never grants a
 * model/Host launch. After N reservation the B action-time send admission and
 * Native one-use consume are still required, followed by original SDK gates. */
export function readOriginalDshDraftRoot(realm:unknown,store:unknown,claim:object,service:unknown,admission:KSwarmDshAdmission,slotReply:unknown,runtime:unknown,budgetSource:unknown):OriginalDshDraftRootCandidate {
 const original=readOriginalDshClaimedCommand(realm,store,realm,claim),view=readOriginalKSwarmDshReply(service,admission,slotReply);
 if(original.operation!=='prepare_dsh_slot'||view.operation!=='prepare_dsh_slot')throw new NativeError('DSH_ROOT_ORIGINAL_SLOT_REQUIRED');
 view.assertKnown();view.assertCurrent();original.assertCurrent();original.assertLocal();
 const input=captureDispatchBusinessData(view.input) as Record<string,unknown>,output=captureDispatchBusinessData(view.output) as Record<string,unknown>;
 if(!input||!output||output.ok!==true||dshAJson(input.data)!==dshAJson(captureDispatchBusinessData(original.command))||input.budget===null)throw new NativeError('DSH_ROOT_ORIGINAL_SLOT_REQUIRED');
 if(!original.budgetReservation)throw new NativeError('DSH_ROOT_BUDGET_REQUIRED');const port=readOriginalDshBudgetPort(runtime,budgetSource),refs=original.budgetReservation,budget=readOriginalDshDraftAdmission(port,refs.receipt);assertOriginalDshDraftAdmissionCurrent(port,refs.reserveProof,refs.receipt);if(dshAJson(input.budget)!==dshAJson(captureDispatchBusinessData(budget.data)))throw new NativeError('DSH_ROOT_BUDGET_CONFLICT');
 const slot=output.slot as Record<string,unknown>,command=original.command;
 if(!slot||slot.kind!=='dsh_draft_slot'||slot.state!=='prepared'||slot.projectId!==command.targetWorkId||typeof slot.draftInvocationId!=='string'||!slot.draftInvocationId||slot.inputSetRevision!==command.inputSetRevision||slot.assessmentHash!==command.assessmentHash||typeof slot.draftCommitKey!=='string'||!slot.draftCommitKey)throw new NativeError('DSH_ROOT_SLOT_CONFLICT');
 const domain=readOriginalDshDomainMetadata(realm,store,realm,original.scope),deadlineAt=typeof command.executionDeadline==='string'?parseTime(command.executionDeadline):NaN;
 if(!safe(deadlineAt)||deadlineAt<0||typeof command.targetWorkId!=='string'||!command.targetWorkId)throw new NativeError('DSH_ROOT_DEADLINE_REQUIRED');
 original.assertCurrent();original.assertLocal();
 return freeze({kind:'original_dsh_draft_root_candidate_v1',candidateOnly:true,scope:freeze({profileId:original.scope.profileId,workspaceId:original.scope.workspaceId,principalId:domain.principalId}),ownerWorkId:command.targetWorkId,draftInvocationId:slot.draftInvocationId,draftCommitKey:slot.draftCommitKey,deadlineAt,payloadCanonical:dshAJson({command:input.data,slot,ownerDomainId:original.expectedOwnerDomainId}),authorizationRef:domain.authorityId+':'+domain.authorityEpoch});
}
export function assertOriginalDshDraftRootCurrent(realm:unknown,store:unknown,claim:object,service:unknown,admission:KSwarmDshAdmission,slotReply:unknown,runtime:unknown,budgetSource:unknown):void{readOriginalDshDraftRoot(realm,store,claim,service,admission,slotReply,runtime,budgetSource);}

import { readOriginalDshDraftSourceBody, readOriginalDshAdmissionPort, type DshDraftSourceBodyView } from './desktop-multi-agent-store.js';
import { readOriginalMainDshBusinessSource, readOriginalMainDshDraftSlot } from './main-dsh-business-source.js';
import { readOriginalMainDshBudgetAuthoritySource } from './main-dsh-budget-authority-source.js';
import { captureGithubOpaqueRecord } from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import { createRoomTurnCustody, type RoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import { createIntrinsicSet, settleIntrinsicOperations, aggregateIntrinsicErrors, appendIntrinsic } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { types as launchTypes } from 'node:util';
const launchApply = Reflect.apply, launchGet = WeakMap.prototype.get, launchSet = WeakMap.prototype.set;
const launchMapGet = Map.prototype.get, launchMapSet = Map.prototype.set, LaunchMap = Map;
const launchDefine = Object.defineProperty, launchCreate = Object.create, LaunchPromise = Promise, launchThen = Promise.prototype.then;
const launchIsProxy = launchTypes.isProxy, launchIsPromise = launchTypes.isPromise;
type DraftNativePort = ReturnType<typeof import('./main-room-root-admission.js')['readOriginalMainDshDraftAdmission']>;
interface LaunchTicket {
    custody: RoomTurnCustody;
    cleanup: RoomTurnCustody;
    completed: boolean;
    row?: DraftLaunchRow;
}
interface DraftLaunchRow {
    realm: object;
    store: object;
    runtime: object;
    budgetSource: object;
    businessSource: object;
    claim: object;
    slotDelivery: object;
    body: DshDraftSourceBodyView;
    candidate: OriginalDshDraftRootCandidate;
    ownerVersion: number;
    reservationId: string;
    context?: object;
    closed: boolean;
    consumed: boolean;
    enqueued: boolean;
    cancelled: boolean;
    proof: object;
    ticket: LaunchTicket;
    native?: DraftNativePort;
    cancel?: Promise<void>;
}
const draftLaunches = new WeakMap<object, DraftLaunchRow>();
const draftLaunchSources = new WeakMap<object, {
    realm: object;
    store: object;
    runtime: object;
    budgetSource: object;
    source: MainDshDraftLaunchSource;
}>();
export interface MainDshDraftLaunchSource {
    open(originalClaim: object, originalSlotDelivery: object): Promise<object>;
    stopAccepting(): void;
    close(): Promise<void>;
}
function launchInternal<T>(value: Promise<T>): Promise<T> {
    launchDefine(value, 'constructor', { __proto__: null, value: LaunchPromise } as PropertyDescriptor);
    return value;
}
function launchBox<T>(value: T): {
    value: T;
} {
    const box = launchCreate(null) as {
        value: T;
    };
    launchDefine(box, 'value', { __proto__: null, value, enumerable: true } as PropertyDescriptor);
    return box;
}
// Fixed original metadata consumers. They do not close or release a Native N
// resource: the original Owner independently owns that reservation and its fate.
function consumeLaunchMetadata(): void { }
function acceptLaunchMetadata(value: unknown): boolean {
    return value !== null && (typeof value === 'object' || typeof value === 'function') && !launchIsProxy(value) && !launchIsPromise(value);
}
async function launchMetadata<T>(custody: RoomTurnCustody, fn: Function, receiver: unknown, args: unknown[]): Promise<{
    value: T;
}> {
    const value = await custody.sdk<T>(fn, receiver, args, { accept: acceptLaunchMetadata, consumer: consumeLaunchMetadata });
    await custody.consumeResource(consumeLaunchMetadata, value as object, []);
    return launchBox(value);
}
function launchRow(proof: unknown, realm: unknown, store: unknown, runtime: unknown, budgetSource: unknown, businessSource: unknown): DraftLaunchRow {
    const row = launchApply(launchGet, draftLaunches, [proof]) as DraftLaunchRow | undefined;
    if (!row || row.realm !== realm || row.store !== store || row.runtime !== runtime || row.budgetSource !== budgetSource || row.businessSource !== businessSource)
        throw new NativeError('DSH_DRAFT_ORIGINAL_LAUNCH_REQUIRED');
    return row;
}
/** Stops future effects only. It neither erases the private row nor releases N. */
export function sealOriginalMainDshDraftLaunch(proof: unknown, realm: unknown, store: unknown, runtime: unknown, budgetSource: unknown, businessSource: unknown): void {
    launchRow(proof, realm, store, runtime, budgetSource, businessSource).closed = true;
}
/** The Source's accepted SDK component, including known-negative completion.
 * It is independent of model, Host and Native reservation settlement. */
export function readOriginalMainDshDraftLaunchPhysicalFate(proof: unknown, realm: unknown, store: unknown, runtime: unknown, budgetSource: unknown, businessSource: unknown) {
    const row = launchRow(proof, realm, store, runtime, budgetSource, businessSource), ticket = row.ticket;
    const assertKnown = () => {
        if (!row.closed || !ticket.completed)
            throw new NativeError('DSH_DRAFT_LAUNCH_PHYSICAL_UNCONFIRMED');
        ticket.custody.assertPhysicalKnown();
        ticket.cleanup.assertPhysicalKnown();
    };
    const waitKnown = () => launchInternal((async () => {
        await ticket.custody.waitPhysicalKnown();
        await ticket.cleanup.waitPhysicalKnown();
        assertKnown();
    })());
    return freeze({ kind: 'original_dsh_draft_launch_physical_fate_v1' as const, componentOnly: true as const, assertKnown, waitKnown });
}
/** Native receives only a private accepted candidate; this view issues no N. */
export function readOriginalMainDshDraftCandidate(proof: unknown, realm: unknown, store: unknown, runtime: unknown, budgetSource: unknown, businessSource: unknown): OriginalDshDraftRootCandidate & {
    assertCurrent(): void;
    assertLocal(): void;
} {
    const row = launchRow(proof, realm, store, runtime, budgetSource, businessSource);
    const assertLocal = () => {
        if (row.closed)
            throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
        row.ticket.custody.syncVoid(row.body.assertLocal, row.body, []);
    };
    const assertCurrent = () => { assertLocal(); row.ticket.custody.syncVoid(row.body.assertCurrent, row.body, []); assertLocal(); };
    assertCurrent();
    return freeze({ ...row.candidate, assertCurrent, assertLocal });
}
/** Passive identity of an already-consumed original launch. It survives normal
 * seal for negative accounting; no effect current or SDK permission is issued. */
export function readOriginalMainDshDraftLaunchBinding(proof:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown,businessSource:unknown){
    const row=launchRow(proof,realm,store,runtime,budgetSource,businessSource);
    if(!row.consumed||!row.context)throw new NativeError('DSH_DRAFT_NATIVE_LAUNCH_REQUIRED');
    return freeze({kind:'original_dsh_draft_consumed_binding_v1' as const,candidateOnly:true as const,
        executionContext:row.context,draftInvocationId:row.candidate.draftInvocationId,
        draftCommitKey:row.candidate.draftCommitKey,ownerWorkId:row.candidate.ownerWorkId,
        originalClaim:row.claim,originalSlotDelivery:row.slotDelivery});
}
/** Model SDK can use only this exact candidate after original one-use N consume. */
export function readOriginalMainDshDraftLaunch(proof: unknown, realm: unknown, store: unknown, runtime: unknown, budgetSource: unknown, businessSource: unknown) {
    const row = launchRow(proof, realm, store, runtime, budgetSource, businessSource);
    if (!row.consumed || !row.context)
        throw new NativeError('DSH_DRAFT_NATIVE_LAUNCH_REQUIRED');
    const candidate = readOriginalMainDshDraftCandidate(proof, realm, store, runtime, budgetSource, businessSource), b = row.body;
    return freeze({ originalClaim: row.claim, originalSlotDelivery: row.slotDelivery, command: b.command, slot: b.slot, inputManifest: b.inputManifest, executionContext: row.context, scope: candidate.scope, accountId: b.accountId, reservationId: row.reservationId, ownerWorkId: candidate.ownerWorkId, draftInvocationId: candidate.draftInvocationId, draftCommitKey: candidate.draftCommitKey, ownerVersion: row.ownerVersion, modelId: b.modelId, tenantId: b.tenantId, mandateId: b.mandateId, mandateRevision: b.mandateRevision, authorizationEpoch: b.authorizationEpoch, budgetAuthorityHash: b.budgetAuthorityHash, deadline: Math.min(b.deadline, b.validUntil), assertCurrent: candidate.assertCurrent, assertLocal: candidate.assertLocal });
}
export function createMainDshDraftLaunchSource(raw: unknown): MainDshDraftLaunchSource {
    const value = captureGithubOpaqueRecord(raw, ['realm', 'store', 'runtime', 'budgetSource', 'businessSource']);
    const realm = value.realm as object, store = value.store as object, runtime = value.runtime as object, budgetSource = value.budgetSource as object, businessSource = value.businessSource as object;
    readOriginalDshAdmissionPort(store, realm);
    readOriginalMainDshBudgetAuthoritySource(budgetSource, realm, store);
    readOriginalMainDshBusinessSource(businessSource, realm, runtime, budgetSource, store);
    const prior = launchApply(launchGet, draftLaunchSources, [businessSource]) as {
        realm: object;
        store: object;
        runtime: object;
        budgetSource: object;
        source: MainDshDraftLaunchSource;
    } | undefined;
    if (prior) {
        if (prior.realm !== realm || prior.store !== store || prior.runtime !== runtime || prior.budgetSource !== budgetSource)
            throw new NativeError('DSH_DRAFT_LAUNCH_TUPLE_CONFLICT');
        return prior.source;
    }
    let accepting = true, closingStarted = false, closing: Promise<void> | undefined;
    const tickets = createIntrinsicSet<LaunchTicket>(), rows = createIntrinsicSet<DraftLaunchRow>(), byInvocation = new LaunchMap<string, Promise<object>>();
    const acceptedPairs = new WeakMap<object, WeakMap<object, Promise<object>>>();
    const cancel = (row: DraftLaunchRow): Promise<void> => {
        if (row.cancel)
            return row.cancel;
        if (row.consumed || row.cancelled || !row.enqueued || !row.native)
            return launchInternal(new LaunchPromise<void>(yes => yes()));
        const promise = launchInternal(new LaunchPromise<void>((yes, no) => {
            const native = row.native!;
            // Negative cleanup is a distinct accepted Root. Effect Source revocation is
            // not authority to guess that a queued or leased reservation disappeared.
            const work = row.ticket.cleanup.root(async () => {
                await row.ticket.cleanup.sdk(native.cancelQueued, native, [row.proof]);
                row.cancelled = true;
            });
            launchApply(launchThen, work, [yes, no]);
        }));
        row.cancel = promise;
        return promise;
    };
    function open(claim: object, slotDelivery: object): Promise<object> {
        if (!accepting)
            throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
        const paired = launchApply(launchGet, acceptedPairs, [claim]) as WeakMap<object, Promise<object>> | undefined;
        const replay = paired && launchApply(launchGet, paired, [slotDelivery]) as Promise<object> | undefined;
        if (replay)
            return replay;
        const ticket: LaunchTicket = { custody: createRoomTurnCustody(), cleanup: createRoomTurnCustody(), completed: false };
        tickets.add(ticket);
        const completion = ticket.custody.root(async () => {
            try {
                const b = (await launchMetadata<DshDraftSourceBodyView>(ticket.custody, readOriginalDshDraftSourceBody, undefined, [realm, store, realm, claim, slotDelivery])).value;
                const actual = (await launchMetadata<ReturnType<typeof readOriginalMainDshDraftSlot>>(ticket.custody, readOriginalMainDshDraftSlot, undefined, [slotDelivery, realm, store, claim])).value;
                const id = b.slot.draftInvocationId, key = b.slot.draftCommitKey, work = b.command.targetWorkId;
                if (typeof id !== 'string' || typeof key !== 'string' || typeof work !== 'string' || !b.budgetReservation)
                    throw new NativeError('DSH_DRAFT_SLOT_REQUIRED');
                const existing = launchApply(launchMapGet, byInvocation, [id]) as Promise<object> | undefined;
                if (existing)
                    return await existing;
                if (closingStarted)
                    throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
                const port = (await launchMetadata<ReturnType<typeof readOriginalDshBudgetPort>>(ticket.custody, readOriginalDshBudgetPort, undefined, [runtime, budgetSource])).value;
                const fund = (await launchMetadata<ReturnType<typeof readOriginalDshDraftAdmission>>(ticket.custody, readOriginalDshDraftAdmission, undefined, [port, b.budgetReservation.receipt])).value;
                if (fund.data.purpose !== 'draft_prepare' || fund.data.reservationId !== b.command.budgetReservationRef || typeof fund.data.reservationId !== 'string')
                    throw new NativeError('DSH_DRAFT_ORIGINAL_FUND_REQUIRED');
                const domain = (await launchMetadata<ReturnType<typeof readOriginalDshDomainMetadata>>(ticket.custody, readOriginalDshDomainMetadata, undefined, [realm, store, realm, b.storageScope])).value;
                if (closingStarted)
                    throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
                // Another accepted preflight can finish while the preceding original readers
                // are awaiting their SDK tails. Publish the one-use slot before Native SDK.
                const concurrent = launchApply(launchMapGet, byInvocation, [id]) as Promise<object> | undefined;
                if (concurrent)
                    return await concurrent;
                const candidate: OriginalDshDraftRootCandidate = freeze({ kind: 'original_dsh_draft_root_candidate_v1', candidateOnly: true, scope: freeze({ ...b.storageScope, principalId: domain.principalId }), ownerWorkId: work, draftInvocationId: id, draftCommitKey: key, deadlineAt: Math.min(b.deadline, b.validUntil), payloadCanonical: dshAJson({ command: b.command, slot: b.slot, inputManifest: b.inputManifest }), authorizationRef: domain.authorityId + ':' + domain.authorityEpoch });
                const proof = freeze(launchCreate(null));
                const row: DraftLaunchRow = { realm, store, runtime, budgetSource, businessSource, claim, slotDelivery, body: b, candidate, ownerVersion: actual.ownerVersion, reservationId: fund.data.reservationId, closed: false, consumed: false, enqueued: false, cancelled: false, proof, ticket };
                ticket.row = row;
                launchApply(launchSet, draftLaunches, [proof, row]);
                rows.add(row);
                let pairs = launchApply(launchGet, acceptedPairs, [claim]) as WeakMap<object, Promise<object>> | undefined;
                if (!pairs) {
                    pairs = new WeakMap<object, Promise<object>>();
                    launchApply(launchSet, acceptedPairs, [claim, pairs]);
                }
                launchApply(launchSet, pairs, [slotDelivery, completion]);
                let yes!: (value: object) => void, no!: (error: unknown) => void;
                const deferred = launchInternal(new LaunchPromise<object>((resolve, reject) => { yes = resolve; no = reject; }));
                launchApply(launchMapSet, byInvocation, [id, deferred]);
                const entered = launchInternal((async () => {
                    const module = (await launchMetadata<typeof import('./main-room-root-admission.js')>(ticket.custody, () => import('./main-room-root-admission.js'), undefined, [])).value;
                    const native = (await launchMetadata<DraftNativePort>(ticket.custody, module.readOriginalMainDshDraftAdmission, undefined, [realm, store, runtime, budgetSource, businessSource])).value;
                    row.native = native;
                    if (closingStarted) {
                        row.closed = true;
                        throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
                    }
                    await launchMetadata(ticket.custody, native.enqueue, native, [proof]);
                    row.enqueued = true;
                    if (closingStarted) {
                        row.closed = true;
                        await cancel(row);
                        throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
                    }
                    const context = (await launchMetadata<object>(ticket.custody, native.awaitLaunch, native, [proof])).value;
                    row.context = context;
                    row.consumed = true;
                    if (closingStarted) {
                        row.closed = true;
                        throw new NativeError('DSH_DRAFT_LAUNCH_CLOSED');
                    }
                    readOriginalMainDshDraftLaunch(proof, realm, store, runtime, budgetSource, businessSource);
                    return proof;
                })());
                // Keep the actual entered Promise and all rejection siblings in this same
                // Root; the published deferred never substitutes for its physical tail.
                const observation = ticket.custody.sdk<object>(() => entered, undefined, []);
                launchApply(launchThen, observation, [yes, no]);
                return await deferred;
            }
            finally {
                ticket.completed = true;
            }
        });
        return completion;
    }
    const source: MainDshDraftLaunchSource = freeze({
        open,
        stopAccepting() { accepting = false; },
        close() {
            if (closing)
                return closing;
            accepting = false;
            closingStarted = true;
            let yes!: () => void, no!: (error: unknown) => void;
            closing = launchInternal(new LaunchPromise<void>((resolve, reject) => { yes = resolve; no = reject; }));
            const closeWork = launchInternal((async () => {
                const snapshot = rows.snapshot();
                const cancelled = await settleIntrinsicOperations(snapshot, async (row) => { row.closed = true; await cancel(row); });
                const joined = await settleIntrinsicOperations(tickets.snapshot(), async (ticket) => {
                    await ticket.custody.waitPhysicalKnown();
                    await ticket.cleanup.waitPhysicalKnown();
                });
                const errors: unknown[] = [];
                for (let i = 0; i < cancelled.length; i++)
                    if (cancelled[i]!.status === 'rejected')
                        appendIntrinsic(errors, (cancelled[i] as PromiseRejectedResult).reason);
                for (let i = 0; i < joined.length; i++)
                    if (joined[i]!.status === 'rejected')
                        appendIntrinsic(errors, (joined[i] as PromiseRejectedResult).reason);
                if (errors.length === 1)
                    throw errors[0];
                if (errors.length)
                    throw aggregateIntrinsicErrors(errors, 'DSH_DRAFT_LAUNCH_CLOSE_UNCONFIRMED');
            })());
            launchApply(launchThen, closeWork, [yes, no]);
            return closing;
        },
    });
    launchApply(launchSet, draftLaunchSources, [businessSource, { realm, store, runtime, budgetSource, source }]);
    return source;
}
