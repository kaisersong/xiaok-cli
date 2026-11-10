import {types} from 'node:util';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import {createHash,Hash} from 'node:crypto';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {readOriginalKSwarmServiceIdentity,readOriginalKSwarmExecutionStartIO,readOriginalKSwarmWorkflowRunIO,type KSwarmService} from './kswarm-service.js';
import {readOriginalWorkflowScriptAcceptance} from './kswarm-dynamic-workflow-script-tool.js';
import {bindOriginalWorkflowControllerRuntime,readOriginalWorkflowControllerPhysicalFate} from './workflow-script-kswarm-controller.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {readOptionalOriginalMainWorkflowAdmission} from './main-workflow-root-binding.js';
import {cacheOriginalWorkflowScriptWorkerOrigin,type OriginalWorkflowScriptWorkerOrigin} from './workflow-script-worker-origin.js';
import {readOriginalWorkflowScriptRuntimeFate} from './workflow-script-worker.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,freeze=Object.freeze,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy;
const NativePromise=Promise,nativeThen=Promise.prototype.then,nativeCreate=Object.create,isBytes=types.isUint8Array,isArray=Array.isArray;
const NativeWeakMap=WeakMap,NativeBytes=Uint8Array,decoder=new TextDecoder('utf-8',{fatal:true}),decode=TextDecoder.prototype.decode,parse=JSON.parse;
const responseBody=descriptor(Response.prototype,'body')!.get!,responseOk=descriptor(Response.prototype,'ok')!.get!,responseRedirected=descriptor(Response.prototype,'redirected')!.get!;
const acquire=ReadableStream.prototype.getReader,read=ReadableStreamDefaultReader.prototype.read,cancel=ReadableStreamDefaultReader.prototype.cancel;
const byteProto=Object.getPrototypeOf(Uint8Array.prototype),byteLength=descriptor(byteProto,'byteLength')!.get!,byteSet=Uint8Array.prototype.set,originalHash=createHash,hashUpdate=Hash.prototype.update,hashDigest=Hash.prototype.digest;
const roots=new NativeWeakMap<object,RootRow>(),byController=new NativeWeakMap<object,object>();
const executions=new NativeWeakMap<object,{row:RootRow;proof:object;context:object;used:boolean;runtime?:object}>();
function deny(code='WORKFLOW_ROOT_ORIGINAL_SOURCE_REQUIRED'):never{throw Error(code);}
type Acceptance=ReturnType<typeof readOriginalWorkflowScriptAcceptance>;
interface RootRow {service:KSwarmService;controller:object;acceptance:Acceptance;identity:ReturnType<typeof readOriginalKSwarmServiceIdentity>;execution:ReturnType<typeof readOriginalKSwarmExecutionStartIO>;workflow:ReturnType<typeof readOriginalKSwarmWorkflowRunIO>;custody:ReturnType<typeof createRoomTurnCustody>;confirmed:boolean;retired:boolean;receipt:Acceptance['receipt'];view:OriginalWorkflowScriptRoot}
export interface OriginalWorkflowScriptRoot {readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly workflowId:string;readonly rootJobId:string;readonly runId:string;readonly projectId:string;readonly scriptHash:string;readonly payloadCanonical:string;readonly authorizationRef:string;readonly priorityClass:'background';assertCurrent():void;assertLocal():void}
/** Original constructor identity only. No callback or scope DTO is an admission. */
export function readOriginalWorkflowRootSourceBinding(service:unknown){const identity=readOriginalKSwarmServiceIdentity(service);const scope=identity.scope;if(!scope)deny('WORKFLOW_ROOT_SCOPE_UNAVAILABLE');return freeze({kind:'workflow_root_source_v1' as const,scope,constructorId:identity.constructorId});}
function row(service:unknown,proof:unknown):RootRow {if(!proof||typeof proof!=='object'||isProxy(proof)||!service||typeof service!=='object'||isProxy(service))deny();const found=apply(get,roots,[proof]) as RootRow|undefined;if(!found||found.service!==service)deny();return found;}
function local(r:RootRow){if(r.retired)deny('WORKFLOW_ROOT_RETIRED');try{r.custody.local();r.identity.assertLocal();r.acceptance.assertLocal();}catch(error){r.retired=true;r.custody.inventory(error);throw error;}}
function current(r:RootRow){local(r);if(!r.confirmed)deny('WORKFLOW_ROOT_ACK_UNCONFIRMED');try{r.identity.assertCurrent();r.execution.assert(r.view.projectId,r.receipt);local(r);}catch(error){r.retired=true;r.custody.inventory(error);throw error;}}
/** Called from an original accepted job before its VM timer. Public controller construction is insufficient. */
export function captureOriginalWorkflowScriptRoot(service:unknown,controller:unknown):object {
 const binding=readOriginalWorkflowRootSourceBinding(service),acceptance=readOriginalWorkflowScriptAcceptance(service,controller);acceptance.assertMintable();
 const prior=apply(get,byController,[controller]) as object|undefined;if(prior){if(row(service,prior).retired)deny('WORKFLOW_ROOT_RETIRED');return prior;}
 const identity=readOriginalKSwarmServiceIdentity(service),execution=readOriginalKSwarmExecutionStartIO(service),workflow=readOriginalKSwarmWorkflowRunIO(service),custody=createRoomTurnCustody();
 const state=originalHash('sha256');apply(hashUpdate,state,['workflow-root-authorization-v1\0']);apply(hashUpdate,state,[acceptance.payloadCanonical]);const authorizationRef='workflow-root-authorization:'+apply(hashDigest,state,['hex']);
 let r!:RootRow;const view:OriginalWorkflowScriptRoot=freeze({scope:binding.scope,workflowId:acceptance.workflowId,rootJobId:acceptance.rootJobId,runId:acceptance.runId,projectId:acceptance.projectId,scriptHash:acceptance.scriptHash,payloadCanonical:acceptance.payloadCanonical,authorizationRef,priorityClass:'background',assertCurrent(){current(r);},assertLocal(){local(r);if(!r.confirmed)deny('WORKFLOW_ROOT_ACK_UNCONFIRMED');}});
 r={service:service as KSwarmService,controller:controller as object,acceptance,identity,execution,workflow,custody,confirmed:false,retired:false,receipt:acceptance.receipt,view};const proof=freeze(nativeCreate(null)) as object;apply(set,roots,[proof,r]);apply(set,byController,[controller,proof]);return proof;
}
/** Passive original candidate only. Its current/ACK checks still have to run under the Native owner Root. */
export function readOriginalWorkflowScriptRoot(service:unknown,proof:unknown):OriginalWorkflowScriptRoot {return row(service,proof).view;}
export async function bindOriginalWorkflowScriptRootExecution(service:unknown,proof:object,controller:object,context:object):Promise<void>{
 const original=row(service,proof);if(original.controller!==controller)deny();original.view.assertCurrent();const port=readOptionalOriginalMainWorkflowAdmission(service);if(!port)deny('ROOT_RESOURCE_WORKFLOW_COMPOSITION_REQUIRED');const actual=await port.awaitWorkflowLaunch(proof);if(actual!==context)deny('WORKFLOW_ROOT_CONTEXT_MISMATCH');original.view.assertLocal();
 const prior=apply(get,executions,[controller]) as {row:RootRow;proof:object;context:object}|undefined;if(prior){if(prior.row!==original||prior.proof!==proof||prior.context!==context)deny();return;}
 apply(set,executions,[controller,{row:original,proof,context,used:false}]);await cacheOriginalWorkflowScriptWorkerOrigin(controller);
}
/** Passive fixed private origin. A copied controller or caller callback table
 * cannot create another resident VM under an original N carrier. */
/** Passive fixed private origin. A copied controller or caller callback table
 * cannot create another resident VM under an original N carrier. */
export function readOriginalWorkflowScriptWorkerOrigin(controller: unknown): OriginalWorkflowScriptWorkerOrigin {
    const execution = apply(get, executions, [controller]) as {
        row: RootRow;
        proof: object;
        context: object;
        used: boolean;
        runtime?: object;
    } | undefined;
    if (!execution)
        deny('WORKFLOW_WORKER_ORIGINAL_ORIGIN_REQUIRED');
    return freeze({ scriptHash: execution.row.view.scriptHash, executionContext: execution.context, claim(script: string) { execution.row.view.assertLocal(); if (execution.used)
            deny('WORKFLOW_WORKER_ALREADY_STARTED'); if (script !== execution.row.acceptance.scriptSource)
            deny('WORKFLOW_WORKER_SCRIPT_MISMATCH'); execution.used = true; }, assertCurrent: execution.row.view.assertCurrent, assertLocal: execution.row.view.assertLocal, async waitControllerPhysicalKnown() { const fate = readOriginalWorkflowControllerPhysicalFate(controller); await fate.waitKnown(); fate.assertKnown(); }, bindRuntime(reference: object) { readOriginalWorkflowScriptRuntimeFate(controller, reference); if (execution.runtime && execution.runtime !== reference)
            deny(); bindOriginalWorkflowControllerRuntime(controller, reference); execution.runtime = reference; } });
}
function cleanupPromise(r:RootRow,raw:unknown):Promise<void>{r.custody.inventory(raw);assertStandardIpcPromise(raw,'WORKFLOW_ROOT_CLEANUP_UNCONFIRMED');return new NativePromise((yes,no)=>apply(nativeThen,raw,[(value:unknown)=>{r.custody.inventory(value);if(value!==undefined)no(Error('WORKFLOW_ROOT_CLEANUP_UNCONFIRMED'));else yes();},(error:unknown)=>{r.custody.inventory(error);no(error);} ]));}
async function readBody(r:RootRow,response:Response):Promise<Uint8Array>{
 const stream=apply(responseBody,response,[]) as ReadableStream<Uint8Array>|null;if(!stream)deny('WORKFLOW_ROOT_BODY_UNCONFIRMED');
 const chunks:Uint8Array[]=[];let size=0;
 // Response custody already owns its native stream graph. The new reader and
 // each native byte-bearing outcome also get fixed consumers before delivery.
 const consumePart=function(this:ReadableStreamReadResult<Uint8Array>):boolean{
  const done=descriptor(this,'done'),value=descriptor(this,'value');if(!done||!own(done,'value')||typeof done.value!=='boolean')deny('WORKFLOW_ROOT_BODY_UNCONFIRMED');
  if(done.value)return true;
  if(!value||!own(value,'value')||!isBytes(value.value)||isProxy(value.value))deny('WORKFLOW_ROOT_BODY_UNCONFIRMED');const n=apply(byteLength,value.value,[]) as number;size+=n;if(size>65536)deny('WORKFLOW_ROOT_BODY_TOO_LARGE');const bytes=new NativeBytes(n);apply(byteSet,bytes,[value.value]);chunks[chunks.length]=bytes;return false;
 };
 const consumeReader=async function(this:ReadableStreamDefaultReader<Uint8Array>):Promise<void>{
  let primary:unknown,present=false;
  try{for(;;){local(r);const part=await r.custody.sdk<ReadableStreamReadResult<Uint8Array>>(read,this,[],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:consumePart});local(r);if(await r.custody.consumeResource<boolean>(consumePart,part,[]))break;}}
  catch(error){present=true;primary=error;r.custody.inventory(error);}
  try{const raw=apply(cancel,this,[]);await cleanupPromise(r,raw);}catch(error){r.custody.inventory(error);if(!present){present=true;primary=error;}}
  // cancel is the native terminal operation on this already drained stream.
  // Keep the closed reader scoped to this consumer: releaseLock creates a new
  // rejected native closed Promise even after successful EOF/cancel.
  if(present)throw primary;
 };
 const reader=await r.custody.sdk<ReadableStreamDefaultReader<Uint8Array>>(acquire,stream,[],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:consumeReader});
 await r.custody.consumeResource<void>(consumeReader,reader,[]);
 const joined=new NativeBytes(size);let offset=0;for(let i=0;i<chunks.length;i++){apply(byteSet,joined,[chunks[i],offset]);offset+=apply(byteLength,chunks[i],[]) as number;}
 return joined;
}
/** Same original B action-current plus fixed metadata read, before Native consume. */
export function revalidateOriginalWorkflowScriptRoot(service:unknown,proof:unknown):Promise<void>{const r=row(service,proof);return r.custody.root(async()=>{
 try{local(r);await r.custody.sdk(r.identity.assertCurrent,undefined,[]);const receipt=await r.custody.sdk<Acceptance['receipt']>(r.execution.read,r.execution,[r.view.projectId]);local(r);await r.custody.sdk(r.execution.assert,r.execution,[r.view.projectId,receipt]);
  const consume=async function(this:Response){const bytes=await readBody(r,this);return captureDispatchBusinessData(parse(apply(decode,decoder,[bytes]))) as Record<string,unknown>;};const response=await r.custody.sdk<Response>(r.workflow.read,r.workflow,[r.view.projectId,r.view.runId],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:consume});
  const ok=apply(responseOk,response,[]) as boolean,redirected=apply(responseRedirected,response,[]) as boolean;const body=await r.custody.consumeResource<Record<string,unknown>>(consume,response,[]);if(!ok||redirected)deny('WORKFLOW_ROOT_RUN_UNCONFIRMED');
  const run=body.workflowRun;if(!run||typeof run!=='object'||isArray(run))deny('WORKFLOW_ROOT_RUN_UNCONFIRMED');const value=run as Record<string,unknown>;
  if(value.projectId!==r.view.projectId||value.id!==r.view.runId||value.workflowId!==r.view.workflowId||value.scriptHash!==r.view.scriptHash||value.source!=='script_generated'||value.status!=='running')deny('WORKFLOW_ROOT_RUN_UNCONFIRMED');
  local(r);await r.custody.sdk(r.identity.assertCurrent,undefined,[]);r.execution.assert(r.view.projectId,receipt);r.receipt=receipt;r.confirmed=true;current(r);
 }catch(error){r.retired=true;r.custody.inventory(error);throw error;}
 });}
/** Settlement exposes no caller-known flag. Missing original physical VM proof keeps the reservation unknown. */
export function readOriginalWorkflowScriptRootSettlement(service:unknown,proof:unknown){
 const r=row(service,proof),execution=apply(get,executions,[r.controller]) as {row:RootRow;runtime?:object}|undefined,terminal=r.acceptance.terminal();r.custody.inventory(terminal.failure);
 const runtime=execution?.row===r&&execution.runtime?readOriginalWorkflowScriptRuntimeFate(r.controller,execution.runtime):null;
 const controller=runtime?readOriginalWorkflowControllerPhysicalFate(r.controller):null;
 return freeze({async waitKnown(){await r.custody.waitPhysicalKnown();if(runtime){await runtime.waitKnown();await controller!.waitKnown();}},assertKnown(){const actual=r.acceptance.terminal();r.custody.inventory(actual.failure);if(!actual.finished)deny('WORKFLOW_ROOT_STILL_ACTIVE');if(!runtime||!controller)deny('WORKFLOW_ROOT_PHYSICAL_FATE_UNCONFIRMED');r.custody.assertPhysicalKnown();runtime.assertKnown();controller.assertKnown();}});
}
