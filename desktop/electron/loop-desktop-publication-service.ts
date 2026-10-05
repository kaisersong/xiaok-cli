import type {AssistantCandidatePromotionTargets} from './assistant-candidate-promotion.js';
import type {BrowserWindow} from 'electron';
import {realpathSync} from 'node:fs';
import {createLoopNativeWorkflow} from './loop-native-workflow.js';
import {createLoopVerificationSessionHost} from './loop-verification-session-host.js';
import {createLoopPublicationWorkflow} from './loop-publication-workflow.js';
import {createLoopBusinessPublicationHost} from './loop-business-publication-host.js';
import {captureExecutionValue,executionFields,executionIdentity} from './loop-verification-execution.js';
import {freezeLoopPublicationValue} from './loop-publication-config.js';
import type {LoopStore} from './loop-store.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import type {LoopPublicationAction,LoopPublicationActionResult,LoopPublicationStateView} from '../shared/loop-publication-types.js';

type Source='user'|'agent'|'scheduler';
const actionFields:Record<LoopPublicationAction['kind'],string[]>={
 saveConfiguration:['loopId','expectedRevision','configuration'],reserveNative:['candidateId','expectedLatestAttemptId'],
 reauthorizeNative:['attemptId','expectedRevision'],advanceNative:['attemptId'],recoverNative:['attemptId'],prepareSession:['nativeAttemptId','obligationId'],
 recoverSession:['id'],enrollSession:['id'],recoverEnrollment:['id'],verify:['id','exactCommand','expiresAt'],
 recoverVerification:['id'],publish:['nativeAttemptId','expectedLatestAttemptId'],recoverPublication:['attemptId'],project:['runId'],inspect:['runId'],
};
const recoveries=new Set<LoopPublicationAction['kind']>(['recoverNative','recoverSession','recoverEnrollment','recoverVerification','recoverPublication']);

/** Fixed Main composition. This object is never placed in an agent registry.
 * One interactive operation owns its captured permission guard until real drain. */
export function createDesktopLoopPublicationService(options:{
 store:LoopStore;sessionRoot:string;workspaceRoot:string;window?:BrowserWindow;getWindow?:()=>BrowserWindow|undefined;
 assistantTargets?:AssistantCandidatePromotionTargets;assistantProjectCwd?:(projectId:string)=>string|undefined;
 captureAdmission():()=>void;taskPort:{recoverTask(taskId:string):Promise<TaskSnapshot|undefined>};
}){
 const store=options.store,workspace=realpathSync(options.workspaceRoot),captureAdmission=options.captureAdmission.bind(options);
 const lifetime=new AbortController();let closed=false,active:Promise<unknown>|undefined,guard:(()=>void)|undefined;
 let closing:Promise<void>|undefined,drained=false,claiming=false;
 function open(){if(closed)throw Error('loop_desktop_publication_closed');}
 function assertAdmission(){open();if(!guard)throw Error('loop_desktop_publication_no_admission');const result:unknown=guard();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('loop_desktop_publication_admission_sync');}open();lifetime.signal.throwIfAborted();}
 const native=createLoopNativeWorkflow({store,assertAdmission});
 const sessions=createLoopVerificationSessionHost({store,sessionRoot:options.sessionRoot,workspaceRoot:workspace,window:options.window,getWindow:options.getWindow,assertAdmission});
 const publication=createLoopPublicationWorkflow({store,assertAdmission});
 const business=createLoopBusinessPublicationHost({store,assertAdmission,taskPort:options.taskPort,assistantTargets:options.assistantTargets,assistantProjectCwd:options.assistantProjectCwd});
 async function run(input:LoopPublicationAction&{requestSource:Source}):Promise<LoopPublicationActionResult>{
  assertAdmission();const {kind,requestSource,...value}=input;
  // The closed union is checked before dispatch. Every callee retains its own
  // exact target/source validation and original request recovery protocol.
  const action={...value,requestSource} as any;
  let result:any;
  switch(kind){
   case 'saveConfiguration':result=store.saveLoopPublicationConfiguration({...action,now:Date.now()});break;
   case 'reserveNative':result=native.reserve(action);break;
   case 'reauthorizeNative':result=await native.reauthorizeApplication({...action,signal:lifetime.signal});break;
   case 'advanceNative':result=await native.advance({...action,signal:lifetime.signal});break;
   case 'recoverNative':result=await native.recover({...action,signal:lifetime.signal});break;
   case 'prepareSession':result=await sessions.prepare(action);break;
   case 'recoverSession':result=await sessions.recover(action);break;
   case 'enrollSession':result=await sessions.enroll(action);break;
   case 'recoverEnrollment':result=await sessions.recoverEnrollment(action);break;
   case 'verify':result=await sessions.verify(action);break;
   case 'recoverVerification':result=await sessions.recoverVerification(action);break;
   case 'publish':result=await publication.start({...action,signal:lifetime.signal});break;
   case 'recoverPublication':result=await publication.recover({...action,signal:lifetime.signal});break;
   case 'project':result=await business.project({...action,signal:lifetime.signal});break;
   case 'inspect':await business.inspect({...action,signal:lifetime.signal});assertAdmission();return {kind,inspection:{runId:(input as Extract<LoopPublicationAction,{kind:'project'|'inspect'}>).runId,checkedAt:Date.now()}};
  }
  assertAdmission();return freezeLoopPublicationValue({kind,...(result?.attemptId||result?.id?{recordId:result.attemptId??result.id}:{}),...(result?.phase||result?.status?{phase:result.phase??result.status}:{}),...(result?.generation?{generation:result.generation}:{})});
 }
 function exclusive<T>(execute:()=>Promise<T>):Promise<T>{
  try{
   open();if(active||claiming)throw Error('loop_desktop_publication_busy');
   claiming=true;let captured:()=>void;
   try{captured=captureAdmission();open();if(typeof captured!=='function')throw Error('loop_desktop_publication_admission');}finally{claiming=false;}
   guard=captured;const work=Promise.resolve().then(execute);active=work;
   const release=()=>{if(active===work){active=undefined;guard=undefined;}};void work.then(release,release);return work;
  }catch(error){return Promise.reject(error);}
 }
 function perform(raw:LoopPublicationAction&{requestSource:Source}):Promise<LoopPublicationActionResult>{
  try{
   open();const input=captureExecutionValue(raw);if(!input||typeof input!=='object'||!Object.hasOwn(actionFields,input.kind))throw Error('loop_desktop_publication_action');
   executionFields(input,['kind','requestSource',...actionFields[input.kind]]);
   if(input.requestSource!=='user'&&!(input.requestSource==='scheduler'&&recoveries.has(input.kind)))throw Error('loop_desktop_publication_source');
   return exclusive(()=>run(input));
  }catch(error){return Promise.reject(error);}
 }
 function assistantAction(raw:unknown,kind:'accept'|'recover'|'read'){
  try{
   open();const input=captureExecutionValue(raw) as Record<string,any>;
   const key=kind==='read'?'runId':'candidateId';
   const optional=kind==='accept'&&input&&Object.hasOwn(input,'collectionId')?['collectionId']:[];
   executionFields(input,[key,'requestSource',...optional]);executionIdentity(input[key]);if(optional.length)executionIdentity(input.collectionId);
   if(input.requestSource!=='user'&&!(input.requestSource==='scheduler'&&kind!=='accept'))throw Error('loop_desktop_publication_source');
   return exclusive(async()=>{
    assertAdmission();const action={...input,signal:lifetime.signal} as any;
    const result=kind==='accept'?await business.acceptAssistantCandidate(action):kind==='recover'?await business.recoverAssistantCandidate(action):await business.readAssistantOutput(action);
    assertAdmission();return result;
   });
  }catch(error){return Promise.reject(error);}
 }
 function close():Promise<void>{
  if(closing)return closing;closed=true;lifetime.abort(Error('loop_desktop_publication_closed'));
  const pending=active;
  // Each close is invoked even when a sibling throws/rejects. Rejected work is
  // drained work; a rejected close is not proof of a closed host.
  closing=Promise.allSettled([native,sessions,publication,business].map(host=>Promise.resolve().then(()=>host.close())).concat(pending?[pending.then(()=>{},()=>{})]:[])).then(results=>{
   const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'loop_desktop_publication_drain_failed');drained=true;
  });void closing.catch(()=>{});return closing;
 }
 return Object.freeze({
  perform,
  // Main-only semantic composition; these are not added to the renderer action union.
  acceptAssistantCandidate(input:{candidateId:string;collectionId?:string;requestSource:Source}){return assistantAction(input,'accept') as ReturnType<typeof business.acceptAssistantCandidate>;},
  recoverAssistantCandidate(input:{candidateId:string;requestSource:Source}){return assistantAction(input,'recover') as ReturnType<typeof business.recoverAssistantCandidate>;},
  readAssistantOutput(input:{runId:string;requestSource:Source}){return assistantAction(input,'read') as ReturnType<typeof business.readAssistantOutput>;},
  getConfiguration(loopId:string){open();executionIdentity(loopId);return store.getLoopPublicationConfiguration(loopId)??null;},
  getState(runId:string):Readonly<LoopPublicationStateView>{
   open();executionIdentity(runId);const run=store.getLoopRun(runId),basis=store.getLoopRunPublicationBasis(runId);if(!run)throw Error('loop_desktop_publication_run_missing');
   const projection=store.getLoopBusinessProjection(runId);
   const candidates=store.listLoopPublicationCandidates(runId).map(candidate=>{
    if(!basis||candidate.binding.subject.loopId!==run.loopId)throw Error('loop_desktop_publication_relationship');
    const stage=candidate.binding.subject.stage,definitions=basis.configuration.configuration.verificationDefinitions,definition=stage?definitions.stages[stage.stageKind]:definitions.run;
    if(!definition)throw Error('loop_desktop_publication_definition');
    return {candidateId:candidate.candidateId,stageKind:stage?.stageKind??null,definition,
     natives:store.listLoopNativeAttempts(candidate.candidateId).map(n=>({id:n.attemptId,kind:n.kind,revision:n.revision,phase:n.phase,sessions:store.listLoopVerificationSessions(n.attemptId).map(s=>({id:s.id,obligationId:s.obligationId,phase:s.phase,executions:store.listLoopVerificationExecutions(s.id).map(e=>({id:e.id,phase:e.phase,exactCommand:e.exactCommand,expiresAt:e.expiresAt}))}))})),
     publications:store.listLoopPublicationAttempts(candidate.candidateId).map(p=>({id:p.attemptId,nativeAttemptId:p.nativeAttemptId,status:p.status}))};
   });
   return freezeLoopPublicationValue({historyOnly:true as const,runId,loopId:run.loopId,workspaceRoot:workspace,businessState:store.getLoopRunLifecycle(runId)?.businessState??'publication_pending',projection:projection?{generation:projection.generation,generationHash:projection.generationHash}:null,candidates});
  },
  stopAccepting(){void close();},abortAllActive(){void close();},close,
  async drain(deadlineMs:number):Promise<boolean>{
   if(!Number.isFinite(deadlineMs)||deadlineMs<0)throw Error('loop_desktop_publication_deadline');
   const work=close();if(drained)return true;if(deadlineMs===0)return false;
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{return await Promise.race([work.then(()=>true,()=>false),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),deadlineMs);})]);}finally{if(timer)clearTimeout(timer);}
  },
 });
}
export type DesktopLoopPublicationService=ReturnType<typeof createDesktopLoopPublicationService>;
