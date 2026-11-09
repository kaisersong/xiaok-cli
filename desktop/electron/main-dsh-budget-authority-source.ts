import {types} from 'node:util';
import {readOriginalMainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalMainDshControl} from './main-dsh-control-source.js';
import {readOriginalDshDraftAdmissionRequest,readOriginalDshUserBudgetAudience,readOriginalDshBudgetObservationAudience,readOriginalDshBudgetSettlementAudience,readOriginalDshDomainMetadata,readOriginalDshAdmissionPort,readOriginalDshUserControlPort} from './desktop-multi-agent-store.js';
import {dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {readOriginalMainDshBusinessSettlement,readOriginalMainDshCompletedDraft} from './main-dsh-business-source.js';
import {readOriginalDshBudgetRuntimeBinding,readOriginalDshBudgetWorkSnapshot,readOriginalDshDraftAdmission} from './harness-optimization-service.js';
import {dshBudgetCommandDigest,dshRecord,dshInteger,parseDshInput} from './harness-dsh-budget-data.mjs';
import {captureIpcData} from './ipc-data-snapshot.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {createIntrinsicSet,settleIntrinsicOperations,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import {readOriginalDshModelBudgetAuthority} from './main-dsh-model-source.js';
import {readOriginalDshDraftModelBudgetAuthority,readOriginalDshDraftModelLaunchPhysicalFate} from './main-dsh-draft-model-source.js';
import {readOriginalMainDshDraftLaunchBinding,readOriginalMainDshDraftLaunchPhysicalFate} from './dsh-draft-root-source.js';
const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys,create=Object.create,freeze=Object.freeze,define=Object.defineProperty,assign=Object.assign;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,isProxy=types.isProxy,isPromise=types.isPromise,isAsync=types.isAsyncFunction,prototype=Object.getPrototypeOf;
const FunctionPrototype=Function.prototype,NativePromise=Promise,nativeThen=Promise.prototype.then,NativeError=Error;
const deny=()=>new NativeError('MAIN_DSH_BUDGET_AUTHORITY_REQUIRED');
interface Actor {readonly requestSource:'user';readonly principalId:string}
interface Proof {purpose:string;data:Readonly<Record<string,unknown>>;authority:Readonly<Record<string,unknown>>;actor:Actor|null;current():void;local():void}
interface State {actors:WeakMap<object,Proof>;realm:object;store():object|undefined;local():void}
const sources=new WeakMap<object,State>();
/** Passive composition identity only. Never an account or spending grant. */
export function readOriginalMainDshBudgetAuthoritySource(source:unknown,realm:unknown,store:unknown):Readonly<{assertLocal():void}> {
    const row=apply(get,sources,[source]) as State|undefined;
    if(!row||row.realm!==realm||row.store()!==store||!store)throw deny();
    row.local();return freeze({assertLocal:row.local});
}
export interface MainDshBudgetUserRequest {
    readonly account:Readonly<Record<string,unknown>>;readonly openProof:object;readonly readInput:Readonly<{accountId:string}>;readonly readProof:object;
}
export interface MainDshBudgetAuthoritySource {
    bindStore(store:object):void;
    openUserBudget(originalUserProof:object,bodyHash:string):MainDshBudgetUserRequest;
    openAssessmentBudget(originalModelAttempt:object,purpose:string,input:unknown):object;
    openDraftModelBudget(originalDraftModelToken:object,purpose:string,input:unknown):object;
    openDraftAdmission(originalProposal:object):Readonly<{policyInput:Readonly<Record<string,unknown>>;policyProof:object;reserveInput:Readonly<Record<string,unknown>>;reserveProof:object}>;
    openSchedulerWorkPolicy(mandateId:string):Readonly<{policyInput:Readonly<Record<string,unknown>>;policyProof:object}>;
    openDraftWorkRead(originalBasis:object,runtime:object):Readonly<{readInput:Readonly<Record<string,unknown>>;readProof:object}>;
    openDraftBinding(originalBasis:object,runtime:object):Promise<Readonly<{bindInput:Readonly<Record<string,unknown>>;bindProof:object}>>;
    openCompletedDraftWork(originalBasis:object,originalCommitted:object,runtime:object,launch:object,modelSource:object,modelToken:object,businessSource:object):Promise<Readonly<{closeInput:Readonly<Record<string,unknown>>;closeProof:object}>>;
    openSchedulerObservation(mandateId:string):Readonly<{readInput:Readonly<{accountId:string}>;readProof:object}>;
    resolve(proof:object,purpose:string):Readonly<Record<string,unknown>>|null;
    seal():void;drain():Promise<void>;
}
/** Passive original actor membership for the original runtime's authorizeUser.
 * It is not a verifier callback, Main-role test or budget grant. */
export function isOriginalMainDshBudgetActor(source:unknown,actor:unknown):boolean {
    const row=apply(get,sources,[source]) as State|undefined;
    if(!row||!apply(get,row.actors,[actor]))return false;
    try{row.local();return true;}catch{return false;}
}
/** Lazy fixed Source: construction and bind are membership-only. Actual Native
 * and user SDK checks start only after the returned Source owns its Root. */
export function createMainDshBudgetAuthoritySource(options:{realm:object;userSource:object;store?:object}):MainDshBudgetAuthoritySource {
    if(!options||typeof options!=='object'||isProxy(options))throw deny();
    const names=keys(options);
    if(names.length!==2&&names.length!==3)throw deny();
    for(let i=0;i<names.length;i++)if(names[i]!=='realm'&&names[i]!=='userSource'&&names[i]!=='store')throw deny();
    const realmRow=descriptor(options,'realm'),sourceRow=descriptor(options,'userSource'),storeRow=descriptor(options,'store');
    if(!realmRow||!sourceRow||!own(realmRow,'value')||!own(sourceRow,'value')||storeRow&&!own(storeRow,'value'))throw deny();
    const realm=realmRow.value,userSource=sourceRow.value;
    if(!realm||typeof realm!=='object'||isProxy(realm)||!userSource||typeof userSource!=='object'||isProxy(userSource))throw deny();
    let store:object|undefined,sealed=false,failed=false,first:unknown,firstPresent=false,closing:Promise<void>|undefined;
    const frames=new WeakMap<object,Proof>(),actors=new WeakMap<object,Proof>();
    const roots=createIntrinsicSet<Promise<void>>(),tails=createIntrinsicSet<Promise<void>>(),retained=createIntrinsicSet<unknown>(),unknown=createIntrinsicSet<unknown>();
    const local=()=>{if(sealed||failed)throw firstPresent?first:deny();};
    function remember(error:unknown){if(!firstPresent){firstPresent=true;first=error;}}
    function inventory(value:unknown):void {
        retainSourceErrorTails(value,(raw,kind)=>{
            if(kind==='unknown')unknown.add(raw);
            if(!isPromise(raw)||isProxy(raw)||retained.has(raw))return;
            retained.add(raw);let done!:()=>void;const completion=new NativePromise<void>(yes=>{done=yes;});tails.add(completion);
            try {
                assertStandardIpcPromise(raw,'MAIN_DSH_BUDGET_TAIL_UNKNOWN');
                apply(nativeThen,raw,[(result:unknown)=>settled(result,false),(error:unknown)=>settled(error,true)]);
            } catch(error){unknown.add(raw);remember(error);tails.delete(completion);done();}
            function settled(result:unknown,rejected:boolean){if(rejected)remember(result);try{inventory(result);}catch(error){unknown.add(result);remember(error);}finally{tails.delete(completion);done();}}
        });
    }
    function fault(error:unknown){remember(error);failed=true;inventory(error);}
    function root<T>(body:(holder:Record<string,unknown>)=>T):T {
        let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});roots.add(completion);
        const holder=create(null) as Record<string,unknown>;
        try{return body(holder);}catch(error){inventory(error);throw error;}finally{roots.delete(completion);complete();}
    }
    function sync(fn:unknown):fn is Function{return typeof fn==='function'&&!isProxy(fn)&&!isAsync(fn)&&prototype(fn)===FunctionPrototype;}
    let sdkSequence=0;
    function call<T>(holder:Record<string,unknown>,name:string,fn:Function,args:unknown[],voidResult=false):T {
        if(!sync(fn))throw deny();
        const slot=create(null);define(holder,String(++sdkSequence),{__proto__:null,value:slot,enumerable:true} as PropertyDescriptor);define(slot,'name',{__proto__:null,value:name,enumerable:true} as PropertyDescriptor);let raw:unknown;
        try{raw=apply(fn,undefined,args);define(slot,'raw',{__proto__:null,value:raw,enumerable:true} as PropertyDescriptor);}
        catch(error){define(slot,'error',{__proto__:null,value:error,enumerable:true} as PropertyDescriptor);inventory(error);throw error;}
        if(isPromise(raw)||raw&&typeof raw==='object'&&isProxy(raw)){fault(raw);throw deny();}
        if(voidResult&&raw!==undefined){fault(raw);throw deny();}
        return raw as T;
    }
    function bindStore(candidate:object):void {
        local();if(store){if(store!==candidate)throw deny();return;}
        // Both readers start with their module-private original Store tuple.
        readOriginalDshAdmissionPort(candidate,realm);readOriginalDshUserControlPort(candidate,userSource);
        local();if(store&&store!==candidate)throw deny();store=candidate;
    }
    function openUserBudget(userProof:object,bodyHash:string):MainDshBudgetUserRequest {
        // Failure before a genuine user proof is a known denial, not a Source
        // SDK fault. It must not poison a later correct first configuration.
        local();if(!store)throw deny();
        return root(holder=>{
            const user=call<ReturnType<typeof readOriginalMainDshControl>>(holder,'user',readOriginalMainDshControl,[userSource,userProof,store,'policy_control',bodyHash]);
            const native=call<ReturnType<typeof readOriginalMainDshBootstrapAuthority>>(holder,'native',readOriginalMainDshBootstrapAuthority,[realm,store,realm]);
            const resolve=descriptor(userSource,'resolve');
            if(!resolve||!own(resolve,'value')||!sync(resolve.value))throw deny();
            // The source was authenticated by the original private reader first.
            const raw=apply(resolve.value,userSource,[userProof,'policy_control']);define(holder,'userReply',{__proto__:null,value:raw,enumerable:true} as PropertyDescriptor);
            let reply:Record<string,unknown>;try{reply=dshRecord(raw,['data','assertCurrent']);}catch(error){fault(raw);throw error;}if(!sync(reply.assertCurrent)){fault(raw);throw deny();}
            const body=dshRecord(captureIpcData(reply.data),['schemaVersion','kind','account','mandate']);
            if(body.schemaVersion!==1||body.kind!=='budget_config')throw deny();
            const account=parseDshInput('open',body.account),mandate=dshRecord(body.mandate,['tenantId','mandateId','mandateRevision']);
            for(const key of ['tenantId','mandateId'])if(typeof mandate[key]!=='string'||!mandate[key])throw deny();
            dshInteger(mandate.mandateRevision,1);
            const audience=call<ReturnType<typeof readOriginalDshUserBudgetAudience>>(holder,'audience',readOriginalDshUserBudgetAudience,[realm,store,realm,userProof,bodyHash]);
            if(audience.principalId!==user.principalId||audience.storageScope.profileId!==user.storageScope.profileId||audience.storageScope.workspaceId!==user.storageScope.workspaceId||audience.accountId!==account.accountId||audience.tenantId!==mandate.tenantId||audience.mandateId!==mandate.mandateId||audience.mandateRevision!==mandate.mandateRevision)throw deny();
            const actor=freeze(assign(create(null),{requestSource:'user',principalId:audience.principalId})) as Actor;
            const pure=()=>{local();user.assertLocal();native.assertLocal();audience.assertLocal();local();};
            const current=()=>root(next=>{
                local();call(next,'userCurrent',user.assertCurrent,[],true);call(next,'nativeCurrent',native.assertCurrent,[],true);call(next,'audienceCurrent',audience.assertCurrent,[],true);
                call(next,'userLocal',user.assertLocal,[],true);call(next,'nativeLocal',native.assertLocal,[],true);call(next,'audienceLocal',audience.assertLocal,[],true);local();
            });
            current();pure();
            const readInput=freeze(assign(create(null),{accountId:audience.accountId})) as Readonly<{accountId:string}>;
            const authority=freeze(assign(create(null),{requestSource:'user',profileId:audience.storageScope.profileId,workspaceId:audience.storageScope.workspaceId,tenantId:audience.tenantId,mandateId:audience.mandateId,mandateRevision:audience.mandateRevision,authorizationEpoch:audience.authorizationEpoch,authorityHash:audience.budgetAuthorityHash}));
            const openProof=freeze(create(null)),readProof=freeze(create(null));
            const open:Proof={purpose:'open',data:account,authority,actor,current,local:pure},read:Proof={purpose:'read',data:readInput,authority,actor,current,local:pure};
            apply(set,frames,[openProof,open]);apply(set,frames,[readProof,read]);apply(set,actors,[actor,open]);
            pure();return freeze(assign(create(null),{account,openProof,readInput,readProof}));
        });
    }
    function openAssessmentBudget(originalModelAttempt:object,purpose:string,input:unknown):object {
        local();if(!store)throw deny();
        return root(holder=>{
            const view=call<Readonly<Record<string,unknown>>>(holder,'modelAuthority',readOriginalDshModelBudgetAuthority,[originalModelAttempt,source,purpose,input]);
            const current=view.assertCurrent;if(!sync(current))throw deny();
            const data=parseDshInput(purpose,input),authority=create(null);
            for(const name of ['requestSource','profileId','workspaceId','tenantId','mandateId','mandateRevision','authorizationEpoch','authorityHash'])define(authority,name,{__proto__:null,value:view[name],enumerable:true} as PropertyDescriptor);
            if(authority.requestSource!=='scheduler'||view.actor!==null)throw deny();
            const guard=()=>{local();call(holder,'modelCurrent',current,[],true);local();};guard();
            const proof=freeze(create(null));apply(set,frames,[proof,{purpose,data,authority:freeze(authority),actor:null,current:guard,local}]);return proof;
        });
    }
    function openDraftModelBudget(originalDraftModelToken:object,purpose:string,input:unknown):object {
        local();if(!store)throw deny();
        return root(holder=>{
            const view=call<Readonly<Record<string,unknown>>>(holder,'draftModelAuthority',readOriginalDshDraftModelBudgetAuthority,[originalDraftModelToken,source,purpose,input]);
            const current=view.assertCurrent;if(!sync(current))throw deny();
            const data=parseDshInput(purpose,input),authority=create(null);
            for(const name of ['requestSource','profileId','workspaceId','tenantId','mandateId','mandateRevision','authorizationEpoch','authorityHash'])define(authority,name,{__proto__:null,value:view[name],enumerable:true} as PropertyDescriptor);
            if(authority.requestSource!=='scheduler'||view.actor!==null)throw deny();
            const guard=()=>{local();call(holder,'draftModelCurrent',current,[],true);local();};guard();
            const proof=freeze(create(null));apply(set,frames,[proof,{purpose,data,authority:freeze(authority),actor:null,current:guard,local}]);return proof;
        });
    }
    function openDraftAdmission(originalProposal:object):Readonly<{policyInput:Readonly<Record<string,unknown>>;policyProof:object;reserveInput:Readonly<Record<string,unknown>>;reserveProof:object}> {
        local();if(!store)throw deny();
        return root(holder=>{
            const view=call<ReturnType<typeof readOriginalDshDraftAdmissionRequest>>(holder,'draftProposal',readOriginalDshDraftAdmissionRequest,[realm,store,realm,originalProposal]);
            const pure=()=>{local();view.assertLocal();local();};
            const current=()=>root(next=>{local();call(next,'proposalCurrent',view.assertCurrent,[],true);call(next,'proposalLocal',view.assertLocal,[],true);local();});current();pure();
            const authority=freeze(assign(create(null),{requestSource:'scheduler',profileId:view.storageScope.profileId,workspaceId:view.storageScope.workspaceId,tenantId:view.tenantId,mandateId:view.mandateId,mandateRevision:view.mandateRevision,authorizationEpoch:view.authorizationEpoch,authorityHash:view.budgetAuthorityHash}));
            const policyInput=parseDshInput('work_policy_sync',{accountId:view.accountId,maxActiveWorks:view.maxActiveWorks,maxDraftRequestsPerWork:view.maxDraftRequestsPerWork});
            const reserveInput=parseDshInput('work_reserve',{accountId:view.accountId,bindingId:view.bindingId,generation:view.generation,scope:view.storageScope,thread:view.thread,initialTokens:view.initialTokens,initialCostMicros:view.initialCostMicros,deadline:view.deadline,command:view.command});
            const policyProof=freeze(create(null)),reserveProof=freeze(create(null));
            apply(set,frames,[policyProof,{purpose:'work_policy_sync',data:policyInput,authority,actor:null,current,local:pure}]);apply(set,frames,[reserveProof,{purpose:'work_reserve',data:reserveInput,authority,actor:null,current,local:pure}]);
            pure();return freeze(assign(create(null),{policyInput,policyProof,reserveInput,reserveProof}));
        });
    }
    function openSchedulerObservation(mandateId:string):Readonly<{readInput:Readonly<{accountId:string}>;readProof:object}> {
        local();if(!store)throw deny();
        return root(holder=>{
            const audience=call<ReturnType<typeof readOriginalDshBudgetObservationAudience>>(holder,'budgetAudience',readOriginalDshBudgetObservationAudience,[realm,store,realm,mandateId]);
            const pure=()=>{local();audience.assertLocal();local();};
            const current=()=>root(next=>{local();call(next,'audienceCurrent',audience.assertCurrent,[],true);call(next,'audienceLocal',audience.assertLocal,[],true);local();});
            current();pure();
            const readInput=freeze(assign(create(null),{accountId:audience.accountId})) as Readonly<{accountId:string}>;
            const authority=freeze(assign(create(null),{requestSource:'scheduler',profileId:audience.storageScope.profileId,workspaceId:audience.storageScope.workspaceId,tenantId:audience.tenantId,mandateId:audience.mandateId,mandateRevision:audience.mandateRevision,authorizationEpoch:audience.authorizationEpoch,authorityHash:audience.budgetAuthorityHash}));
            const readProof=freeze(create(null));apply(set,frames,[readProof,{purpose:'read',data:readInput,authority,actor:null,current,local:pure}]);
            pure();return freeze(assign(create(null),{readInput,readProof}));
        });
    }
    function schedulerAuthority(audience:ReturnType<typeof readOriginalDshBudgetObservationAudience>){
        return freeze(assign(create(null),{requestSource:'scheduler',profileId:audience.storageScope.profileId,workspaceId:audience.storageScope.workspaceId,tenantId:audience.tenantId,mandateId:audience.mandateId,mandateRevision:audience.mandateRevision,authorizationEpoch:audience.authorizationEpoch,authorityHash:audience.budgetAuthorityHash}));
    }
    function openSchedulerWorkPolicy(mandateId:string){
        local();if(!store)throw deny();
        return root(holder=>{
            const audience=call<ReturnType<typeof readOriginalDshBudgetObservationAudience>>(holder,'policyAudience',readOriginalDshBudgetObservationAudience,[realm,store,realm,mandateId]);
            const pure=()=>{local();audience.assertLocal();local();};
            const current=()=>root(next=>{pure();call(next,'policyCurrent',audience.assertCurrent,[],true);pure();});
            current();
            const policyInput=parseDshInput('work_policy_sync',{accountId:audience.accountId,maxActiveWorks:audience.maxActiveWorks,maxDraftRequestsPerWork:audience.maxDraftRequestsPerWork});
            const policyProof=freeze(create(null));apply(set,frames,[policyProof,{purpose:'work_policy_sync',data:policyInput,authority:schedulerAuthority(audience),actor:null,current,local:pure}]);
            pure();return freeze(assign(create(null),{policyInput,policyProof}));
        });
    }
    function originalSettlement(holder:Record<string,unknown>,originalBasis:object,runtime:object){
        if(!store)throw deny();
        const settlement=call<ReturnType<typeof readOriginalMainDshBusinessSettlement>>(holder,'settlement',readOriginalMainDshBusinessSettlement,[originalBasis,realm,store,runtime,source]);
        call(holder,'settlementKnown',settlement.assertKnown,[],true);
        const output=captureIpcData(settlement.observation.output) as Record<string,unknown>;
        const basis=output.basis as Record<string,unknown>|undefined;
        const receipt=(basis?.commandReceipt??output.receipt) as Record<string,unknown>|undefined;
        const command=settlement.command;
        if(!receipt||receipt.kind!=='dsh_command'||receipt.result!=='applied'&&receipt.result!=='blocked'||receipt.commandId!==command.commandId||receipt.operationKey!==command.operationKey||receipt.semanticPayloadHash!==command.semanticPayloadHash||dshAJson(receipt.command)!==dshAJson(command))throw deny();
        return {settlement,receipt,command};
    }
    function openDraftWorkRead(originalBasis:object,runtime:object){
        local();if(!store)throw deny();
        return root(holder=>{
            const {command}=originalSettlement(holder,originalBasis,runtime);
            const audience=call<ReturnType<typeof readOriginalDshBudgetSettlementAudience>>(holder,'workReadAudience',readOriginalDshBudgetSettlementAudience,[realm,store,realm,originalBasis,runtime,source]);
            const pure=()=>{local();audience.assertLocal();local();};
            const current=()=>root(next=>{pure();call(next,'workReadCurrent',audience.assertCurrent,[],true);pure();});
            const readInput=parseDshInput('work_read',{accountId:audience.accountId,bindingId:command.bindingId,generation:command.generation,operationKey:command.operationKey,semanticPayloadHash:command.semanticPayloadHash,purpose:command.action==='prepare_draft'?'draft_prepare':'draft_admission'});
            const readProof=freeze(create(null));apply(set,frames,[readProof,{purpose:'work_read',data:readInput,authority:schedulerAuthority(audience),actor:null,current,local:pure}]);
            current();pure();return freeze(assign(create(null),{readInput,readProof}));
        });
    }
    async function join<T>(holder:Record<string,unknown>,name:string,fn:Function,receiver:unknown,args:unknown[]):Promise<{value:T}>{
        const owner=create(null);define(holder,String(++sdkSequence),{__proto__:null,value:owner,enumerable:true} as PropertyDescriptor);define(owner,'label',{__proto__:null,value:name,enumerable:true} as PropertyDescriptor);let raw:unknown;
        try{raw=apply(fn,receiver,args);define(owner,'raw',{__proto__:null,value:raw,enumerable:true} as PropertyDescriptor);inventory(raw);assertStandardIpcPromise(raw,'MAIN_DSH_BUDGET_JOIN_UNKNOWN');}
        catch(error){define(owner,'error',{__proto__:null,value:error,enumerable:true} as PropertyDescriptor);inventory(error);throw error;}
        return new NativePromise((yes,no)=>apply(nativeThen,raw,[(value:T)=>{inventory(value);yes(freeze(assign(create(null),{value})));},(error:unknown)=>{inventory(error);no(error);} ]));
    }
    async function openDraftBinding(originalBasis:object,runtime:object){
        local();if(!store)throw deny();
        let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});roots.add(completion);
        const holder=create(null) as Record<string,unknown>;
        try{
            const original=originalSettlement(holder,originalBasis,runtime);
            const binding=call<ReturnType<typeof readOriginalDshBudgetRuntimeBinding>>(holder,'workRuntime',readOriginalDshBudgetRuntimeBinding,[runtime,source]);
            const request=openDraftWorkRead(originalBasis,runtime);
            const opaque=(await join<object>(holder,'workSnapshot',binding.port.observeWork,binding.port,[request.readInput,request.readProof])).value;
            const work=call<ReturnType<typeof readOriginalDshBudgetWorkSnapshot>>(holder,'workSnapshotRead',readOriginalDshBudgetWorkSnapshot,[binding.port,opaque]);
            if(work.state!=='observed'||!work.reservation||!work.head||!work.attestation)throw deny();
            if(original.settlement.budgetReservation){
                const warm=call<ReturnType<typeof readOriginalDshDraftAdmission>>(holder,'warmWorkReceipt',readOriginalDshDraftAdmission,[binding.port,original.settlement.budgetReservation.receipt]);
                if(warm.reservation.reservation_id!==work.reservation.reservation_id||warm.attestation.attestation_id!==work.attestation.attestation_id)throw deny();
            }
            const native=call<ReturnType<typeof readOriginalMainDshBootstrapAuthority>>(holder,'bookNative',readOriginalMainDshBootstrapAuthority,[realm,store,realm]);
            // Re-read the actual imported A receipt, without reviving the old
            // effect claim or requiring a released user invocation.
            const readHistory=descriptor(realm,'openReadHistory');if(!readHistory||!own(readHistory,'value')||!sync(readHistory.value))throw deny();
            const verifyA=(next:Record<string,unknown>)=>{
                const frame=call<object>(next,'bookHistoryFrame',readHistory.value,[{schemaVersion:1,query:{kind:'command',commandId:original.command.commandId}}]);
                const port=call<ReturnType<typeof readOriginalDshAdmissionPort>>(next,'bookAdmissionPort',readOriginalDshAdmissionPort,[store,realm]);
                const actual=call<Record<string,unknown>>(next,'bookHistory',port.readOperation,[frame,{requestSource:'scheduler'}]);
                const command=actual.command as Record<string,unknown>|null;
                if(actual.ok!==true||!command||dshAJson(command.command)!==dshAJson(original.command))throw deny();
                if(original.receipt.result==='applied'){
                    const accepted=actual.receipt as Record<string,unknown>|null;
                    if(!accepted||dshAJson(accepted.receipt)!==dshAJson(original.receipt))throw deny();
                }
            };
            verifyA(holder);
            const account=work.status.account;
            if(account.owner_id!==binding.ownerId||account.profile_id!==binding.profileId||account.workspace_id!==binding.workspaceId)throw deny();
            const bindInput=parseDshInput('work_bind',{accountId:account.account_id,reservationId:work.reservation.reservation_id,attestationId:work.attestation.attestation_id,operationKey:original.command.operationKey,semanticPayloadHash:original.command.semanticPayloadHash,commandId:original.command.commandId,result:original.receipt.result,ownerWorkId:original.receipt.result==='applied'?original.receipt.ownerWorkId:null});
            const pure=()=>{local();native.assertLocal();binding.assertLocal();local();};
            const current=()=>root(next=>{pure();call(next,'bookKnown',original.settlement.assertKnown,[],true);call(next,'bookNativeCurrent',native.assertCurrent,[],true);verifyA(next);pure();});
            const authority=freeze(assign(create(null),{requestSource:'scheduler',profileId:account.profile_id,workspaceId:account.workspace_id,tenantId:account.tenant_id,mandateId:account.mandate_id,mandateRevision:account.mandate_revision,authorizationEpoch:account.authorization_epoch,authorityHash:account.authority_hash}));
            const bindProof=freeze(create(null));apply(set,frames,[bindProof,{purpose:'work_bind',data:bindInput,authority,actor:null,current,local:pure}]);
            current();pure();return freeze(assign(create(null),{bindInput,bindProof}));
        }catch(error){inventory(error);throw error;}finally{roots.delete(completion);complete();}
    }
    async function openCompletedDraftWork(originalBasis:object,originalCommitted:object,runtime:object,launch:object,modelSource:object,modelToken:object,businessSource:object){
        local();if(!store)throw deny();let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});roots.add(completion);const holder=create(null) as Record<string,unknown>;
        try{
            const binding=call<ReturnType<typeof readOriginalDshBudgetRuntimeBinding>>(holder,'closeRuntime',readOriginalDshBudgetRuntimeBinding,[runtime,source]);
            const facts=call<ReturnType<typeof readOriginalMainDshCompletedDraft>>(holder,'completedDraft',readOriginalMainDshCompletedDraft,[originalCommitted,realm,store,runtime,source,modelSource,modelToken]);
            const accepted=call<ReturnType<typeof readOriginalMainDshDraftLaunchBinding>>(holder,'acceptedLaunch',readOriginalMainDshDraftLaunchBinding,[launch,realm,store,runtime,source,businessSource]);
            const modelFate=call<ReturnType<typeof readOriginalDshDraftModelLaunchPhysicalFate>>(holder,'modelFate',readOriginalDshDraftModelLaunchPhysicalFate,[modelSource,launch,realm,store,runtime,source]);
            const rootFate=call<ReturnType<typeof readOriginalMainDshDraftLaunchPhysicalFate>>(holder,'launchFate',readOriginalMainDshDraftLaunchPhysicalFate,[launch,realm,store,runtime,source,businessSource]);
            const candidate=facts.candidate,original=originalSettlement(holder,originalBasis,runtime);
            if(accepted.ownerWorkId!==candidate.ownerWorkId||accepted.draftInvocationId!==candidate.draftInvocationId||accepted.draftCommitKey!==candidate.draftCommitKey||dshAJson(original.command)!==dshAJson(candidate.authority))throw deny();
            await join(holder,'committedFate',facts.waitKnown,facts,[]);await join(holder,'modelFateKnown',modelFate.waitKnown,modelFate,[]);await join(holder,'launchFateKnown',rootFate.waitKnown,rootFate,[]);
            const request=openDraftWorkRead(originalBasis,runtime),opaque=(await join<object>(holder,'closeSnapshot',binding.port.observeWork,binding.port,[request.readInput,request.readProof])).value;
            const work=call<ReturnType<typeof readOriginalDshBudgetWorkSnapshot>>(holder,'closeSnapshotRead',readOriginalDshBudgetWorkSnapshot,[binding.port,opaque]);
            if(work.state!=='observed'||!work.reservation||!work.head||!work.closureBasis||work.head.owner_work_id!==candidate.ownerWorkId||work.reservation.binding_id!==candidate.bindingId)throw deny();
            const account=work.status.account;if(account.owner_id!==binding.ownerId||account.profile_id!==binding.profileId||account.workspace_id!==binding.workspaceId)throw deny();
            const closeInput=parseDshInput('work_close',{accountId:account.account_id,reservationId:work.reservation.reservation_id,closureId:'dsh-work-completion:'+candidate.draftCommitKey,ownerWorkId:candidate.ownerWorkId,commandReceiptsHash:work.closureBasis.commandReceiptsHash,usageHash:work.closureBasis.usageHash});
            const native=call<ReturnType<typeof readOriginalMainDshBootstrapAuthority>>(holder,'closeMain',readOriginalMainDshBootstrapAuthority,[realm,store,realm]);
            const pure=()=>{local();native.assertLocal();binding.assertLocal();facts.assertKnown();modelFate.assertKnown();rootFate.assertKnown();local();};
            const current=()=>root(next=>{pure();call(next,'closeMainCurrent',native.assertCurrent,[],true);pure();});
            const authority=freeze(assign(create(null),{requestSource:'scheduler',profileId:account.profile_id,workspaceId:account.workspace_id,tenantId:account.tenant_id,mandateId:account.mandate_id,mandateRevision:account.mandate_revision,authorizationEpoch:account.authorization_epoch,authorityHash:account.authority_hash}));
            const closeProof=freeze(create(null));apply(set,frames,[closeProof,{purpose:'work_close',data:closeInput,authority,actor:null,current,local:pure}]);current();return freeze(assign(create(null),{closeInput,closeProof}));
        }catch(error){inventory(error);throw error;}finally{roots.delete(completion);complete();}
    }
    function resolve(proof:object,purpose:string):Readonly<Record<string,unknown>>|null {
        const row=apply(get,frames,[proof]) as Proof|undefined;if(!row||row.purpose!==purpose)return null;
        return root(()=>{
            row.current();row.local();
            const out=create(null);const names=keys(row.authority);
            for(let i=0;i<names.length;i++)define(out,names[i]!,{__proto__:null,value:row.authority[names[i] as string],enumerable:true} as PropertyDescriptor);
            define(out,'actor',{__proto__:null,value:row.actor,enumerable:true} as PropertyDescriptor);
            define(out,'commandDigest',{__proto__:null,value:dshBudgetCommandDigest(purpose,row.data),enumerable:true} as PropertyDescriptor);
            define(out,'assertCurrent',{__proto__:null,value:row.current,enumerable:true} as PropertyDescriptor);define(out,'assertLocal',{__proto__:null,value:row.local,enumerable:true} as PropertyDescriptor);row.local();return freeze(out);
        });
    }
    function seal(){sealed=true;}
    function drain():Promise<void> {
        if(closing)return closing;seal();
        closing=(async()=>{
            while(roots.size||tails.size){await settleIntrinsicOperations(roots.snapshot(),row=>row);await settleIntrinsicOperations(tails.snapshot(),row=>row);}
            if(unknown.size)throw new NativeError('MAIN_DSH_BUDGET_TAIL_UNKNOWN',{cause:first});
            if(firstPresent)throw first;
        })();return closing;
    }
    const source=freeze(assign(create(null),{bindStore,openUserBudget,openAssessmentBudget,openDraftModelBudget,openDraftAdmission,openSchedulerObservation,openSchedulerWorkPolicy,openDraftWorkRead,openDraftBinding,openCompletedDraftWork,resolve,seal,drain}));apply(set,sources,[source,{actors,realm,store:()=>store,local}]);
    if(storeRow){if(!storeRow.value)throw deny();bindStore(storeRow.value);}
    return source;
}
