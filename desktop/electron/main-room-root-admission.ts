import {readOptionalOriginalWorkflowVmProcessContext,readOptionalOriginalWorkflowVmProcessSourceRequest} from './workflow-script-worker.js';
import {loadOriginalMainResourceAuthority} from '../../src/runtime/verification/original-main-native-loader.js';
import {prepareOriginalMainDshInstalledRootPool,openOriginalMainDshInstalledRootPool,returnOriginalMainDshInstalledRootPool,readOriginalMainDshCoreBootstrap} from './main-dsh-bootstrap-authority.js';
import {installOriginalMainSdkBridge} from '../../src/runtime/verification/original-main-sdk-bridge.js';
import {types} from 'node:util';
import {readOriginalGenericModelSdkPhysicalReceipt} from '../../src/ai/runtime/original-model-sdk-attempt.js';
import {readOptionalOriginalToolProcessPhysicalReceipt} from '../../src/runtime/verification/original-process-sdk.js';
import {readOriginalTaskRunnerResourceContext,readOriginalTaskHostIdentityIO,readOptionalOriginalTaskHostDeliveryWorkerContext} from '../../src/runtime/task-host/task-runtime-host.js';
import {readOptionalOriginalTaskStoreProtectionWorkerContext} from '../../src/runtime/task-host/snapshot-store.js';
import {createIntrinsicSet,aggregateIntrinsicErrors,appendIntrinsic} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {readOriginalProductionRootResourceQualification} from './root-resource-production-qualification.js';
import {readOriginalRoomTurnSourceBinding,readOriginalRoomTurnRuntimeBinding,readOriginalRoomTurnPhysicalFate,readOriginalRoomTurnRoot,assertOriginalRoomTurnRootCurrent,revalidateOriginalRoomTurnRoot,claimOriginalRoomTurnRoot,readOriginalRoomTurnClaim} from './original-room-turn-source.js';
import {cacheOriginalRoomDiscussionAdmission} from './main-room-discussion-binding.js';
import {cacheOriginalMainWorkflowAdmission} from './main-workflow-root-binding.js';
import {cacheOriginalMainAcceptedAdmission} from './main-accepted-root-binding.js';
import * as originalWorkflowResourceSource from './original-workflow-root-source.js';
import {readOriginalWorkflowRootSourceBinding,readOriginalWorkflowScriptRoot,revalidateOriginalWorkflowScriptRoot,readOriginalWorkflowScriptRootSettlement} from './original-workflow-root-source.js';
import {readOriginalKSwarmHandoffRootBinding,readOriginalKSwarmHandoffRoot,assertOriginalKSwarmHandoffRootCurrent,revalidateOriginalKSwarmHandoffRoot,readOriginalKSwarmHandoffRootPhysicalFate} from './kswarm-runtime-bridge.js';
import {readOriginalRoomProjectRootBinding,readOriginalRoomProjectRoot,assertOriginalRoomProjectRootCurrent,revalidateOriginalRoomProjectRoot,readOriginalRoomProjectRootPhysicalFate} from './room-workspace-runtime.js';
import {readOriginalDshAdmissionPort} from './desktop-multi-agent-store.js';
import {readOriginalMainDshDraftCandidate,readOriginalMainDshDraftLaunchPhysicalFate,sealOriginalMainDshDraftLaunch} from './dsh-draft-root-source.js';
import {readOriginalMainDshBusinessSource} from './main-dsh-business-source.js';
import {readOriginalDshBudgetRuntimeBinding} from './harness-optimization-service.js';
import {readOriginalMainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
import {readOriginalDshModelResourceContext,readOriginalDshModelPhysicalReceipt} from './main-dsh-model-source.js';
import {readOptionalOriginalDshDraftModelResourceContext,readOriginalDshDraftModelPhysicalReceipt,readOriginalDshDraftModelLaunchPhysicalFate} from './main-dsh-draft-model-source.js';
import {readOriginalMainModelProbeResourceContext} from './main-model-probe-source.js';
import {readOriginalMainModelProbeServicesBinding} from './desktop-services.js';
import {readOptionalOriginalOfficeProcessSourceRequest} from './office-document-parser.js';
import {readOptionalOriginalPdfWorkerSourceRequest} from './pdf-text.js';
import {readOptionalOriginalCodexProcessSourceRequest} from './codex-process-source.js';
import {readOriginalMainMaterialSourceBinding,readOriginalMainMaterialOperationContext} from './main-material-source.js';
const keys=Reflect.ownKeys;
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,freeze=Object.freeze,create=Object.create,apply=Reflect.apply;
const NativePromise=Promise,nativeThen=Promise.prototype.then,define=Object.defineProperty;
const NativeWeakMap=WeakMap,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
interface DshTuple {realm:object;store:object;runtime:object;budgetSource:object;owner:OriginalMainRootAdmissionOwner;current():void}
interface OwnerState {initialize(realm?:object,store?:object):Promise<void>;assertComposition():OriginalMainPhysicalCompositionView;local():void;rootContext(reservation:object):object;bindModelProbe(source:object,services:object):void;bindMaterial(source:object,services:object):void;bindWorkflow(service:object):Promise<OriginalMainWorkflowAdmissionPort>;bindAccepted(kind:'kswarm_direct'|'room_project',producer:object,service:object):Promise<OriginalMainAcceptedRootPort>;draftPort(tuple:DshTuple,businessSource:object):OriginalMainDshDraftAdmissionPort}
const ownerStates=new NativeWeakMap<object,OwnerState>();
const dshTuples=createIntrinsicSet<DshTuple>();
/** A fixed original producer binding, never a user/model registration API. */
export function bindOriginalMainModelProbeAdmission(owner:unknown,userSource:object,services:object):void {
 const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
 if(!state)throw denied();state.bindModelProbe(userSource,services);
}
/** Fixed original material producer only; no caller verifier or class registration. */
export function bindOriginalMainMaterialAdmission(owner:unknown,materialSource:object,services:object):void {
 const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
 if(!state)throw denied();state.bindMaterial(materialSource,services);
}
export interface OriginalMainAcceptedRootPort {
    enqueue(proof:object):Promise<unknown>;
    awaitLaunch(proof:object):Promise<object>;
    cancelQueued(proof:object):Promise<void>;
    finish(proof:object,physicalReceipt:object):Promise<void>;
}
export interface OriginalMainDshDraftAdmissionPort extends OriginalMainAcceptedRootPort {cancelQueued(proof:object):Promise<void>}
const acceptedBindings=new NativeWeakMap<object,{owner:object;service:object;kind:'kswarm_direct'|'room_project';port:OriginalMainAcceptedRootPort}>();
async function bindAcceptedOwner(owner:unknown,kind:'kswarm_direct'|'room_project',producer:object,service:object):Promise<void> {
    const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
    if(!state)throw denied();
    const previous=apply(weakGet,acceptedBindings,[producer]) as {owner:object;service:object;kind:string}|undefined;
    if(previous){if(previous.owner!==owner||previous.service!==service||previous.kind!==kind)throw denied();state.local();await cacheOriginalMainAcceptedAdmission(kind,producer,service);return;}
    const port=await state.bindAccepted(kind,producer,service);
    apply(weakSet,acceptedBindings,[producer,{owner:owner as object,service,kind,port}]);
    await cacheOriginalMainAcceptedAdmission(kind,producer,service);
}
export function bindOriginalMainDirectAdmission(owner:unknown,bridge:object,service:object):Promise<void>{return bindAcceptedOwner(owner,'kswarm_direct',bridge,service);}
export function bindOriginalMainRoomProjectAdmission(owner:unknown,runtime:object,service:object):Promise<void>{return bindAcceptedOwner(owner,'room_project',runtime,service);}
function readAcceptedBinding(producer:unknown,service:unknown,kind:'kswarm_direct'|'room_project'):OriginalMainAcceptedRootPort {
    const binding=apply(weakGet,acceptedBindings,[producer]) as {owner:object;service:object;kind:string;port:OriginalMainAcceptedRootPort}|undefined;
    if(!binding||binding.service!==service||binding.kind!==kind)throw Error('ROOT_RESOURCE_ORIGINAL_ACCEPTED_BINDING_REQUIRED');
    const state=apply(weakGet,ownerStates,[binding.owner]) as OwnerState|undefined;
    if(!state)throw denied();state.local();return binding.port;
}
export function readOriginalMainDirectAdmission(bridge:unknown,service:unknown):OriginalMainAcceptedRootPort{return readAcceptedBinding(bridge,service,'kswarm_direct');}
export function readOriginalMainRoomProjectAdmission(runtime:unknown,service:unknown):OriginalMainAcceptedRootPort{return readAcceptedBinding(runtime,service,'room_project');}
export interface OriginalMainWorkflowAdmissionPort {
    enqueueWorkflow(proof:object):Promise<unknown>;
    awaitWorkflowLaunch(proof:object):Promise<object>;
    finishWorkflow(proof:object):Promise<void>;
    acquireWorkflowProcess(proof:object,invocationId:string,specHash:string):Promise<object>;
    consumeWorkflowProcess(proof:object,permit:object):void;
    settleWorkflowProcess(proof:object,permit:object,receipt:object):Promise<void>;
    cancelWorkflowProcess(proof:object,permit:object):Promise<void>;
}
const workflowBindings=new NativeWeakMap<object,{owner:object;port:OriginalMainWorkflowAdmissionPort}>();
export async function bindOriginalMainWorkflowAdmission(owner:unknown,service:object):Promise<void> {
    const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
    if(!state)throw denied();
    const previous=apply(weakGet,workflowBindings,[service]) as {owner:object;port:OriginalMainWorkflowAdmissionPort}|undefined;
    if(previous){if(previous.owner!==owner)throw denied();state.local();return;}
    const port=await state.bindWorkflow(service);
    apply(weakSet,workflowBindings,[service,{owner:owner as object,port}]);
    await cacheOriginalMainWorkflowAdmission(service);
}
export function readOriginalMainWorkflowAdmission(service:unknown):OriginalMainWorkflowAdmissionPort {
    const row=apply(weakGet,workflowBindings,[service]) as {owner:object;port:OriginalMainWorkflowAdmissionPort}|undefined;
    if(!row)throw Error('ROOT_RESOURCE_WORKFLOW_COMPOSITION_REQUIRED');
    const state=apply(weakGet,ownerStates,[row.owner]) as OwnerState|undefined;
    if(!state)throw denied();state.local();return row.port;
}
export interface OriginalMainPhysicalCompositionView {
    readonly kind:'original_main_physical_composition_v1';
    readonly profile:'isolated_native_fixture'|'installed_production';
    readonly productionQualified:boolean;
}
export interface OriginalMainPhysicalPort {
    acquireModel(context:object,attemptId:string,bodyHash:string):Promise<object>;
    consumeModel(permit:object):void;
    assertModelCurrent(permit:object):void;
    assertModelLocal(permit:object):void;
    settleModel(permit:object,physicalReceipt:object):Promise<void>;
    cancelModel(permit:object):Promise<void>;
    acquireProcess(context:object,invocationId:string,specHash:string):Promise<object>;
    consumeProcess(permit:object):void;
    assertProcessCurrent(permit:object):void;
    assertProcessLocal(permit:object):void;
    settleProcess(permit:object,physicalReceipt:object):Promise<void>;
    cancelProcess(permit:object):Promise<void>;
    readProcessSourceRequest(ticket:unknown):import('../../src/runtime/verification/original-process-source-types.js').OriginalProcessSourceRequest|null;
    prepareReadonlyLeaf(permit:object,specCanonical:string):Promise<void>;
    waitReadonlyLeafReady(permit:object):Promise<object>;
    bindReadonlyLeaf(permit:object,ready:object):Promise<void>;
    goReadonlyLeaf(permit:object):Promise<void>;
    cancelReadonlyLeaf(permit:object):Promise<void>;
    waitReadonlyLeafClosed(permit:object):Promise<{stdout:string;stderr:string;exitCode:number;signal:number;timedOut:boolean}>;

}
/** Only an already consumed, original reservation can create this carrier.
 * Core may propagate it, but every consumer still checks this private owner. */
export function readOriginalMainRootExecutionContext(owner:unknown,reservation:object):object {
    const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
    if(!state)throw denied();return state.rootContext(reservation);
}
function findDshTuple(realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):DshTuple {
    const rows=dshTuples.snapshot();
    for(let i=0;i<rows.length;i++){
        const row=rows[i]!;
        if(row.realm===realm&&row.store===store&&row.runtime===runtime&&row.budgetSource===budgetSource)return row;
    }
    throw Error('ROOT_RESOURCE_DSH_COMPOSITION_REQUIRED');
}
/** Fixed original composition, never a caller-supplied verifier or profile.
 * The C fixture distinction is compile-time and the same original session is
 * checked on each use. This view is not an all14 product qualification. */
export function assertOriginalMainDshPhysicalComposition(realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):OriginalMainPhysicalCompositionView {
    const tuple=findDshTuple(realm,store,runtime,budgetSource);
    const state=apply(weakGet,ownerStates,[tuple.owner]) as OwnerState|undefined;
    if(!state)throw denied();
    tuple.current();return state.assertComposition();
}
export function readOriginalMainDshPhysicalPort(realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):OriginalMainPhysicalPort {
    const tuple=findDshTuple(realm,store,runtime,budgetSource);
    const state=apply(weakGet,ownerStates,[tuple.owner]) as OwnerState|undefined;
    if(!state)throw denied();state.local();return tuple.owner.physical;
}
/** Fixed same-session draft facet. A read-only/cold ID cannot instantiate it. */
export function readOriginalMainDshDraftAdmission(realm:object,store:object,runtime:object,budgetSource:object,businessSource:object):OriginalMainDshDraftAdmissionPort {
 const tuple=findDshTuple(realm,store,runtime,budgetSource),state=apply(weakGet,ownerStates,[tuple.owner]) as OwnerState|undefined;
 if(!state)throw denied();readOriginalMainDshBusinessSource(businessSource,realm,runtime,budgetSource,store);tuple.current();state.local();return state.draftPort(tuple,businessSource);
}
export async function bindOriginalMainDshPhysicalPort(owner:unknown,realm:object,store:object,runtime:object,budgetSource:object):Promise<void> {
    const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
    if(!state)throw denied();
    state.local();
    readOriginalDshAdmissionPort(store,realm);
    const source=readOriginalMainDshBudgetAuthoritySource(budgetSource,realm,store);
    const budget=readOriginalDshBudgetRuntimeBinding(runtime,budgetSource);
    source.assertLocal();budget.assertLocal();
    const existing=dshTuples.snapshot();
    for(let i=0;i<existing.length;i++){
        const row=existing[i]!;
        if(row.owner===owner||row.realm===realm){
            if(row.owner!==owner||row.realm!==realm||row.store!==store||row.runtime!==runtime||row.budgetSource!==budgetSource)throw Error('ROOT_RESOURCE_DSH_COMPOSITION_ALREADY_BOUND');
            state.assertComposition();
            const cache=await import('./main-dsh-physical-composition.js');
            await cache.cacheOriginalMainDshPhysicalComposition(realm,store,runtime,budgetSource);return;
        }
    }
    await state.initialize(realm,store);
    state.assertComposition();
    source.assertLocal();budget.assertLocal();state.local();
    // No await or external call between final duplicate check and publication.
    const latest=dshTuples.snapshot();
    for(let i=0;i<latest.length;i++)if(latest[i]!.owner===owner||latest[i]!.realm===realm)throw Error('ROOT_RESOURCE_DSH_COMPOSITION_ALREADY_BOUND');
    dshTuples.add({realm,store,runtime,budgetSource,owner:owner as OriginalMainRootAdmissionOwner,current(){source.assertLocal();budget.assertLocal();}});
    const cache=await import('./main-dsh-physical-composition.js');
    await cache.cacheOriginalMainDshPhysicalComposition(realm,store,runtime,budgetSource);
}
const isProxy=types.isProxy;
const hashPattern=/^[0-9a-f]{64}$/;const exec=RegExp.prototype.exec;
const denied=()=>Error('ROOM_ROOT_ORIGINAL_ADMISSION_REQUIRED');
type Api=Record<string,Function>;
export interface OriginalRoomRootAdmissionPort {
    enqueueRoom(proof:object):Promise<unknown>;
    awaitRoomLaunch(proof:object):Promise<object>;
    readRoomLaunch(proof:object,carrier:object):Readonly<{claimToken:string;claimLeaseUntil:string}>;
    finishRoom(proof:object):Promise<void>;
    cancelRoomLaunch(proof:object):Promise<void>;
    claimNext():Promise<object|null>;
    consumeLaunch(reservation:object):Promise<unknown>;
    cancelQueued(proof:object):Promise<unknown>;
    drain():Promise<void>;
}
const roomDiscussionBindings=new NativeWeakMap<object,{owner:object;source:object;port:OriginalRoomRootAdmissionPort}>();
export async function bindOriginalMainRoomDiscussionAdmission(owner:unknown,runtime:object,source:object):Promise<void> {
    const state=apply(weakGet,ownerStates,[owner]) as OwnerState|undefined;
    if(!state)throw denied();
    readOriginalRoomTurnRuntimeBinding(source,runtime);
    // The room port's source is fixed by this original Owner birth, not scope text.
    if(readOriginalOwnerRoomSource(owner)!==source)throw denied();
    const prior=apply(weakGet,roomDiscussionBindings,[runtime]) as {owner:object;source:object}|undefined;
    if(prior){if(prior.owner!==owner||prior.source!==source)throw denied();state.local();return;}
    state.local();apply(weakSet,roomDiscussionBindings,[runtime,{owner:owner as object,source,port:(owner as OriginalMainRootAdmissionOwner).room}]);
    await cacheOriginalRoomDiscussionAdmission(runtime,source);
}
export function readOriginalMainRoomDiscussionAdmission(runtime:unknown,source:unknown):OriginalRoomRootAdmissionPort {
    const row=apply(weakGet,roomDiscussionBindings,[runtime]) as {owner:object;source:object;port:OriginalRoomRootAdmissionPort}|undefined;
    if(!row||row.source!==source)throw denied();
    const state=apply(weakGet,ownerStates,[row.owner]) as OwnerState|undefined;
    if(!state)throw denied();state.local();return row.port;
}
const ownerRoomSources=new NativeWeakMap<object,object>();
function readOriginalOwnerRoomSource(owner:unknown):object {const source=apply(weakGet,ownerRoomSources,[owner]) as object|undefined;if(!source)throw denied();return source;}
/** One original Native pool and fixed Source/Host/Store tuple. A fixture
 * artifact exercises this composition; product P4 remains independently shut. */
function createOwner(options:{roomSource:object;host:object;store:object}):OriginalMainRootAdmissionOwner {
    if(!options||typeof options!=='object'||isProxy(options))throw denied();
    const fields=['roomSource','host','store'],values:unknown[]=[];
    if(keys(options).length!==3)throw denied();
    for(let i=0;i<fields.length;i++){
        const row=descriptor(options,fields[i]!);
        if(!row||!own(row,'value'))throw denied();
        values[i]=row.value;
    }
    const source=values[0] as object;
    readOriginalRoomTurnSourceBinding(source);
    const hostIO=readOriginalTaskHostIdentityIO(values[1],values[2]);
    const custody=createRoomTurnCustody(),subjects=new NativeWeakMap<object,Row>();
    const rows=createIntrinsicSet<Row>(),reservations=new NativeWeakMap<object,Row>();
    interface Row {executionClass:string;state:string;proof:object;subject:object;hostId:string;key:string;claim?:object;consumed?:boolean;consumeEntered?:boolean;carrier?:object;nativeReservation?:object;finishing?:boolean;finishPromise?:Promise<void>;guardCustody:ReturnType<typeof createRoomTurnCustody>;assertCurrent():void;assertLocal():void;revalidate():Promise<void>}
    // Source SDK awaits may change this private Native projection concurrently.
    function readRootState(row:Row):string{return row.state;}
    let closing=false,closePromise:Promise<void>|undefined,boot:Promise<void>|undefined;
    let api:Api|undefined,issuer:object|undefined,key:object|undefined;
    let installedLease:object|undefined,installedTuple:{realm:object;store:object}|undefined;
    let issuerConsumer:Function|undefined;
    let compositionProfile:OriginalMainPhysicalCompositionView['profile']|undefined;
    const sourceKeys=create(null) as Record<string,object>;
    const methods=create(null) as Api;
    function local(){if(closing)throw Error('ROOM_ROOT_ADMISSION_CLOSED');custody.current();}
    function method(raw:unknown,name:string):Function {
        if(!raw||typeof raw!=='object'||isProxy(raw))throw denied();
        const row=descriptor(raw,name);
        if(!row||!own(row,'value')||typeof row.value!=='function'||isProxy(row.value))throw denied();
        return row.value;
    }
    function initialize(realm?:object,store?:object):Promise<void>{
        if(realm!==undefined||store!==undefined){
            if(!realm||!store)throw denied();
            if(installedTuple){if(installedTuple.realm!==realm||installedTuple.store!==store)throw denied();}
            else installedTuple={realm,store};
        }
        if(boot)return boot;
        boot=custody.root(async()=>{
            const native=await custody.sdk<Api>(loadOriginalMainResourceAuthority,undefined,[],{
                accept(value){return !!value&&typeof value==='object'&&!isProxy(value);},
                consumer:initialBuildInfo,
            });
            // No caller path/SDK/verifier. The fixed module is captured once.
            api=native;
            const names=['takeOriginalModelSdkBridgeKey','assertOriginalModelSdkBridge','buildInfo','openOriginalMainIssuer','bootstrapOriginalMainPool','installFresh','takeOriginalRoomDiscussionSourceKey','importOriginalRoomTurnSubject','enqueue','claimNext','consumeLaunch','cancelQueued','finishOriginalRoot','close','assertOriginalMainIssuerCurrent','importOriginalPhysicalContext','enqueueOriginalModel','claimOriginalModel','settleOriginalModel','enqueueOriginalProcess','enqueueOriginalWorkflowVmProcess','claimOriginalProcess','settleOriginalProcess','prepareOriginalReadonlyLeaf','waitOriginalReadonlyLeafReady','bindOriginalReadonlyLeaf','goOriginalReadonlyLeaf','cancelOriginalReadonlyLeaf','waitOriginalReadonlyLeafClosed','takeOriginalRoomProjectSourceKey','takeOriginalKSwarmDirectSourceKey','takeOriginalWorkflowRootSourceKey','takeOriginalDshDraftSourceKey','importOriginalWorkflowRootSubject','importOriginalKSwarmTaskSubject','importOriginalRoomProjectSubject','importOriginalDshDraftSubject'];
            for(let i=0;i<names.length;i++)methods[names[i]!]=method(native,names[i]!);
            const info=await custody.consumeResource<Record<string,unknown>>(initialBuildInfo,native,[]);
            if(info.buildKind==='fixture')compositionProfile='isolated_native_fixture';
            else if(readOriginalProductionRootResourceQualification().qualified)compositionProfile='installed_production';
            else throw Error('ROOM_ROOT_P4_UNAVAILABLE');
            local();
            if(compositionProfile==='installed_production'){
                if(!installedTuple)throw Error('ROOM_ROOT_INSTALLED_ORIGINAL_AUTHORITY_REQUIRED');
                installedLease=await custody.sdk<object>(prepareOriginalMainDshInstalledRootPool,undefined,[installedTuple.realm,installedTuple.store],{
                    accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:returnOriginalMainDshInstalledRootPool,
                });
                local();issuerConsumer=returnOriginalMainDshInstalledRootPool;
                issuer=await custody.sdk<object>(openOriginalMainDshInstalledRootPool,undefined,[installedLease],{
                    accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:issuerConsumer,
                });
            }else{
                issuerConsumer=methods.close!;
                issuer=await custody.sdk<object>(methods.openOriginalMainIssuer!,api,[],{
                    accept(value){return !!value&&typeof value==='object'&&!isProxy(value);},consumer:issuerConsumer,
                });
            }
            const bootstrap=installedLease?await custody.sdk<unknown>(readOriginalMainDshCoreBootstrap,undefined,[installedLease,issuer]):await custody.sdk<unknown>(methods.bootstrapOriginalMainPool!,api,[issuer]);
            if(bootstrap!=='fresh'&&bootstrap!=='restored')throw Error('ROOM_ROOT_POOL_BOOTSTRAP_UNCONFIRMED');
            key=await custody.sdk<object>(methods.takeOriginalRoomDiscussionSourceKey!,api,[issuer]);
            sourceKeys.room_discussion=key;
            const keyNames=[['room_project','takeOriginalRoomProjectSourceKey'],['kswarm_direct','takeOriginalKSwarmDirectSourceKey'],['workflow_root','takeOriginalWorkflowRootSourceKey'],['dsh_draft','takeOriginalDshDraftSourceKey'],['admission_probe','takeOriginalAdmissionProbeSourceKey'],['live_preview','takeOriginalLivePreviewSourceKey'],['main_turn','takeOriginalMainTurnSourceKey'],['goal_turn','takeOriginalGoalTurnSourceKey'],['nested_subagent','takeOriginalNestedSubagentSourceKey'],['snapshot_prep','takeOriginalSnapshotPrepSourceKey'],['tool_worker','takeOriginalToolWorkerSourceKey'],['material_turn','takeOriginalMaterialTurnSourceKey'],['canvas_turn','takeOriginalCanvasTurnSourceKey']] as const;
            for(let i=0;i<keyNames.length;i++){
                const [kind,name]=keyNames[i]!;
                methods[name]=method(native,name);
                sourceKeys[kind]=await custody.sdk<object>(methods[name]!,api,[issuer]);
            }
            local();
            const sdkBridgeKey=await custody.sdk<object>(methods.takeOriginalModelSdkBridgeKey!,api,[issuer,physical]);
            await custody.sdk(installOriginalMainSdkBridge,undefined,[sdkBridgeKey,physical]);
            local();
        });
        return boot;
    }
    // The namespace resource has a fixed consumer before its first return.
    // Its actual buildInfo method is obtained only from the original module.
    function initialBuildInfo(this:unknown){return apply(method(this,'buildInfo'),this,[]);}
    const hostIdentity=async()=>{
        const identity=await custody.sdk<Awaited<ReturnType<typeof hostIO.read>>>(hostIO.read,hostIO,[]);
        if(!identity)throw Error('ROOM_ROOT_HOST_IDENTITY_REQUIRED');
        return identity.hostId;
    };
    const current=(proof:object)=>{local();assertOriginalRoomTurnRootCurrent(source,proof);};
    interface PhysicalRow {
        kind:'model'|'process';context:object;attemptId:string;hash:string;
        tuple?:DshTuple;draftModel?:true;nativeParent?:object|null;fate:Promise<void>;key?:string;nativePermit?:object;permit?:object;
        used:boolean;settled:boolean;guardCustody:ReturnType<typeof createRoomTurnCustody>;leafCustodies:ReturnType<typeof createIntrinsicSet<ReturnType<typeof createRoomTurnCustody>>>;view:{assertCurrent():void;assertLocal():void};
        grant(value:object):void;deny(error:unknown):void;finish():void;
    }
    const executionContexts=new NativeWeakMap<object,{row:Row;nativeParent:object}>();
    function rootContext(reservation:object):object {
        const row=apply(weakGet,reservations,[reservation]) as Row|undefined;
        if(!row||!row.consumed||row.nativeReservation!==reservation)throw Error('ROOT_RESOURCE_CONSUMED_PARENT_REQUIRED');
        row.assertCurrent();
        if(!row.carrier){row.carrier=freeze(create(null));apply(weakSet,executionContexts,[row.carrier,{row,nativeParent:reservation}]);}
        return row.carrier!;
    }
    const physicalRows=createIntrinsicSet<PhysicalRow>();
    const physicalPermits=new NativeWeakMap<object,PhysicalRow>();
    const physicalAttempts=new NativeWeakMap<object,Map<string,PhysicalRow>>();
    interface PhysicalAcquisition {kind:'model'|'process';row?:PhysicalRow;nativeEnqueueEntered:boolean;completed:boolean;rejected:boolean;guardCustody:ReturnType<typeof createRoomTurnCustody>}
    // Exact original returned Promise identity only. This is a negative
    // observation of the existing attempt, never another permit or counter.
    const physicalAcquisitions=new NativeWeakMap<object,PhysicalAcquisition>();
    let modelProbeBinding:{source:object;services:object}|undefined;
    let materialBinding:{source:object;services:object}|undefined;
    function bindMaterial(materialSource:object,services:object):void {
        local();const view=readOriginalMainMaterialSourceBinding(materialSource,services),scope=readOriginalRoomTurnSourceBinding(source).scope;
        if(view.storageScope.profileId!==scope.profileId||view.storageScope.workspaceId!==scope.workspaceId||view.principalId!=='desktop-user:'+scope.profileId)throw Error('ROOT_RESOURCE_MATERIAL_SCOPE_MISMATCH');
        if(materialBinding){if(materialBinding.source!==materialSource||materialBinding.services!==services)throw Error('ROOT_RESOURCE_MATERIAL_ALREADY_BOUND');return;}
        materialBinding={source:materialSource,services};
    }
    function bindModelProbe(userSource:object,services:object):void {
        local();const view=readOriginalMainModelProbeServicesBinding(services,userSource),scope=readOriginalRoomTurnSourceBinding(source).scope;
        if(view.storageScope.profileId!==scope.profileId||view.storageScope.workspaceId!==scope.workspaceId||view.principalId!=='desktop-user:'+scope.profileId)throw Error('ROOT_RESOURCE_MODEL_PROBE_SCOPE_MISMATCH');
        if(modelProbeBinding){if(modelProbeBinding.source!==userSource||modelProbeBinding.services!==services)throw Error('ROOT_RESOURCE_MODEL_PROBE_ALREADY_BOUND');return;}
        modelProbeBinding={source:userSource,services};
    }
    const mapGet=Map.prototype.get,mapSet=Map.prototype.set;
    let pump:Promise<void>|undefined,pumpAgain=false;
    const bindPromise=<T>(raw:Promise<T>):Promise<T>=>{define(raw,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);return raw;};
    function assertComposition():OriginalMainPhysicalCompositionView {
        local();
        if(!issuer||!compositionProfile)throw Error('ROOT_RESOURCE_DSH_COMPOSITION_REQUIRED');
        custody.syncVoid(methods.assertOriginalMainIssuerCurrent!,api,[issuer]);
        local();return freeze({kind:'original_main_physical_composition_v1',profile:compositionProfile,productionQualified:compositionProfile==='installed_production'});
    }
    function rowCurrent(row:PhysicalRow){
        local();
        row.guardCustody.syncVoid(row.view.assertCurrent,undefined,[]);
        row.guardCustody.syncVoid(row.view.assertLocal,undefined,[]);local();
    }
    function resolvePhysical(context:object):{view:PhysicalRow['view'];tuple?:DshTuple;draftModel?:true;pOnly?:true;modelOnly?:true;workflowVm?:true;claimAttempt?:(id:string,hash:string)=>void;executionClass:string;executionRef:string;scope:{profileId:string;workspaceId:string;principalId:string};parent:object|null} {
        const originalParent=apply(weakGet,executionContexts,[context]) as {row:Row;nativeParent:object}|undefined;
        if(originalParent){
            const parent=originalParent.row;
            if(!parent.consumed||parent.state==='released'||parent.finishing)throw Error('ROOT_RESOURCE_CONSUMED_PARENT_REQUIRED');
            parent.assertLocal();
            const binding=readOriginalRoomTurnSourceBinding(source);
            return {view:{assertCurrent:parent.assertCurrent,assertLocal:parent.assertLocal},executionClass:parent.executionClass,executionRef:parent.key,scope:{...binding.scope,principalId:'desktop-user:'+binding.scope.profileId},parent:originalParent.nativeParent};
        }
        const vm=readOptionalOriginalWorkflowVmProcessContext(context);
        if(vm){
            const inherited=apply(weakGet,executionContexts,[vm.parentRef]) as {row:Row;nativeParent:object}|undefined;
            if(!inherited||inherited.row.executionClass!=='workflow_root'||!inherited.row.consumed||inherited.row.state==='released'||inherited.row.finishing)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');
            const parent=inherited.row;
            const joined={assertCurrent(){local();parent.assertCurrent();vm.assertCurrent();parent.assertLocal();vm.assertLocal();local();},assertLocal(){local();if(parent.state==='released'||parent.finishing)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');parent.assertLocal();vm.assertLocal();local();}};
            joined.assertLocal();const binding=readOriginalRoomTurnSourceBinding(source);
            return {view:joined,pOnly:true,workflowVm:true,claimAttempt:vm.assertAttempt,executionClass:'workflow_root',executionRef:parent.key+':'+vm.executionRef,scope:{...binding.scope,principalId:'desktop-user:'+binding.scope.profileId},parent:inherited.nativeParent};
        }
        const readonlyWorker=readOptionalOriginalTaskHostDeliveryWorkerContext(context,values[1],values[2])??readOptionalOriginalTaskStoreProtectionWorkerContext(context,values[2]);
        if(readonlyWorker){
            let parent:object|null=null,capturedParent:Row|undefined;
            if(readonlyWorker.parentRef!==null){
                const inherited=apply(weakGet,executionContexts,[readonlyWorker.parentRef]) as {row:Row;nativeParent:object}|undefined;
                if(!inherited)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');
                capturedParent=inherited.row;parent=inherited.nativeParent;
            }
            // These two original finite reads run after the runner withdraws.
            // Their own producer stays live; cleanup never regrants effects on
            // the business Source that has already been revoked.
            const parentLocal=()=>{local();if(capturedParent&&(!capturedParent.consumed||capturedParent.state==='released'||capturedParent.finishing))throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');};
            const view={assertCurrent(){parentLocal();readonlyWorker.assertCurrent();parentLocal();},assertLocal(){parentLocal();readonlyWorker.assertLocal();parentLocal();}};
            view.assertLocal();const binding=readOriginalRoomTurnSourceBinding(source);
            return {view,pOnly:true,executionClass:'snapshot_prep',executionRef:readonlyWorker.taskId,scope:{...binding.scope,principalId:'desktop-user:'+binding.scope.profileId},parent};
        }
        if(materialBinding){
            const material=readOriginalMainMaterialOperationContext(context,materialBinding.source,materialBinding.services);
            if(material){
                const expected=readOriginalRoomTurnSourceBinding(source).scope;
                if(material.scope.profileId!==expected.profileId||material.scope.workspaceId!==expected.workspaceId||material.scope.principalId!=='desktop-user:'+expected.profileId)throw Error('ROOT_RESOURCE_MATERIAL_SCOPE_MISMATCH');
                material.assertCurrent();material.assertLocal();
                return {view:material,pOnly:true,executionClass:'material_turn',executionRef:material.executionRef,scope:material.scope,parent:null};
            }
        }
        if(modelProbeBinding){
            const probe=readOriginalMainModelProbeResourceContext(context,modelProbeBinding.source,modelProbeBinding.services);
            if(probe){
                const expected=readOriginalRoomTurnSourceBinding(source).scope;
                if(probe.scope.profileId!==expected.profileId||probe.scope.workspaceId!==expected.workspaceId||probe.scope.principalId!=='desktop-user:'+expected.profileId)throw Error('ROOT_RESOURCE_MODEL_PROBE_SCOPE_MISMATCH');
                probe.assertCurrent();probe.assertLocal();
                return {view:probe,modelOnly:true,claimAttempt:probe.claimAttempt,executionClass:'admission_probe',executionRef:probe.executionRef,scope:probe.scope,parent:null};
            }
        }
        const all=dshTuples.snapshot();
        for(let i=0;i<all.length;i++){
            const tuple=all[i]!;
            if(tuple.owner!==owner)continue;
            const draft=readOptionalOriginalDshDraftModelResourceContext(context,tuple.realm,tuple.store,tuple.runtime,tuple.budgetSource);
            if(draft){
                const parent=apply(weakGet,executionContexts,[draft.parentRef]) as {row:Row;nativeParent:object}|undefined;
                if(!parent||parent.row.executionClass!=='dsh_draft'||!parent.row.consumed||parent.row.state==='released'||parent.row.finishing)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');
                tuple.current();parent.row.assertCurrent();draft.assertCurrent();
                return {view:draft,tuple,draftModel:true as const,executionClass:'dsh_draft',executionRef:draft.executionRef,scope:draft.scope,parent:parent.nativeParent};
            }
            // The fixed private reader checks token membership before fields.
            try {
                const view=readOriginalDshModelResourceContext(context,tuple.realm,tuple.store,tuple.runtime,tuple.budgetSource);
                tuple.current();return {view,tuple,executionClass:view.executionClass,executionRef:view.executionRef,scope:view.scope,parent:null};
            } catch(error) {
                // Do not turn a genuine current failure into a Host fallback.
                // The Host private reader also cannot accept a Model token.
                custody.inventory(error);
                const message=error&&typeof error==='object'&&!isProxy(error)?descriptor(error,'message'):undefined;
                if(!message||!own(message,'value')||message.value!=='DSH_MODEL_RESOURCE_CONTEXT_REQUIRED')throw error;
            }
        }
        const view=readOriginalTaskRunnerResourceContext(context,values[1],values[2]);
        let parentView=view;
        const seen=createIntrinsicSet<object>();
        while(parentView.parentContext){
            if(seen.has(parentView.parentContext)||seen.size>=128)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');
            seen.add(parentView.parentContext);
            parentView=readOriginalTaskRunnerResourceContext(parentView.parentContext,values[1],values[2]);
        }
        const parentRef=(parentView as typeof parentView&{readonly parentRef?:object}).parentRef;
        let parent:object|null=null,capturedParent:Row|undefined;
        let executionClass:string=view.executionClass;
        if(parentRef!==undefined){
            const inherited=apply(weakGet,executionContexts,[parentRef]) as {row:Row;nativeParent:object}|undefined;
            if(!inherited||!inherited.row.consumed||inherited.row.state==='released'||inherited.row.finishing)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');
            inherited.row.assertCurrent();parent=inherited.nativeParent;capturedParent=inherited.row;
            if(view.executionClass==='main_turn'||view.executionClass==='goal_turn')executionClass=inherited.row.executionClass;
        }
        const binding=readOriginalRoomTurnSourceBinding(source);
        const parentLocal=()=>{if(capturedParent){if(!capturedParent.consumed||capturedParent.state==='released'||capturedParent.finishing)throw Error('ROOT_RESOURCE_PARENT_CONTEXT_UNBOUND');capturedParent.assertLocal();}};
        // Keep the original parent Source as part of every later current cut,
        // including after an asynchronous wait in the shared M/P queue.
        const joinedView={assertCurrent(){view.assertCurrent();if(capturedParent)capturedParent.assertCurrent();view.assertLocal();parentLocal();},assertLocal(){view.assertLocal();parentLocal();view.assertLocal();}};
        return {view:joinedView,executionClass,executionRef:view.taskId,scope:{...binding.scope,principalId:'desktop-user:'+binding.scope.profileId},parent};
    }
    function requestPump():Promise<void> {
        if(pump){pumpAgain=true;return pump;}
        const raw=custody.root(async()=>{
            do {
                pumpAgain=false;
                for(const kind of ['model','process'] as const){
                    for(;;){
                        const snapshot=physicalRows.snapshot();
                        let queued=false;
                        for(let i=0;i<snapshot.length;i++){
                            const row=snapshot[i]!;
                            if(row.kind===kind&&row.key&&!row.nativePermit&&!row.settled)queued=true;
                        }
                        if(!queued)break;
                        const result=await custody.sdk<any>(methods[kind==='model'?'claimOriginalModel':'claimOriginalProcess']!,api,[issuer]);
                        if(!result)break;
                        let row:PhysicalRow|undefined;
                        for(let i=0;i<snapshot.length;i++)if(snapshot[i]!.key===result.record.executionKey&&snapshot[i]!.kind===kind){row=snapshot[i];break;}
                        if(!row||row.nativePermit)throw Error('ROOT_RESOURCE_PHYSICAL_CLAIM_UNCONFIRMED');
                        row.nativePermit=result.permit;
                        try{rowCurrent(row);}catch(error){
                            // No public permit or SDK entry was issued. Claim
                            // and close only this exact original queued row;
                            // a withdrawn Source cannot strand sibling queues.
                            row.used=true;
                            try{
                                await row.guardCustody.waitPhysicalKnown();
                                await custody.sdk(methods[kind==='model'?'settleOriginalModel':'settleOriginalProcess']!,api,[issuer,row.nativePermit]);
                                row.settled=true;physicalRows.delete(row);row.finish();row.deny(error);
                            }catch(cleanup){const failure=aggregateIntrinsicErrors([error,cleanup],'ROOT_RESOURCE_NOT_STARTED_SETTLEMENT_UNCONFIRMED');define(failure,'cause',{__proto__:null,value:error,configurable:true,writable:true} as PropertyDescriptor);row.deny(failure);throw failure;}
                            continue;
                        }
                        const permit=freeze(create(null));row.permit=permit;
                        apply(weakSet,physicalPermits,[permit,row]);row.grant(permit);
                    }
                }
            } while(pumpAgain);
        });
        pump=raw;
        apply(nativeThen,raw,[()=>{pump=undefined;},(error:unknown)=>{
            pump=undefined;const all=physicalRows.snapshot();
            for(let i=0;i<all.length;i++)if(!all[i]!.permit)all[i]!.deny(error);
        }]);
        return raw;
    }
    function acquire(kind:'model'|'process',context:object,attemptId:string,hash:string):Promise<object> {
        local();
        const acquisition:PhysicalAcquisition={kind,nativeEnqueueEntered:false,completed:false,rejected:false,guardCustody:createRoomTurnCustody()};
        const raw=custody.root(async()=>{
          try{
            let facts!:ReturnType<typeof resolvePhysical>;
            acquisition.guardCustody.syncVoid(()=>{facts=resolvePhysical(context);},undefined,[]);
            if(kind==='model'&&facts.pOnly)throw Error('ROOT_RESOURCE_MODEL_CONTEXT_REQUIRED');
            if(kind==='process'&&facts.modelOnly)throw Error('ROOT_RESOURCE_PROCESS_CONTEXT_REQUIRED');
            if(kind==='process'&&facts.tuple)throw Error('ROOT_RESOURCE_PROCESS_CONTEXT_REQUIRED');
            if(typeof attemptId!=='string'||!attemptId||typeof hash!=='string'||apply(exec,hashPattern,[hash])===null||facts.tuple&&facts.executionRef!==attemptId)throw denied();
            let prior=apply(weakGet,physicalAttempts,[context]) as Map<string,PhysicalRow>|undefined;
            if(prior&&apply(mapGet,prior,[kind+':'+attemptId]))throw Error('ROOT_RESOURCE_PHYSICAL_ATTEMPT_ALREADY_ENTERED');
            if(facts.tuple){const view=facts.draftModel?readOptionalOriginalDshDraftModelResourceContext(context,facts.tuple.realm,facts.tuple.store,facts.tuple.runtime,facts.tuple.budgetSource):readOriginalDshModelResourceContext(context,facts.tuple.realm,facts.tuple.store,facts.tuple.runtime,facts.tuple.budgetSource);if(!view||view.bodyHash!==hash)throw denied();}
            let grant!:(value:object)=>void,deny!:(error:unknown)=>void,finish!:()=>void;
            const response=bindPromise(new NativePromise<object>((yes,no)=>{grant=yes;deny=no;}));
            const fate=bindPromise(new NativePromise<void>(yes=>{finish=yes;}));
            const row:PhysicalRow={kind,context,attemptId,hash,tuple:facts.tuple,...(facts.draftModel?{draftModel:true as const}:{}),nativeParent:facts.parent,fate,view:facts.view,guardCustody:createRoomTurnCustody(),leafCustodies:createIntrinsicSet(),used:false,settled:false,grant,deny,finish};
            acquisition.row=row;
            physicalRows.add(row);
            if(!prior){prior=new Map();apply(weakSet,physicalAttempts,[context,prior]);}
            apply(mapSet,prior,[kind+':'+attemptId,row]);
            // This accepted physical producer remains owned across early permit
            // delivery, until the original SDK's fixed fate reader confirms it.
            const owned=custody.root(()=>fate);apply(nativeThen,owned,[()=>{},()=>{}]);
            let entered=false;
            try {
                rowCurrent(row);await initialize();
                const hostId=await hostIdentity();rowCurrent(row);
                const nativeContext=await custody.sdk<object>(methods.importOriginalPhysicalContext!,api,[sourceKeys[facts.executionClass],facts.parent,facts.scope.profileId,facts.scope.workspaceId,facts.scope.principalId,hostId,facts.executionRef]);
                rowCurrent(row);
                if(facts.claimAttempt)row.guardCustody.syncVoid(facts.claimAttempt,undefined,[attemptId,hash]);
                entered=true;acquisition.nativeEnqueueEntered=true;
                const result=await custody.sdk<any>(methods[kind==='model'?'enqueueOriginalModel':facts.workflowVm?'enqueueOriginalWorkflowVmProcess':'enqueueOriginalProcess']!,api,[nativeContext,attemptId,hash]);
                row.key=result.record.executionKey;
                rowCurrent(row);
                await requestPump();
            } catch(error){if(!entered){physicalRows.delete(row);finish();}deny(error);}
            return await response;
          }catch(error){acquisition.rejected=true;throw error;}
          finally{acquisition.completed=true;}
        });
        apply(weakSet,physicalAcquisitions,[raw,acquisition]);return raw;
    }
    function consume(kind:'model'|'process',permit:object):void {
        const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;
        if(!row||row.kind!==kind||!row.nativePermit||row.used||row.settled)throw Error('ROOT_RESOURCE_PHYSICAL_PERMIT_REQUIRED');
        // Pure fixed local contract only, after the caller's final current cut.
        // Burn before any later SDK; failure never makes the permit reusable.
        row.used=true;local();row.guardCustody.syncVoid(row.view.assertLocal,undefined,[]);local();
    }
    function settle(kind:'model'|'process',permit:object,physicalReceipt:object):Promise<void> {
        const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;
        if(!row||row.kind!==kind||!row.used||!row.nativePermit)throw Error('ROOT_RESOURCE_PHYSICAL_PERMIT_REQUIRED');
        // Accepted cleanup may complete after Source revoke/normal seal. It
        // does not re-run effect current or create another grant.
        return custody.root(async()=>{
            if(row.tuple&&kind==='model'){
                const receipt=row.draftModel?readOriginalDshDraftModelPhysicalReceipt(row.context,physicalReceipt,row.tuple.realm,row.tuple.store,row.tuple.runtime,row.tuple.budgetSource):readOriginalDshModelPhysicalReceipt(row.context,physicalReceipt,row.tuple.realm,row.tuple.store,row.tuple.runtime,row.tuple.budgetSource);
                if(receipt.attemptId!==row.attemptId||receipt.bodyHash!==row.hash)throw denied();
                custody.syncVoid(receipt.assertKnown,undefined,[]);
            }else if(kind==='process'){
                const tool=readOptionalOriginalToolProcessPhysicalReceipt(row.context,permit,physicalReceipt);
                if(tool){
                    if(!tool.nativeMetered||tool.invocationId!==row.attemptId||tool.specHash!==row.hash)throw denied();
                    custody.syncVoid(tool.assertKnown,undefined,[]);
                }else{
                    const parent=apply(weakGet,executionContexts,[row.context]) as {row:Row}|undefined;
                    if(!parent||parent.row.executionClass!=='workflow_root'||!workflowService)throw Error('ROOT_RESOURCE_PHYSICAL_FATE_READER_UNAVAILABLE');
                    const reader=method(originalWorkflowResourceSource,'readOriginalWorkflowScriptProcessPhysicalReceipt');
                    const receipt=await custody.sdk<{invocationId:string;specHash:string;assertKnown():void}>(reader,undefined,[workflowService,parent.row.proof,permit,physicalReceipt]);
                    if(receipt.invocationId!==row.attemptId||receipt.specHash!==row.hash)throw denied();
                    custody.syncVoid(receipt.assertKnown,undefined,[]);
                }
            }else{
                const receipt=readOriginalGenericModelSdkPhysicalReceipt(row.context,permit,physicalReceipt);
                if(receipt.attemptId!==row.attemptId||receipt.requestDigest!==row.hash)throw denied();
                custody.syncVoid(receipt.assertKnown,undefined,[]);
            }
            await row.guardCustody.waitPhysicalKnown();
            const leafStocks=row.leafCustodies.snapshot();
            for(let i=0;i<leafStocks.length;i++)await leafStocks[i]!.waitPhysicalKnown();
            await custody.sdk(methods[kind==='model'?'settleOriginalModel':'settleOriginalProcess']!,api,[issuer,row.nativePermit]);
            row.settled=true;physicalRows.delete(row);row.finish();
            await requestPump();
        });
    }
    function cancelBeforeStart(kind:'model'|'process',permit:object):Promise<void> {
        const acquisition=apply(weakGet,physicalAcquisitions,[permit]) as PhysicalAcquisition|undefined;
        if(acquisition){
            if(acquisition.kind!==kind||!acquisition.completed)throw Error('ROOT_RESOURCE_PHYSICAL_NOT_CANCELLABLE');
            const existing=acquisition.row;
            if(!acquisition.rejected&&existing?.permit&&!existing.used&&!existing.settled)return cancelBeforeStart(kind,existing.permit);
            if(acquisition.nativeEnqueueEntered&&!existing?.settled)throw Error('ROOT_RESOURCE_PHYSICAL_ACQUISITION_UNCONFIRMED');
            if(!acquisition.rejected&&!existing?.settled)throw Error('ROOT_RESOURCE_PHYSICAL_NOT_CANCELLABLE');
            return custody.root(async()=>{
                await acquisition.guardCustody.waitPhysicalKnown();acquisition.guardCustody.assertPhysicalKnown();
                if(existing){await existing.guardCustody.waitPhysicalKnown();existing.guardCustody.assertPhysicalKnown();}
                // The explicit before-enqueue phase is original program truth,
                // not absence of a result. Entered-but-unknown never comes here.
                if(acquisition.nativeEnqueueEntered){
                    if(!existing?.settled)throw Error('ROOT_RESOURCE_PHYSICAL_ACQUISITION_UNCONFIRMED');
                    await existing.fate;
                }
            });
        }
        const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;
        if(!row||row.kind!==kind||row.used||row.settled||!row.nativePermit)throw Error('ROOT_RESOURCE_PHYSICAL_NOT_CANCELLABLE');
        // Burn the only SDK-entry permission synchronously. No caller-known
        // boolean or error/result absence can replace this original state.
        row.used=true;
        return custody.root(async()=>{
            await row.guardCustody.waitPhysicalKnown();
            await custody.sdk(methods[kind==='model'?'settleOriginalModel':'settleOriginalProcess']!,api,[issuer,row.nativePermit]);
            row.settled=true;physicalRows.delete(row);row.finish();
            await requestPump();
        });
    }
    function leafPhysicalRow(permit:object):PhysicalRow {
        const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;
        if(!row||row.kind!=='process'||!row.nativePermit||row.settled)throw denied();
        return row;
    }
    function consumeLeafMethodMetadata():void {}
    async function leafMethodMetadata(row:PhysicalRow,method:Function):Promise<void> {
        const stock=createRoomTurnCustody();row.leafCustodies.add(stock);
        const shell=create(null);
        const field=create(null);field.value=method;field.enumerable=true;
        define(shell,'method',field);freeze(shell);
        const resource=await stock.sdk<object>(()=>shell,undefined,[],{
            accept:value=>value===shell,consumer:consumeLeafMethodMetadata,strictProxyGraph:true,
        });
        await stock.consumeResource(consumeLeafMethodMetadata,resource,[]);
    }
    async function leafOperation(permit:object,name:'prepareOriginalReadonlyLeaf'|'waitOriginalReadonlyLeafReady'|'bindOriginalReadonlyLeaf'|'goOriginalReadonlyLeaf'|'cancelOriginalReadonlyLeaf'|'waitOriginalReadonlyLeafClosed',args:unknown[]):Promise<unknown> {
        const row=leafPhysicalRow(permit);
        const method=methods[name]!;
        const positive=name==='prepareOriginalReadonlyLeaf'||name==='bindOriginalReadonlyLeaf'||name==='goOriginalReadonlyLeaf';
        let first:{raw:unknown}|undefined,result:unknown;
        try{await leafMethodMetadata(row,method);}catch(raw){first={raw};}
        // Unknown function metadata never authorizes effects. The exact owned
        // negative method still performs cleanup; its unknown inventory stays.
        if(!first||!positive){
            try{
                if(positive){
                    const prior=row.leafCustodies.snapshot();
                    for(let i=0;i<prior.length;i++)prior[i]!.accepted();
                    rowCurrent(row);local();row.guardCustody.syncVoid(row.view.assertLocal,undefined,[]);local();
                }
                // Each cleanup enters with its own accepted operation on this
                // same P row. All prior stocks still AND into P settlement.
                const stock=createRoomTurnCustody();row.leafCustodies.add(stock);
                const parameters:unknown[]=[issuer,row.nativePermit];
                for(let i=0;i<args.length;i++)appendIntrinsic(parameters,args[i]);
                result=await stock.sdk(method,api,parameters);
            }catch(raw){if(!first)first={raw};}
        }
        try{await leafMethodMetadata(row,method);}catch(raw){if(!first)first={raw};}
        if(first)throw first.raw;
        return result;
    }
    const physical:OriginalMainPhysicalPort=freeze({__proto__:null,
        acquireModel:(context:object,id:string,hash:string)=>acquire('model',context,id,hash),
        consumeModel:(permit:object)=>consume('model',permit),
        assertModelCurrent(permit:object){const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;if(!row||row.kind!=='model'||!row.nativePermit||row.settled)throw denied();rowCurrent(row);},
        assertModelLocal(permit:object){const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;if(!row||row.kind!=='model'||!row.nativePermit||row.settled)throw denied();local();row.guardCustody.syncVoid(row.view.assertLocal,undefined,[]);local();},
        settleModel:(permit:object,receipt:object)=>settle('model',permit,receipt),
        cancelModel:(permit:object)=>cancelBeforeStart('model',permit),
        acquireProcess:(context:object,id:string,hash:string)=>acquire('process',context,id,hash),
        consumeProcess:(permit:object)=>consume('process',permit),
        assertProcessCurrent(permit:object){const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;if(!row||row.kind!=='process'||!row.nativePermit||row.settled)throw denied();rowCurrent(row);},
        assertProcessLocal(permit:object){const row=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;if(!row||row.kind!=='process'||!row.nativePermit||row.settled)throw denied();local();row.guardCustody.syncVoid(row.view.assertLocal,undefined,[]);local();},
        settleProcess:(permit:object,receipt:object)=>settle('process',permit,receipt),
        cancelProcess:(permit:object)=>cancelBeforeStart('process',permit),
        prepareReadonlyLeaf:async(permit:object,spec:string)=>{await leafOperation(permit,'prepareOriginalReadonlyLeaf',[spec]);},
        waitReadonlyLeafReady:(permit:object)=>leafOperation(permit,'waitOriginalReadonlyLeafReady',[]) as Promise<object>,
        bindReadonlyLeaf:async(permit:object,ready:object)=>{await leafOperation(permit,'bindOriginalReadonlyLeaf',[ready]);},
        goReadonlyLeaf:async(permit:object)=>{await leafOperation(permit,'goOriginalReadonlyLeaf',[]);},
        cancelReadonlyLeaf:async(permit:object)=>{await leafOperation(permit,'cancelOriginalReadonlyLeaf',[]);},
        waitReadonlyLeafClosed:(permit:object)=>leafOperation(permit,'waitOriginalReadonlyLeafClosed',[]) as Promise<{stdout:string;stderr:string;exitCode:number;signal:number;timedOut:boolean}>,
        readProcessSourceRequest(ticket:unknown){
            // Passive private membership precedes all candidate attributes and
            // Native role checks. Returned metadata never grants P itself.
            local();
            const vm=readOptionalOriginalWorkflowVmProcessSourceRequest(ticket);
            if(vm)return vm;
            const office=readOptionalOriginalOfficeProcessSourceRequest(ticket);
            if(office)return office;
            const pdf=readOptionalOriginalPdfWorkerSourceRequest(ticket);
            if(pdf)return pdf;
            const codex=readOptionalOriginalCodexProcessSourceRequest(ticket);
            if(codex)return codex;
            return null;
        },
    });
    const port:OriginalRoomRootAdmissionPort=freeze({
        cancelRoomLaunch(proof:object){const row=apply(weakGet,subjects,[proof]) as Row|undefined;if(!row||row.executionClass!=='room_discussion')throw denied();if(row.consumed||row.consumeEntered)return new NativePromise<void>(yes=>yes());return cancelQueuedRow(row,Error('ROOM_ROOT_CANCELLED_BEFORE_LAUNCH'));},
        finishRoom(proof:object){const row=apply(weakGet,subjects,[proof]) as Row|undefined;if(!row||row.executionClass!=='room_discussion'||!row.consumed)throw denied();return finishKnownRoot(row,readOriginalRoomTurnPhysicalFate(source,proof));},
        awaitRoomLaunch:(proof:object)=>awaitOriginalLaunch(proof,'room_discussion'),
        readRoomLaunch(proof:object,carrier:object){
            local();const row=apply(weakGet,subjects,[proof]) as Row|undefined;
            const context=apply(weakGet,executionContexts,[carrier]) as {row:Row}|undefined;
            if(!row||row.executionClass!=='room_discussion'||!row.consumed||row.finishing||row.state==='released'||context?.row!==row||row.carrier!==carrier||!row.claim)throw denied();
            row.assertCurrent();return readOriginalRoomTurnClaim(source,proof,row.claim);
        },
        enqueueRoom(proof:object){
            const view=readOriginalRoomTurnRoot(source,proof);
            return custody.root(async()=>{
                current(proof);
                await revalidateOriginalRoomTurnRoot(source,proof);
                const hostId=await hostIdentity();
                await initialize();current(proof);
                const subject=await custody.sdk<object>(methods.importOriginalRoomTurnSubject!,api,[key,view.scope.profileId,view.scope.workspaceId,view.principalId,hostId,view.roomId,view.messageId,view.logicalAgentId,view.turnId,view.payloadCanonical,view.turnId]);
                current(proof);
                const result=await custody.sdk<any>(methods.enqueue!,api,[issuer,subject]);
                const prior=apply(weakGet,subjects,[proof]) as Row|undefined;
                if(prior)return result;
                if(result.disposition!=='new_queued')return result;
                const row:Row={guardCustody:createRoomTurnCustody(),executionClass:'room_discussion',state:result.record.state,proof,subject,hostId,key:result.record.executionKey,assertCurrent:()=>current(proof),assertLocal:()=>current(proof),revalidate:()=>revalidateOriginalRoomTurnRoot(source,proof)};
                apply(weakSet,subjects,[proof,row]);rows.add(row);
                return result;
            });
        },
        claimNext(){
            local();
            return custody.root(async()=>{
                await initialize();
                const snapshot=rows.snapshot();
                for(let i=0;i<snapshot.length;i++){
                    const row=snapshot[i]!;
                    if(row.state!=='queued')continue;
                    try{
                        await row.guardCustody.sdk(row.assertCurrent,undefined,[]);
                        if(readRootState(row)!=='queued')continue;
                        await row.guardCustody.sdk(row.revalidate,undefined,[]);
                    }catch(error){
                        // A concurrent cancellation has already fenced the
                        // Native token. Keep its late guard SDK with this row,
                        // without poisoning unrelated active roots.
                        if(readRootState(row)==='cancelled_before_launch')continue;
                        if(readRootState(row)==='queued'&&!row.consumed){await cancelQueuedRow(row,error);continue;}
                        throw error;
                    }
                }
                local();
                const result=await custody.sdk<any>(methods.claimNext!,api,[issuer]);
                if(!result)return null;
                let row:Row|undefined;
                const claimedRows=rows.snapshot();
                for(let i=0;i<claimedRows.length;i++)if(claimedRows[i]!.key===result.record.executionKey){row=claimedRows[i];break;}
                if(!row)throw denied();
                row.state=result.record.state;
                apply(weakSet,reservations,[result.reservation,row]);
                return result.reservation;
            });
        },
        consumeLaunch(reservation:object){
            const row=apply(weakGet,reservations,[reservation]) as Row|undefined;
            if(!row)throw denied();
            return custody.root(async()=>{
                if(!row.consumed){
                    await row.guardCustody.sdk(row.assertCurrent,undefined,[]);
                    if(await hostIdentity()!==row.hostId)throw Error('ROOM_ROOT_HOST_IDENTITY_CHANGED');
                    if(row.executionClass==='room_discussion'){
                        row.claim=await row.guardCustody.sdk<object>(claimOriginalRoomTurnRoot,undefined,[source,row.proof,row.hostId]);
                        readOriginalRoomTurnClaim(source,row.proof,row.claim);
                    }else await row.guardCustody.sdk(row.revalidate,undefined,[]);
                    await row.guardCustody.sdk(row.assertCurrent,undefined,[]);
                }
                row.consumeEntered=true;
                const result=await custody.sdk<any>(methods.consumeLaunch!,api,[issuer,reservation]);
                row.consumed=true;row.nativeReservation=reservation;
                return result;
            });
        },
        cancelQueued(proof:object){
            const row=apply(weakGet,subjects,[proof]) as Row|undefined;
            if(!row)throw denied();
            return custody.root(async()=>{const result=await custody.sdk<any>(methods.cancelQueued!,api,[issuer,row.subject]);row.state=result.record.state;if(row.executionClass==='room_discussion'&&row.state==='cancelled_before_launch'){const waiter=apply(weakGet,launchWaiters,[proof]) as {deny(raw:unknown):void}|undefined;waiter?.deny(Error('ROOM_ROOT_CANCELLED_BEFORE_LAUNCH'));}return result;});
        },
        drain(){
            if(closePromise)return closePromise;
            closing=true;
            // Publish a deferred before waiting or entering close Native SDK.
            let yes!:()=>void,no!:(error:unknown)=>void;
            closePromise=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
            define(closePromise,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);
            const finish=async()=>{
                let failed=false,failure:unknown;
                const guardResults=await Promise.allSettled(rows.snapshot().map(row=>row.guardCustody.waitPhysicalKnown()));
                for(const result of guardResults)if(result.status==='rejected'&&!failed){failed=true;failure=result.reason;}
                try{await custody.waitKnown();}catch(error){failed=true;failure=error;}
                try{if(issuer)await custody.consumeResource(issuerConsumer!,issuer,[installedLease??issuer]);}catch(error){if(!failed){failed=true;failure=error;}}
                try{if(installedLease)await custody.consumeResource(returnOriginalMainDshInstalledRootPool,installedLease,[installedLease]);}catch(error){if(!failed){failed=true;failure=error;}}
                try{await custody.drain();}catch(error){if(!failed){failed=true;failure=error;}}
                if(failed)throw failure;
            };
            const raw=finish();define(raw,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);
            apply(nativeThen,raw,[yes,no]);return closePromise;
        },
    });
    let workflowService:object|undefined,workflowPort:OriginalMainWorkflowAdmissionPort|undefined;
    const launchWaiters=new NativeWeakMap<object,{promise:Promise<object>;grant(value:object):void;deny(error:unknown):void}>();
    let launchPump:Promise<void>|undefined;
    function scheduleLaunches():void {
        if(launchPump)return;
        const raw=custody.root(async()=>{
            for(;;){
                const all=rows.snapshot();let waiting=false;
                for(let i=0;i<all.length;i++)if(apply(weakGet,launchWaiters,[all[i]!.proof])&&!all[i]!.consumed)waiting=true;
                if(!waiting)break;
                const reservation=await port.claimNext();if(!reservation)break;
                const row=apply(weakGet,reservations,[reservation]) as Row;
                const waiter=apply(weakGet,launchWaiters,[row.proof]) as {grant(value:object):void}|undefined;
                // A reservation is never reassigned to another proof. Existing
                // manual Room callers retain their original reservation path.
                if(!waiter)throw Error('ROOT_RESOURCE_LAUNCH_AUDIENCE_UNCONFIRMED');
                await port.consumeLaunch(reservation);
                waiter.grant(rootContext(reservation));
            }
        });
        launchPump=raw;
        apply(nativeThen,raw,[()=>{launchPump=undefined;},(error:unknown)=>{
            launchPump=undefined;const all=rows.snapshot();
            for(let i=0;i<all.length;i++){
                const waiter=apply(weakGet,launchWaiters,[all[i]!.proof]) as {deny(error:unknown):void}|undefined;
                if(waiter&&!all[i]!.consumed)waiter.deny(error);
            }
        }]);
    }
    function awaitOriginalLaunch(proof:object,kind:string):Promise<object> {
        const row=apply(weakGet,subjects,[proof]) as Row|undefined;
        if(!row||row.executionClass!==kind)throw denied();
        const prior=apply(weakGet,launchWaiters,[proof]) as {promise:Promise<object>}|undefined;
        if(prior)return prior.promise;
        local();
        let grant!:(value:object)=>void,deny!:(error:unknown)=>void;
        const promise=bindPromise(new NativePromise<object>((yes,no)=>{grant=yes;deny=no;}));
        apply(weakSet,launchWaiters,[proof,{promise,grant,deny}]);scheduleLaunches();return promise;
    }
    const boundAccepted=new NativeWeakMap<object,{service:object;kind:string;port:OriginalMainAcceptedRootPort}>();
    async function bindAccepted(kind:'kswarm_direct'|'room_project',producer:object,service:object):Promise<OriginalMainAcceptedRootPort> {
        local();
        if(kind==='kswarm_direct')readOriginalKSwarmHandoffRootBinding(producer,service);
        else readOriginalRoomProjectRootBinding(producer,service);
        const prior=apply(weakGet,boundAccepted,[producer]) as {service:object;kind:string;port:OriginalMainAcceptedRootPort}|undefined;
        if(prior){if(prior.service!==service||prior.kind!==kind)throw denied();return prior.port;}
        await initialize();local();
        const facet:OriginalMainAcceptedRootPort=freeze({__proto__:null,
            enqueue(proof:object){
                const view=kind==='kswarm_direct'?readOriginalKSwarmHandoffRoot(producer,proof):readOriginalRoomProjectRoot(producer,proof);
                const room=readOriginalRoomTurnSourceBinding(source);
                if(view.scope.profileId!==room.scope.profileId||view.scope.workspaceId!==room.scope.workspaceId)throw Error('ROOT_RESOURCE_ORIGINAL_SCOPE_MISMATCH');
                const current=()=>{if(kind==='kswarm_direct')assertOriginalKSwarmHandoffRootCurrent(producer,proof);else assertOriginalRoomProjectRootCurrent(producer,proof);};
                const pure=()=>{if(kind==='kswarm_direct')readOriginalKSwarmHandoffRoot(producer,proof);else readOriginalRoomProjectRoot(producer,proof);};
                const revalidate=()=>kind==='kswarm_direct'?revalidateOriginalKSwarmHandoffRoot(producer,proof):revalidateOriginalRoomProjectRoot(producer,proof);
                return custody.root(async()=>{
                    await custody.sdk(revalidate,undefined,[]);await custody.sdk(current,undefined,[]);
                    const hostId=await hostIdentity();local();await custody.sdk(current,undefined,[]);
                    const common=[sourceKeys[kind],view.scope.profileId,view.scope.workspaceId,'desktop-user:'+view.scope.profileId,hostId];
                    let args:unknown[],name:string;
                    if(kind==='kswarm_direct'){
                        const direct=readOriginalKSwarmHandoffRoot(producer,proof);
                        args=[...common,direct.projectId,direct.taskId,direct.runId,direct.payloadCanonical,direct.authorizationRef];name='importOriginalKSwarmTaskSubject';
                    }else{
                        const project=readOriginalRoomProjectRoot(producer,proof);
                        args=[...common,project.roomId,project.projectId,project.taskId,project.runId,project.claimId,project.payloadCanonical,project.authorizationRef];name='importOriginalRoomProjectSubject';
                    }
                    const subject=await custody.sdk<object>(methods[name]!,api,args);
                    await custody.sdk(current,undefined,[]);
                    const result=await custody.sdk<any>(methods.enqueue!,api,[issuer,subject]);
                    if(result.disposition==='new_queued'&&!apply(weakGet,subjects,[proof])){
                        const row:Row={guardCustody:createRoomTurnCustody(),executionClass:kind,state:result.record.state,proof,subject,hostId,key:result.record.executionKey,assertCurrent:current,assertLocal:pure,revalidate};
                        apply(weakSet,subjects,[proof,row]);rows.add(row);
                    }
                    return result;
                });
            },
            awaitLaunch:(proof:object)=>awaitOriginalLaunch(proof,kind),
            cancelQueued:(proof:object)=>cancelOwnedQueuedRoot(proof,kind),
            finish(proof:object,_receipt:object){
                const row=apply(weakGet,subjects,[proof]) as Row|undefined;
                if(!row||row.executionClass!==kind||!row.consumed)throw denied();
                if(kind==='kswarm_direct')return finishKnownRoot(row,readOriginalKSwarmHandoffRootPhysicalFate(producer,proof));
                return finishKnownRoot(row,readOriginalRoomProjectRootPhysicalFate(producer,proof));
            },
        });
        const latest=apply(weakGet,boundAccepted,[producer]) as {service:object;kind:string;port:OriginalMainAcceptedRootPort}|undefined;
        if(latest){if(latest.service!==service||latest.kind!==kind)throw denied();return latest.port;}
        apply(weakSet,boundAccepted,[producer,{service,kind,port:facet}]);return facet;
    }
    function cancelOwnedQueuedRoot(proof:object,kind:'kswarm_direct'|'room_project'|'dsh_draft'):Promise<void>{
        const row=apply(weakGet,subjects,[proof]) as Row|undefined;
        if(!row||row.executionClass!==kind||row.consumed)throw denied();
        return cancelQueuedRow(row,Error('ROOT_RESOURCE_CANCELLED_BEFORE_LAUNCH'));
    }
    function cancelQueuedRow(row:Row,reason:unknown):Promise<void>{
        return custody.root(async()=>{
            const result=await custody.sdk<any>(methods.cancelQueued!,api,[issuer,row.subject]);
            if(result?.record?.executionKey!==row.key||result.record.state!=='cancelled_before_launch')throw Error('ROOT_RESOURCE_CANCEL_UNCONFIRMED');
            row.state='cancelled_before_launch';row.finishing=true;
            const waiter=apply(weakGet,launchWaiters,[row.proof]) as {deny(error:unknown):void}|undefined;
            if(waiter)waiter.deny(reason);
            scheduleLaunches();
        });
    }
    function finishKnownRoot(row:Row,fate:{waitKnown():Promise<void>;assertKnown():void}):Promise<void> {
        if(row.finishPromise)return row.finishPromise;
        const work=custody.root(async()=>{
            await custody.sdk(fate.waitKnown,undefined,[]);custody.syncVoid(fate.assertKnown,undefined,[]);
            await row.guardCustody.waitPhysicalKnown();row.guardCustody.assertPhysicalKnown();
            if(!row.nativeReservation||!row.carrier||!row.consumed)throw denied();
            const parent=apply(weakGet,executionContexts,[row.carrier]) as {row:Row;nativeParent:object}|undefined;if(!parent||parent.row!==row)throw denied();
            const active=physicalRows.snapshot(),pending:Promise<void>[]=[];
            for(let i=0;i<active.length;i++)if(active[i]!.nativeParent===parent.nativeParent&&!active[i]!.settled)pending.push(active[i]!.fate);
            await Promise.all(pending);custody.syncVoid(fate.assertKnown,undefined,[]);
            const remaining=physicalRows.snapshot();for(let i=0;i<remaining.length;i++)if(remaining[i]!.nativeParent===parent.nativeParent&&!remaining[i]!.settled)throw Error('ROOT_RESOURCE_CHILD_PHYSICAL_UNCONFIRMED');
            row.finishing=true;
            const result=await custody.sdk<any>(methods.finishOriginalRoot!,api,[issuer,row.nativeReservation]);
            if(result?.record?.executionKey!==row.key||result.record.state!=='released')throw Error('ROOT_RESOURCE_FINISH_UNCONFIRMED');
            row.state='released';scheduleLaunches();
        });row.finishPromise=work;return work;
    }
    const draftPorts=new NativeWeakMap<object,OriginalMainDshDraftAdmissionPort>();
    function draftPort(tuple:DshTuple,businessSource:object):OriginalMainDshDraftAdmissionPort {
        const prior=apply(weakGet,draftPorts,[businessSource]) as OriginalMainDshDraftAdmissionPort|undefined;if(prior)return prior;
        const read=(proof:object)=>readOriginalMainDshDraftCandidate(proof,tuple.realm,tuple.store,tuple.runtime,tuple.budgetSource,businessSource);
        const facet:OriginalMainDshDraftAdmissionPort=freeze({
            enqueue(proof:object){
                const view=read(proof);return custody.root(async()=>{
                    await initialize();tuple.current();const hostId=await hostIdentity();view.assertCurrent();
                    const subject=await custody.sdk<object>(methods.importOriginalDshDraftSubject!,api,[sourceKeys.dsh_draft,view.scope.profileId,view.scope.workspaceId,view.scope.principalId,hostId,view.ownerWorkId,view.draftInvocationId,view.draftCommitKey,view.payloadCanonical,view.authorizationRef]);
                    view.assertCurrent();const result=await custody.sdk<any>(methods.enqueue!,api,[issuer,subject]);
                    if(result.disposition==='new_queued'&&!apply(weakGet,subjects,[proof])){const row:Row={guardCustody:createRoomTurnCustody(),executionClass:'dsh_draft',state:result.record.state,proof,subject,hostId,key:result.record.executionKey,assertCurrent:view.assertCurrent,assertLocal:view.assertLocal,revalidate:async()=>{read(proof).assertCurrent();}};apply(weakSet,subjects,[proof,row]);rows.add(row);}return result;
                });
            },
            awaitLaunch:(proof:object)=>awaitOriginalLaunch(proof,'dsh_draft'),
            finish(proof:object,modelSource:object){
                const row=apply(weakGet,subjects,[proof]) as Row|undefined;if(!row||row.executionClass!=='dsh_draft'||!row.consumed)throw denied();
                const rootFate=readOriginalMainDshDraftLaunchPhysicalFate(proof,tuple.realm,tuple.store,tuple.runtime,tuple.budgetSource,businessSource);
                const modelFate=readOriginalDshDraftModelLaunchPhysicalFate(modelSource,proof,tuple.realm,tuple.store,tuple.runtime,tuple.budgetSource);
                // Close future Source births, preserving accepted SDK custody
                // and original negative identity across normal withdrawal.
                sealOriginalMainDshDraftLaunch(proof,tuple.realm,tuple.store,tuple.runtime,tuple.budgetSource,businessSource);
                return finishKnownRoot(row,{async waitKnown(){const results=await Promise.allSettled([rootFate.waitKnown(),modelFate.waitKnown()]);for(const result of results)if(result.status==='rejected')throw result.reason;},assertKnown(){rootFate.assertKnown();modelFate.assertKnown();}});
            },
            cancelQueued:(proof:object)=>cancelOwnedQueuedRoot(proof,'dsh_draft'),
        });apply(weakSet,draftPorts,[businessSource,facet]);return facet;
    }
    function assertWorkflowPermit(proof:object,permit:object):void {
        const root=apply(weakGet,subjects,[proof]) as Row|undefined;
        const physical=apply(weakGet,physicalPermits,[permit]) as PhysicalRow|undefined;
        const context=physical?apply(weakGet,executionContexts,[physical.context]) as {row:Row}|undefined:undefined;
        if(!root||root.executionClass!=='workflow_root'||!root.consumed||!physical||physical.kind!=='process'||context?.row!==root)throw Error('ROOT_RESOURCE_WORKFLOW_PROCESS_PERMIT_REQUIRED');
    }
    async function bindWorkflow(service:object):Promise<OriginalMainWorkflowAdmissionPort> {
        local();
        const original=readOriginalWorkflowRootSourceBinding(service);
        const room=readOriginalRoomTurnSourceBinding(source);
        if(original.scope.profileId!==room.scope.profileId||original.scope.workspaceId!==room.scope.workspaceId)throw Error('ROOT_RESOURCE_WORKFLOW_SCOPE_MISMATCH');
        if(workflowService){if(workflowService!==service)throw denied();return workflowPort!;}
        await initialize();local();
        if(workflowService){if(workflowService!==service)throw denied();return workflowPort!;}
        workflowService=service;
        workflowPort=freeze({__proto__:null,
            enqueueWorkflow(proof:object){
                const view=readOriginalWorkflowScriptRoot(service,proof);
                return custody.root(async()=>{
                    await custody.sdk(revalidateOriginalWorkflowScriptRoot,undefined,[service,proof]);
                    await custody.sdk(view.assertCurrent,undefined,[]);
                    const hostId=await hostIdentity();local();
                    await custody.sdk(view.assertCurrent,undefined,[]);
                    const subject=await custody.sdk<object>(methods.importOriginalWorkflowRootSubject!,api,[sourceKeys.workflow_root,view.scope.profileId,view.scope.workspaceId,'desktop-user:'+view.scope.profileId,hostId,view.workflowId,view.rootJobId,view.runId,view.scriptHash,view.payloadCanonical,view.authorizationRef]);
                    await custody.sdk(view.assertCurrent,undefined,[]);
                    const result=await custody.sdk<any>(methods.enqueue!,api,[issuer,subject]);
                    const previous=apply(weakGet,subjects,[proof]) as Row|undefined;
                    if(!previous&&result.disposition==='new_queued'){
                        const row:Row={guardCustody:createRoomTurnCustody(),executionClass:'workflow_root',state:result.record.state,proof,subject,hostId,key:result.record.executionKey,assertCurrent:view.assertCurrent,assertLocal:view.assertLocal,revalidate:()=>revalidateOriginalWorkflowScriptRoot(service,proof)};
                        apply(weakSet,subjects,[proof,row]);rows.add(row);
                    }
                    return result;
                });
            },
            awaitWorkflowLaunch:(proof:object)=>awaitOriginalLaunch(proof,'workflow_root'),
            acquireWorkflowProcess(proof:object,id:string,hash:string){
                const row=apply(weakGet,subjects,[proof]) as Row|undefined;
                if(!row||row.executionClass!=='workflow_root'||!row.consumed||!row.carrier)throw denied();
                return physical.acquireProcess(row.carrier,id,hash);
            },
            consumeWorkflowProcess(proof:object,permit:object){
                assertWorkflowPermit(proof,permit);physical.consumeProcess(permit);
            },
            settleWorkflowProcess(proof:object,permit:object,receipt:object){
                assertWorkflowPermit(proof,permit);return physical.settleProcess(permit,receipt);
            },
            cancelWorkflowProcess(proof:object,permit:object){
                assertWorkflowPermit(proof,permit);return physical.cancelProcess(permit);
            },
            finishWorkflow(proof:object){
                const row=apply(weakGet,subjects,[proof]) as Row|undefined;
                if(!row||row.executionClass!=='workflow_root'||!row.consumed)throw denied();
                return finishKnownRoot(row,readOriginalWorkflowScriptRootSettlement(service,proof));
            },
        });
        return workflowPort;
    }
    const owner:OriginalMainRootAdmissionOwner=freeze({__proto__:null,room:port,physical,drain:port.drain});
    apply(weakSet,ownerRoomSources,[owner,source]);
    apply(weakSet,ownerStates,[owner,{initialize,assertComposition,local,rootContext,bindModelProbe,bindMaterial,bindWorkflow,bindAccepted,draftPort}]);
    return owner;
}


export interface OriginalMainRootAdmissionOwner {
    readonly room:OriginalRoomRootAdmissionPort;
    readonly physical:OriginalMainPhysicalPort;
    drain():Promise<void>;
}
let originalOwner:{roomSource:object;host:object;store:object;owner:OriginalMainRootAdmissionOwner}|undefined;
/** The only Main owner for all Native Source facets. Subsequent fixed facets
 * share this session/pool; they never open another capacity-five database. */
export function createOriginalMainRootAdmissionOwner(options:{roomSource:object;host:object;store:object}):OriginalMainRootAdmissionOwner {
    if(!options||typeof options!=='object'||isProxy(options)||keys(options).length!==3)throw denied();
    const sourceRow=descriptor(options,'roomSource'),hostRow=descriptor(options,'host'),storeRow=descriptor(options,'store');
    if(!sourceRow||!hostRow||!storeRow||!own(sourceRow,'value')||!own(hostRow,'value')||!own(storeRow,'value'))throw denied();
    const roomSource=sourceRow.value,host=hostRow.value,store=storeRow.value;
    if(originalOwner){
        if(originalOwner.roomSource!==roomSource||originalOwner.host!==host||originalOwner.store!==store)throw Error('ROOT_RESOURCE_ORIGINAL_OWNER_ALREADY_BOUND');
        return originalOwner.owner;
    }
    const owner=createOwner({roomSource,host,store});
    originalOwner={roomSource,host,store,owner};return owner;
}
export function createOriginalMainRoomRootAdmissionPort(options:{roomSource:object;host:object;store:object}):OriginalRoomRootAdmissionPort {
    return createOriginalMainRootAdmissionOwner(options).room;
}
