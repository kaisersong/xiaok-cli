import {readLoopArtifactPage,parseLoopArtifactPageRequest} from './loop-published-artifacts.js';
import type {LoopArtifactPageRequest,LoopArtifactListView} from '../shared/loop-artifacts.js';
import {lstat} from 'node:fs/promises';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {readPublishedArtifact} from '../../src/runtime/verification/published-artifact-reader.js';
import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {createLoopBusinessPublicationHost} from './loop-business-publication-host.js';
import {captureExecutionValue,executionFields,executionIdentity} from './loop-verification-execution.js';
import {openLoopOutputDirectory,readLoopOutputPreview,readLoopTaskResult,resolveUserLoopOutputTarget,LOOP_OUTPUT_PREVIEW_LIMIT_BYTES,looksBinary} from './loop-output-files.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {DesktopShutdownGate} from './shutdown-aware-ipc-main.js';
interface Action {loopId:string;requestSource:'user'|'agent'|'scheduler'}
type Kind='preview'|'task'|'open'|'list';
type ListAction=Action&{page:LoopArtifactPageRequest};
/** Main-only fixed output readers. Observations do not authorize later delivery. */
export function createLoopOutputService(options:{store:LoopStore;evidenceStore:CompletionEvidenceStore;gate:DesktopShutdownGate;captureAdmission():()=>void;taskPort:{recoverTask(id:string):Promise<TaskSnapshot|undefined>};openPath(path:string):Promise<string>}){
 const {store,gate}=options,capture=options.captureAdmission.bind(options),openPath=options.openPath.bind(options),recover=options.taskPort.recoverTask.bind(options.taskPort),lifetime=new AbortController(),pending=new Set<Promise<unknown>>();let closed=false;
 function state(loopId:string){const run=store.listLoopRuns(loopId,1)[0],owners=run?[completionConsumerOwner({ownerKind:'loop_run',ownerId:run.id}),...store.listLoopStages(run.id).map(s=>completionConsumerOwner({ownerKind:'loop_stage',ownerId:s.id}))]:[];
  return {template:store.getUserLoopTemplate(loopId),definition:store.getLoopDefinition(loopId),run,configuration:store.getLoopPublicationConfiguration(loopId),basis:run?store.getLoopRunPublicationBasis(run.id):undefined,routes:owners.map(readInstalledCurrentOwner),version:store.getAutomationStoreVersion()};
 }
 async function execute(input:Action&{page?:LoopArtifactPageRequest},kind:Kind):Promise<Record<string,unknown>|LoopArtifactListView>{
  if(closed)throw Error('loop_output_closed');const writer=gate.acquire('external','loop-output-consumer');let host:ReturnType<typeof createLoopBusinessPublicationHost>|undefined;
  try{
   const admission=capture(),original=state(input.loopId),key=JSON.stringify(original),signal=lifetime.signal;
   function check(){signal.throwIfAborted();if(closed||!gate.isOpen)throw Error('loop_output_closed');const result:unknown=admission();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('loop_output_admission_sync');}if(JSON.stringify(state(input.loopId))!==key)throw Error('loop_output_changed');signal.throwIfAborted();}check();
   if(!original.template){if(kind==='list')throw Error('loop_not_found');return {ok:false,loopId:input.loopId,error:'loop_not_found'};}
   if((kind==='preview'||kind==='open')&&original.template.kind!=='markdown_file')throw Error('loop_output_template_kind');
   const protectedRun=!!(original.configuration||original.basis||original.routes.some(r=>r.kind!=='ordinary'));
   if(kind==='list'&&!protectedRun)throw Error('loop_output_publication_pending');
   if(!protectedRun){
    let result:Record<string,unknown>;
    if(kind==='open')result=await openLoopOutputDirectory(input.loopId,original.template,{openPath},check);
    else if(kind==='preview')result=await readLoopOutputPreview(input.loopId,original.template,check);
    else result=await readLoopTaskResult(input.loopId,{loopStore:store,evidenceStore:options.evidenceStore},{recoverTask:async id=>({snapshot:await recover(id)})},check);
    check();return kind==='open'&&result.ok?{...result,origin:'workspace_navigation'}:result;
   }
   if(!original.run||original.run.status!=='success'||original.definition?.status!=='active')throw Error('loop_output_publication_pending');
   host=createLoopBusinessPublicationHost({store,assertAdmission:check,taskPort:{recoverTask:recover}});
   const action={runId:original.run.id,requestSource:'user' as const,signal};
   const output=await host.readUserTemplateOutput(action);check();output.assertCurrent();
   const {contract,body}=output.binding;
   if(contract.kind!=='user-template'||body.kind!=='user-template'||contract.templateKind!==original.template.kind||contract.outputDirectory!==original.template.outputDirectory||contract.outputFileName!==original.template.outputFileName)throw Error('loop_output_binding');
   if(kind==='list'){const page=readLoopArtifactPage(output.binding,output.payload,input.page!);output.assertCurrent();check();return {...page,loopId:input.loopId,checkedAt:Date.now()};}
   if(kind==='task')return {ok:true,loopId:input.loopId,runId:original.run.id,taskId:body.taskId,content:body.summary,origin:'verified_publication',checkedAt:Date.now()};
   const target=resolveUserLoopOutputTarget(input.loopId,original.template);if(!target.ok)return target;
   const descriptors=body.artifacts.filter(a=>a.selection.path===contract.outputFileName);if(descriptors.length!==1)throw Error('loop_output_artifact_not_unique');
   const artifact=readPublishedArtifact(output.payload,descriptors[0].selection);
   if(artifact.sha256!==descriptors[0].sha256||artifact.size!==descriptors[0].size)throw Error('loop_output_artifact_changed');
   if(kind==='preview'){
    if(artifact.size>LOOP_OUTPUT_PREVIEW_LIMIT_BYTES)return {ok:false,loopId:input.loopId,error:'output_file_too_large',sizeBytes:artifact.size,limitBytes:LOOP_OUTPUT_PREVIEW_LIMIT_BYTES};
    if(looksBinary(artifact.bytes))return {ok:false,loopId:input.loopId,error:'output_file_binary',sizeBytes:artifact.size};
    const content=new TextDecoder('utf-8',{fatal:true}).decode(artifact.bytes);output.assertCurrent();check();
    return {ok:true,loopId:input.loopId,runId:original.run.id,pathLabel:target.outputPath,content,sizeBytes:artifact.size,truncated:false,origin:'verified_publication',checkedAt:Date.now()};
   }
   // This navigates the user's configured workspace path. It never exports or
   // grants authority to its files; the OS resolves that mutable path itself.
   const directory=await lstat(target.outputDirectory);check();if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('loop_output_directory_changed');
   const local=await readLoopOutputPreview(input.loopId,original.template,check,16*1024**2);check();if(!local.ok||typeof local.content!=='string'||!Buffer.from(local.content,'utf8').equals(artifact.bytes))throw Error('loop_output_file_changed');
   const latest=await host.readUserTemplateOutput(action);check();latest.assertCurrent();
   if(json(latest.binding)!==json(output.binding)||latest.payload.payloadHash!==output.payload.payloadHash)throw Error('loop_output_publication_changed');
   const error=await openPath(target.outputDirectory);check();
   const after=await host.readUserTemplateOutput(action);check();after.assertCurrent();
   if(json(after.binding)!==json(output.binding)||after.payload.payloadHash!==output.payload.payloadHash)throw Error('loop_output_publication_changed');
   return error?{ok:false,loopId:input.loopId,error:'open_output_directory_failed',message:error,pathLabel:target.outputDirectory}:{ok:true,loopId:input.loopId,pathLabel:target.outputDirectory,origin:'workspace_navigation'};
  }finally{try{await host?.close();}finally{writer.release();}}
 }
 function act(raw:ListAction,kind:'list'):Promise<LoopArtifactListView>;
 function act(raw:Action,kind:Exclude<Kind,'list'>):Promise<Record<string,unknown>>;
 function act(raw:Action|ListAction,kind:Kind){try{const input=captureExecutionValue(raw);executionFields(input,['loopId','requestSource',...(kind==='list'?['page']:[])]);executionIdentity(input.loopId);if(kind==='list')parseLoopArtifactPageRequest((input as ListAction).page);if(input.requestSource!=='user')throw Error('loop_output_source');if(closed)throw Error('loop_output_closed');const work=execute(input,kind);pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}catch(error){return Promise.reject(error);}}
 return Object.freeze({listPublishedArtifacts:(raw:ListAction)=>act(raw,'list'),readOutputPreview:(raw:Action)=>act(raw,'preview'),readTaskResult:(raw:Action)=>act(raw,'task'),openOutputDirectory:(raw:Action)=>act(raw,'open'),async close(){closed=true;lifetime.abort(Error('loop_output_closed'));await Promise.allSettled([...pending]);}});
}
export type LoopOutputService=ReturnType<typeof createLoopOutputService>;
export {registerLoopOutputIpc} from './loop-output-ipc.js';
