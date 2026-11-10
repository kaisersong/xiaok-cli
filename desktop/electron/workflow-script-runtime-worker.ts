import {parentPort,workerData,isMainThread} from 'node:worker_threads';
import {runWorkflowScript,type WorkflowScriptController,type WorkflowScriptRuntimeOptions} from './workflow-script-runtime.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
const port=parentPort;if(isMainThread||!port)throw Error('WORKFLOW_WORKER_THREAD_REQUIRED');
const apply=Reflect.apply,post=port.postMessage,on=port.on,json=JSON.stringify,parse=JSON.parse,bytes=Buffer.byteLength,keys=Reflect.ownKeys,own=Object.hasOwn,isArray=Array.isArray,integer=Number.isSafeInteger;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,failures=new WeakMap<object,{ref:string;known:boolean}>(),pending=new Map<number,{resolve(value:unknown):void;reject(raw:unknown):void;method:string}>();
const methods=['createAgentNode','emitPhase','emitLog','requestUserInput','beginParallelGroup','reserveBudget','consumeBudget','releaseBudget','checkRemainingBudget','verifyEvidence','markNodeIntervention','markBranchSkipped'];
let sequence=0,sealed=false;
function send(raw:unknown){const body=json(captureDispatchBusinessData(raw,()=>{},true));if(bytes(body)>1048576)throw Error('WORKFLOW_WORKER_FRAME_TOO_LARGE');apply(post,port,[body]);}
function record(raw:unknown):Record<string,unknown>{const value=captureDispatchBusinessData(raw);if(!value||typeof value!=='object'||isArray(value))throw Error('WORKFLOW_WORKER_FRAME_INVALID');return value as Record<string,unknown>;}
const input=record(workerData);if(input.v!==1||typeof input.script!=='string')throw Error('WORKFLOW_WORKER_INPUT_INVALID');const options=record(input.options),available=options.methods;if(!isArray(available))throw Error('WORKFLOW_WORKER_INPUT_INVALID');
const controller={} as WorkflowScriptController;
for(let i=0;i<available.length;i++){const method=available[i];if(typeof method!=='string'||!methods.includes(method))throw Error('WORKFLOW_WORKER_INPUT_INVALID');Object.defineProperty(controller,method,{value:(argument:unknown)=>{
 if(sealed||pending.size>=64||sequence>=1024)throw Error('WORKFLOW_WORKER_CAPACITY');const id=++sequence;
 return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,method});try{const encoded=json(captureDispatchBusinessData({v:1,type:'call',id,method,args:[argument]},()=>{},true));if(bytes(encoded)>131072)throw Error('WORKFLOW_WORKER_CALL_TOO_LARGE');apply(post,port,[encoded]);}catch(raw){pending.delete(id);reject(raw);}});
},enumerable:true});}
apply(on,port,['message',(raw:unknown)=>{
 if(sealed)return;if(typeof raw!=='string'||bytes(raw)>1048576)throw Error('WORKFLOW_WORKER_FRAME_INVALID');const packet=record(parse(raw));if(packet.v!==1||packet.type!=='reply'||!integer(packet.id))throw Error('WORKFLOW_WORKER_FRAME_INVALID');const row=pending.get(packet.id as number);if(!row)throw Error('WORKFLOW_WORKER_FRAME_INVALID');pending.delete(packet.id as number);
 if(packet.ok===true){row.resolve(packet.value);return;}if(packet.ok!==false||typeof packet.errorRef!=='string'||typeof packet.knownBusinessFailure!=='boolean')throw Error('WORKFLOW_WORKER_FRAME_INVALID');const error=Error('workflow_script_controller_failed');apply(set,failures,[error,{ref:packet.errorRef,known:packet.knownBusinessFailure}]);row.reject(error);
}]);
const references=(raw:unknown)=>{if(!isArray(raw))return[];const out:string[]=[];for(let i=0;i<raw.length;i++){const error=raw[i],entry=error&&typeof error==='object'?apply(get,failures,[error]) as {ref:string;known:boolean}|undefined:undefined;if(!entry)throw Error('WORKFLOW_WORKER_UNMAPPED_FAILURE');out[out.length]=entry.ref;}return out;};
void runWorkflowScript(input.script,{controller,concurrency:options.concurrency as number,policy:options.policy as WorkflowScriptRuntimeOptions['policy'],syncTimeoutMs:options.syncTimeoutMs as number,workflowRunId:options.workflowRunId as string,workspaceRoot:options.workspaceRoot as string,isKnownBusinessFailure(error){const row=error&&typeof error==='object'?apply(get,failures,[error]) as {known:boolean}|undefined:undefined;return row?.known===true;}}).then(result=>{
 sealed=true;const {tailFailures,policyConsumedFailures,...data}=result;send({v:1,type:'done',result:data,tailFailureRefs:references(tailFailures),policyConsumedFailureRefs:references(policyConsumedFailures)});
},raw=>{sealed=true;const row=raw&&typeof raw==='object'?apply(get,failures,[raw]) as {ref:string}|undefined:undefined;send({v:1,type:'failed',errorRef:row?.ref??null});});
void keys;void own;
