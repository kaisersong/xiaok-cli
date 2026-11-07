import { types } from 'node:util';
import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import { createIntrinsicSet, appendIntrinsic } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { readOriginalRoomDiscussionRunner,readOriginalRoomDiscussionPhysicalFate } from './desktop-services.js';
import { readOriginalRoomWakeAcceptance } from './collaboration-room-wake-dispatcher.js';
import { readOriginalRoomRuntimeAcceptance } from './room-workspace-runtime.js';
import { createRoomTurnCustody } from './original-room-turn-custody.js';
const create=Object.create, split=String.prototype.split;
const setPrototype = Object.setPrototypeOf, sort = Array.prototype.sort, freeze = Object.freeze, keys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor, own = Object.hasOwn, apply = Reflect.apply, json = JSON.stringify;
const nativeMap = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set, weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set, isProxy = types.isProxy, isArray = Array.isArray;
const NativeWeakMap = WeakMap;
const sources = new NativeWeakMap<object, SourceEntry>();
type Scope = Readonly<{
    profileId: string;
    workspaceId: string;
}>;
export interface OriginalRoomTurnRoot {
    readonly scope: Scope;
    readonly principalId: string;
    readonly payloadCanonical:string;
    readonly roomId: string;
    readonly messageId: string;
    readonly logicalAgentId: string;
    readonly turnId: string;
    readonly priorityClass: 'background';
    readonly contextScope: Readonly<{
        kind: string;
        projectId?: string;
    }>;
}
export interface OriginalRoomTurnSource {
    acceptMessage(input: {
        roomId: string;
        roomMessageId: string;
        logicalAgentIds: readonly string[];
    }): Promise<readonly object[]>;
    seal(): void;
    drain(): Promise<void>;
}
interface SourceEntry {
    readonly scope:Scope;
    readonly runtime:object;
    readonly services:object;
    accept(input:{roomId:string;roomMessageId:string;logicalAgentIds:readonly string[]}):Promise<readonly object[]>;
    physical(proof:object):Readonly<{waitKnown():Promise<void>;assertKnown():void}>;
    shutdown():Promise<void>;
    read(proof: object): OriginalRoomTurnRoot;
    current(proof: object): void;
    revalidate(proof:object):Promise<void>;
    claim(proof:object,hostId:string):Promise<object>;
    readClaim(proof:object,claim:object):Readonly<OriginalRoomTurnClaim>;
}
const denied = () => Error('ROOM_TURN_ORIGINAL_PROOF_REQUIRED');
function entry(source: object): SourceEntry {
    const found = apply(weakGet, sources, [source]) as SourceEntry | undefined;
    if (!found)
        throw denied();
    return found;
}
export function readOriginalRoomTurnSourceBinding(source:object):Readonly<{scope:Scope}> {return freeze({__proto__:null,scope:entry(source).scope});}
/** Original birth relation only. No public runtime table is inspected. */
export function readOriginalRoomTurnRuntimeBinding(source:object,runtime:object):void {
    if(entry(source).runtime!==runtime)throw denied();
}
export function acceptOriginalRoomRuntimeTurn(source:object,runtime:object,input:{roomId:string;roomMessageId:string;logicalAgentIds:readonly string[]}):Promise<readonly object[]> {
    const row=entry(source);if(row.runtime!==runtime)throw denied();return row.accept(input);
}
export function readOriginalRoomTurnRunnerPhysicalFate(source:object,runtime:object,raw:unknown,parent:unknown):Readonly<{waitKnown():Promise<void>;assertKnown():void}> {
    const row=entry(source);if(row.runtime!==runtime)throw denied();
    return readOriginalRoomDiscussionPhysicalFate(readOriginalRoomDiscussionRunner(row.services),raw,parent);
}
/** Fixed original Runtime coordinator, independent of effect-current gates. */
export function closeOriginalRoomTurnRuntime(source:object):Promise<void>{return entry(source).shutdown();}
export function readOriginalRoomTurnPhysicalFate(source:object,proof:object):Readonly<{waitKnown():Promise<void>;assertKnown():void}> {
    return entry(source).physical(proof);
}
export function readOriginalRoomTurnRoot(source: object, proof: object): OriginalRoomTurnRoot {
    return entry(source).read(proof);
}
/** Local accepted-candidate lifetime only; this does not reauthorize a Broker action. */
export function assertOriginalRoomTurnRootCurrent(source: object, proof: object): void {
    entry(source).current(proof);
}
export interface OriginalRoomTurnClaim {readonly roomId:string;readonly messageId:string;readonly logicalAgentId:string;readonly hostId:string;readonly claimToken:string;readonly claimLeaseUntil:string}
export function revalidateOriginalRoomTurnRoot(source:object,proof:object):Promise<void> {return entry(source).revalidate(proof);}
export function claimOriginalRoomTurnRoot(source:object,proof:object,hostId:string):Promise<object> {return entry(source).claim(proof,hostId);}
export function readOriginalRoomTurnClaim(source:object,proof:object,claim:object):Readonly<OriginalRoomTurnClaim> {return entry(source).readClaim(proof,claim);}
function exact(value: unknown, names: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || isProxy(value) || isArray(value))
        throw denied();
    const found = keys(value);
    if (found.length !== names.length)
        throw denied();
    for (let i = 0; i < names.length; i++) {
        const row = descriptor(value, names[i]!);
        if (!row || !own(row, 'value'))
            throw denied();
    }
    return value as Record<string, unknown>;
}
function reference(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256;
}
/** Exact original composition acceptance. This is neither Main role nor N. */
export function createOriginalRoomTurnSource(options: {
    dispatcher: object;
    runtime: object;
    services: object;
    scope: Scope;
}): OriginalRoomTurnSource {
    const supplied = exact(options, ['dispatcher', 'runtime', 'services', 'scope']);
    const runner = readOriginalRoomDiscussionRunner(supplied.services as object), runtime = readOriginalRoomRuntimeAcceptance(supplied.runtime as object, runner), dispatcher = readOriginalRoomWakeAcceptance(supplied.dispatcher as object);
    const scopeRaw = exact(supplied.scope, ['profileId', 'workspaceId']);
    if (!reference(scopeRaw.profileId) || !reference(scopeRaw.workspaceId))
        throw denied();
    const scope = captureDispatchBusinessData(scopeRaw) as Scope, custody = createRoomTurnCustody(), proofs = new NativeWeakMap<object, OriginalRoomTurnRoot>();
    const accepted = new nativeMap<string, {
        digest: string;
        proof: object;
    }>();
    const claimed=new NativeWeakMap<object,{proof:object;view:Readonly<OriginalRoomTurnClaim>}>(),claimStarted=new NativeWeakMap<object,object>();
    const local = (proof: object) => {
        if (!apply(weakGet, proofs, [proof]))
            throw denied();
        runtime.current(source, proof);
        custody.accepted();
    };
    const read = (proof: object) => {
        local(proof);
        return apply(weakGet, proofs, [proof]) as OriginalRoomTurnRoot;
    };
    const revalidate = (proof:object):Promise<void> => {
        const view=read(proof); // Original membership precedes work/SDK admission.
        return custody.root(async()=>{
            local(proof);
            const candidates=await dispatcher.collect({roomId:view.roomId,roomMessageId:view.messageId,logicalAgentIds:[view.logicalAgentId]},custody);
            local(proof);
            if(candidates.length!==1||json(candidates[0]!.source)!==view.payloadCanonical)throw Error('ROOM_TURN_ACCEPTANCE_CONFLICT');
        });
    };
    const claim=(proof:object,hostId:string):Promise<object>=>{
        const view=read(proof);
        if(!reference(hostId))throw denied();
        return custody.root(async()=>{
            if(apply(weakGet,claimStarted,[proof]))throw Error('ROOM_TURN_ALREADY_CLAIMED');
            const attempt=freeze(create(null));
            apply(weakSet,claimStarted,[proof,attempt]); // One use before any current/HTTP SDK.
            await revalidate(proof);
            local(proof);
            const raw=await dispatcher.claim({roomId:view.roomId,roomMessageId:view.messageId,logicalAgentId:view.logicalAgentId,hostParticipantId:hostId},custody);
            const result=captureDispatchBusinessData(raw,value=>custody.inventory(value)) as Record<string,unknown>;
            const token=typeof result.claimToken==='string'?apply(split,result.claimToken,['|']) as string[]:[];
            if(result.ok!==true||result.roomId!==view.roomId||typeof result.claimLeaseUntil!=='string'||token.length!==4||token[0]!==view.messageId||token[1]!==view.logicalAgentId||!token[2]||token[3]!==result.claimLeaseUntil)throw Error('ROOM_TURN_CLAIM_UNAVAILABLE');
            local(proof);
            const claim=freeze(create(null));
            const data=captureDispatchBusinessData({roomId:view.roomId,messageId:view.messageId,logicalAgentId:view.logicalAgentId,hostId,claimToken:result.claimToken,claimLeaseUntil:result.claimLeaseUntil}) as unknown as Readonly<OriginalRoomTurnClaim>;
            apply(weakSet,claimed,[claim,{proof,view:data}]);return claim;
        });
    };
    const readClaim=(proof:object,claim:object)=>{
        const row=apply(weakGet,claimed,[claim]) as {proof:object;view:Readonly<OriginalRoomTurnClaim>}|undefined;
        if(!row||row.proof!==proof||!apply(weakGet,proofs,[proof]))throw denied();
        return row.view;
    };
    const source: OriginalRoomTurnSource = freeze({
        acceptMessage(input: {
            roomId: string;
            roomMessageId: string;
            logicalAgentIds: readonly string[];
        }) {
            return custody.root(async () => {
                const data = captureDispatchBusinessData(input, value => custody.inventory(value)) as Record<string, unknown>;
                exact(data, ['roomId', 'roomMessageId', 'logicalAgentIds']);
                if (!reference(data.roomId) || !reference(data.roomMessageId) || !isArray(data.logicalAgentIds) || data.logicalAgentIds.length === 0 || data.logicalAgentIds.length > 256)
                    throw denied();
                const ids: string[] = [], seen = createIntrinsicSet<string>();
                for (let i = 0; i < data.logicalAgentIds.length; i++) {
                    const id = data.logicalAgentIds[i];
                    if (!reference(id))
                        throw denied();
                    if (!seen.has(id)) {
                        seen.add(id);
                        appendIntrinsic(ids, id);
                    }
                }
                apply(sort, ids, []);
                const candidates = await dispatcher.collect({ roomId: data.roomId, roomMessageId: data.roomMessageId, logicalAgentIds: ids }, custody);
                custody.current();
                const result: object[] = [];
                for (let i = 0; i < candidates.length; i++) {
                    const candidate = candidates[i]!, envelope = captureDispatchBusinessData(candidate.envelope, value => custody.inventory(value)) as typeof candidate.envelope;
                    const key = `${envelope.roomId.length}:${envelope.roomId}${envelope.roomMessageId.length}:${envelope.roomMessageId}${envelope.logicalAgentId.length}:${envelope.logicalAgentId}`;
                    const digest = json(candidate.source), prior = apply(mapGet, accepted, [key]) as {
                        digest: string;
                        proof: object;
                    } | undefined;
                    if (prior) {
                        if (prior.digest !== digest)
                            throw Error('ROOM_TURN_ACCEPTANCE_CONFLICT');
                        local(prior.proof);
                        appendIntrinsic(result, prior.proof);
                        continue;
                    }
                    custody.current();
                    const proof = runtime.accept(source, envelope);
                    const view = captureDispatchBusinessData({ scope, principalId:'desktop-user:'+scope.profileId, payloadCanonical:digest, roomId: envelope.roomId, messageId: envelope.roomMessageId, logicalAgentId: envelope.logicalAgentId, turnId: 'room-turn-v1:' + key, priorityClass: 'background', contextScope: envelope.contextScope }) as OriginalRoomTurnRoot;
                    apply(weakSet, proofs, [proof, view]);
                    apply(mapSet, accepted, [key, freeze({ digest, proof })]);
                    appendIntrinsic(result, proof);
                }
                custody.current();
                setPrototype(result, null);
                return freeze(result);
            });
        }, seal: custody.seal, drain: custody.drain,
    });
    runtime.bind(source, custody);
    const physical=(proof:object)=>{
        if(!apply(weakGet,proofs,[proof]))throw denied();
        const fate=runtime.physical(source,proof);
        const assertKnown=()=>{custody.assertPhysicalKnown();fate.assertKnown();};
        return freeze({async waitKnown(){await custody.waitPhysicalKnown();await fate.waitKnown();assertKnown();},assertKnown});
    };
    apply(weakSet, sources, [source, freeze({ scope, runtime:supplied.runtime as object, services:supplied.services as object, accept:source.acceptMessage, physical, shutdown:runtime.shutdown, read, current: local, revalidate, claim, readClaim })]);
    return source;
}
