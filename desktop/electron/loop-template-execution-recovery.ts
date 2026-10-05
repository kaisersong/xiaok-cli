import type {LoopStore} from './loop-store.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import {canonicalVerificationJson as json} from '../../src/runtime/verification/protocol.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {captureLoopRunContext} from './loop-run-context.js';
import {resolveUserLoopOutputTarget,verifyMarkdownFile} from './loop-template-files.js';
import {evaluateLoopContract} from './loop-evaluator.js';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
interface RecoveryTicket {store:LoopStore;kind:'execution'|'terminal';runId:string;executeStageId:string;now:number;vector:string;snapshot:TaskSnapshot;verifyStageId?:string;file?:{path:string;hash:string};summary?:string;weakTerminal?:true}
const tickets=new WeakMap<object,RecoveryTicket>();
export function readLoopTemplateRecoveryVector(store:LoopStore,runId:string):string {
 return json(captureLoopProducerValue({run:store.getLoopRun(runId)??null,basis:store.getLoopRunPublicationBasis(runId)??null,stages:store.listLoopStages(runId),lifecycle:store.getLoopRunLifecycle(runId)??null,candidates:store.listLoopPublicationCandidates(runId)}));
}
function fileHash(path:string):string {const stat=statSync(path);if(!stat.isFile()||stat.size>32*1024*1024)throw Error('loop_template_recovery_file');return createHash('sha256').update(readFileSync(path)).digest('hex');}
/** Main composition supplies the original bound TaskHost reader, never an IPC DTO. */
export function createLoopTemplateExecutionRecovery(options:{store:LoopStore;taskPort:{recoverTask(taskId:string):Promise<{snapshot:TaskSnapshot}>}}){
 const store=options.store,read=options.taskPort.recoverTask.bind(options.taskPort);
 async function prepare(raw:{runId:string;executeStageId:string;verifyStageId?:string;requestSource:'user'|'agent'|'scheduler';now:number},kind:'execution'|'terminal',weak=false):Promise<object>{
  const input=captureLoopProducerValue(raw);if(Object.keys(input).sort().join(',')!==(kind==='execution'?'executeStageId,now,requestSource,runId':'executeStageId,now,requestSource,runId,verifyStageId'))throw Error('loop_template_recovery_shape');captureLoopRunContext({requestSource:input.requestSource});
  const vector=readLoopTemplateRecoveryVector(store,input.runId),run=store.getLoopRun(input.runId),basis=store.getLoopRunPublicationBasis(input.runId),stage=store.listLoopStages(input.runId).find(s=>s.id===input.executeStageId);
  if(!run||!basis||basis.contract.kind!=='user-template'||run.status!=='running'||!stage||stage.stageKind!=='execute'||stage.status!=='running'||typeof stage.metadata.taskId!=='string')throw Error('loop_template_recovery_original');
  const actual=await read(stage.metadata.taskId),snapshot=captureLoopProducerValue(actual.snapshot) as TaskSnapshot;
  if(snapshot.taskId!==stage.metadata.taskId||readLoopTemplateRecoveryVector(store,input.runId)!==vector)throw Error('loop_template_recovery_changed');
  if(snapshot.status!=='completed')throw Error('loop_template_recovery_task_pending');
  const entry:RecoveryTicket={store,kind,runId:input.runId,executeStageId:input.executeStageId,now:input.now,vector,snapshot};
  if(kind==='terminal'){
   const template=store.getUserLoopTemplate(run.loopId),verify=store.listLoopStages(run.id).find(s=>s.id===input.verifyStageId);
   if(!template||(!weak&&template.kind!=='markdown_file')||(weak&&template.kind!=='task_completion')||!verify||verify.stageKind!=='verify'||verify.metadata.taskId!==snapshot.taskId)throw Error('loop_template_recovery_original');
   if(!weak&&verify.metadata.localEvaluationStarted===true)throw Error('loop_template_evaluation_started');
   if(weak){
    if(!template.contract.successCriteria.length||!template.contract.successCriteria.every(c=>c.kind==='task_completed'&&c.strength==='weak'))throw Error('loop_template_recovery_verifier');
    const evaluation=await evaluateLoopContract({runId:run.id,contract:template.contract,registry:{},evidenceBundle:{snapshot,taskId:snapshot.taskId}});
    if(evaluation.status!=='blocked'||json(verify.metadata.localEvaluation)!==json(evaluation)||readLoopTemplateRecoveryVector(store,input.runId)!==vector)throw Error('loop_template_recovery_changed');
    entry.verifyStageId=verify.id;entry.weakTerminal=true;entry.summary='Task execution ended; awaiting independent verification.';
   }else{
   // Recovery only repeats the existing read-only file verifier, never a command.
   if(template.contract.successCriteria.some(c=>c.kind!=='file_exists'&&!(c.kind==='task_completed'&&c.strength==='weak')))throw Error('loop_template_recovery_verifier');
   const target=resolveUserLoopOutputTarget(template);if(!target.ok)throw Error('loop_template_recovery_file');
   const captured=fileHash(target.outputPath);
   const evaluation=await evaluateLoopContract({runId:run.id,contract:template.contract,registry:{file_exists:async()=>verifyMarkdownFile(target.outputPath).ok?{status:'passed'}:{status:'blocked'}},evidenceBundle:{snapshot,taskId:snapshot.taskId,outputPath:target.outputPath}});
   if(evaluation.status!=='success'||fileHash(target.outputPath)!==captured||readLoopTemplateRecoveryVector(store,input.runId)!==vector)throw Error('loop_template_recovery_changed');
   entry.verifyStageId=verify.id;entry.file={path:target.outputPath,hash:captured};entry.summary=`Markdown file artifact verified: ${target.outputPath}`;
   }
  }
  const token=Object.freeze({});tickets.set(token,entry);return token;
 }
 return Object.freeze({prepareExecution:(raw:{runId:string;executeStageId:string;requestSource:'user'|'agent'|'scheduler';now:number})=>prepare(raw,'execution'),prepareMarkdownTerminal:(raw:{runId:string;executeStageId:string;verifyStageId:string;requestSource:'user'|'agent'|'scheduler';now:number})=>prepare(raw,'terminal'),prepareWeakTerminal:(raw:{runId:string;executeStageId:string;verifyStageId:string;requestSource:'user'|'agent'|'scheduler';now:number})=>prepare(raw,'terminal',true)});
}
export function consumeLoopTemplateExecutionRecovery(token:object,store:LoopStore,kind:'execution'|'terminal'='execution'):RecoveryTicket {
 const entry=tickets.get(token);tickets.delete(token);if(!entry||entry.store!==store||entry.kind!==kind)throw Error('loop_template_recovery_ticket');return entry;
}
export function assertLoopTemplateRecoveryFile(entry:RecoveryTicket):void {if(entry.weakTerminal)return;if(!entry.file||fileHash(entry.file.path)!==entry.file.hash)throw Error('loop_template_recovery_file');}
