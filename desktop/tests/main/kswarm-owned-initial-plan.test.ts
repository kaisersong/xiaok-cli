// @vitest-environment node
import {createHash} from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHub} from '../../../../kswarm/src/core/hub.js';
import {createProjectInputAuthority} from '../../../../kswarm/src/core/project-input-authority.js';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue} from '../../electron/kswarm-initial-plan-bootstrap.js';
import {executeOwnedInitialPlanBootstrap} from '../../electron/kswarm-owned-initial-plan.js';
const closes:Array<()=>void>=[];afterEach(()=>{for(const close of closes.splice(0))close();});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'owned-initial-plan-'));const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},authority=createProjectInputAuthority(scope);
 const hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite')},brokerClient:{async getRoomSnapshot(){return {ok:true,room:{status:'active'},members:[{status:'active',subject:{kind:'agent',logicalAgentId:'po'}}]};},async acquireRoomMembershipLease(){return {ok:true};}}});
 closes.push(()=>{hub.closePersistence();rmSync(root,{recursive:true,force:true});});
 await hub.createProject({id:'p',name:'P',goal:'G',poAgent:'po',primaryRoomId:'room',autoAssignPo:false,requestedStartPolicy:'plan_only'},{requestSource:'user',projectInputAuthority:authority.creator('main-create')});
 const state=hub.readInitialPlanInputs('p',authority.reader()),store=new JsonKSwarmInitialPlanBootstrapStore(root);
 store.upsertPending({projectId:'p',projectName:'P',goal:'G',requirements:'',planningGuidance:'',poAgent:'po',members:[],startPolicy:'plan_only',ownerBinding:state.ownerBinding},1);
 const [job]=store.claimDue(2,1);let modelCalls=0,loseCommit=false,failModel=false,failCommitBeforeApply=false;
 const gateway={getDesktopMutationToken:()=> 'fixture-only',async request(path:string,init?:RequestInit){
  expect(new Headers(init?.headers).get('x-kswarm-mutation-token')).toBe('fixture-only');
  let result;
  if(path.endsWith('/initial-plan-inputs/claim'))result=hub.claimInitialPlanInputs('p',JSON.parse(String(init?.body)),authority.planner());
  else if(path.endsWith('/initial-plan-inputs/commit')){if(failCommitBeforeApply){failCommitBeforeApply=false;throw Error('commit_connection_closed');}result=hub.commitInitialPlan('p',JSON.parse(String(init?.body)),authority.planner());if(loseCommit){loseCommit=false;throw Error('commit_response_lost');}}
  else if(path.endsWith('/initial-plan-inputs'))result=hub.readInitialPlanInputs('p',authority.reader());
  else throw Error('unexpected_route');
  return Response.json(result,{status:result.ok?200:409});
 }};
 const deps={store,gateway,scope,async generateCandidate({beforeStart}:{beforeStart:()=>void}){
  beforeStart();modelCalls++;if(failModel)throw Error('model_response_unknown');
  return {plan:{analysis:'generated',phases:[]},tasks:[{id:'task-1',title:'Create report'}]};
 }};
 return {root,hub,store,job,deps,get modelCalls(){return modelCalls;},loseNextCommit(){loseCommit=true;},failNextModel(){failModel=true;},failCommitBeforeApply(){failCommitBeforeApply=true;}};
}
it('uses the real owner claim, commits the actual board once, and reads replay without another model attempt',async()=>{
 const f=await fixture();expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:true});
 expect(f.modelCalls).toBe(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);
 expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:true});expect(f.modelCalls).toBe(1);
});
it('recovers a lost atomic owner commit response from the exact receipt without another model call',async()=>{
 const f=await fixture();f.loseNextCommit();expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:true});
 expect(f.modelCalls).toBe(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);
});
it('an unknown physical model outcome is never retried from the same persisted job',async()=>{
 const f=await fixture();f.failNextModel();expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:false,launchOutcome:'unknown'});
 expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:false,launchOutcome:'unknown'});
 expect(f.modelCalls).toBe(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(0);
});
it('wrong current workspace and a stale job claim cannot obtain a model or owner mutation',async()=>{
 const f=await fixture();expect(await executeOwnedInitialPlanBootstrap(f.job,{...f.deps,scope:{...f.deps.scope,workspaceId:'c'.repeat(64)}},new AbortController().signal)).toMatchObject({ok:false});
 expect(await executeOwnedInitialPlanBootstrap({...f.job,claimToken:'stale'},f.deps,new AbortController().signal)).toMatchObject({ok:false});
 expect(f.modelCalls).toBe(0);expect(f.hub.readInitialPlanInputs('p',createProjectInputAuthority(f.deps.scope).reader()).reservation).toBeNull();
});
it('a candidate journal survives restart and retries only submission after an unconfirmed commit',async()=>{
 const f=await fixture();f.failCommitBeforeApply();expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:false});
 expect(f.modelCalls).toBe(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(0);
 f.store.markFailed('p',3,'commit response unknown',f.job.claimToken!);
 const reopened=new JsonKSwarmInitialPlanBootstrapStore(f.root);const [retry]=reopened.claimDue(100000,1);
 expect(await executeOwnedInitialPlanBootstrap(retry,{...f.deps,store:reopened},new AbortController().signal)).toMatchObject({ok:true});
 expect(f.modelCalls).toBe(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);
});

it('a real owner preflight interrupted before model start remains safely retryable under the original run identity',async()=>{
 const f=await fixture();f.store.markFailed('p',3,'not yet executed',f.job.claimToken!);
 let queue!:KSwarmInitialPlanBootstrapQueue,interrupted=false;
 const request=f.deps.gateway.request.bind(f.deps.gateway);
 f.deps.gateway.request=async(path,init)=>{
  const response=await request(path,init);
  if(!interrupted && path.endsWith('/initial-plan-inputs')){interrupted=true;queue.abortActive('app_shutdown');}
  return response;
 };
 queue=new KSwarmInitialPlanBootstrapQueue(f.store,(job,signal)=>executeOwnedInitialPlanBootstrap(job,f.deps,signal),{now:()=>100000,setTimeoutFn:()=>({unref(){}} as NodeJS.Timeout)});
 await queue.runOnce();queue.stopAccepting();
 expect(f.modelCalls).toBe(0);expect(f.store.list()[0]).toMatchObject({status:'pending',planRunId:f.job.planRunId});
 const reopened=new JsonKSwarmInitialPlanBootstrapStore(f.root);
 const next=new KSwarmInitialPlanBootstrapQueue(reopened,(job,signal)=>executeOwnedInitialPlanBootstrap(job,{...f.deps,store:reopened},signal),{now:()=>100000000,setTimeoutFn:()=>({unref(){}} as NodeJS.Timeout)});
 try{await next.runOnce();expect(reopened.list()[0]).toMatchObject({status:'succeeded',planRunId:f.job.planRunId});expect(f.modelCalls).toBe(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);}
 finally{next.stopAccepting();await next.drain();}
});

it('a real owner CAS conflict refreshes only an unclaimed input revision and consumes the whole new input exactly once',async()=>{
 const f=await fixture();const original=f.deps.gateway.request.bind(f.deps.gateway);let raced=false;
 const body='New user planning requirement',hash=createHash('sha256').update(body).digest('hex');
 const source={schemaVersion:1,...f.deps.scope,threadId:'thread',canonicalUserTaskId:'main-user-task:'+hash,canonicalMessageId:'main-user-message:'+hash,promptSha256:hash,permissionMode:'auto',sourceGoalId:'g',sourceGoalEpoch:1,sourceGoalTurnId:'t'};
 const authority=createProjectInputAuthority(f.deps.scope);let operationId='';
 f.deps.gateway.request=async(path,init)=>{
  const response=await original(path,init);
  if(!raced && path.endsWith('/initial-plan-inputs')){raced=true;const result=f.hub.applyOrdinaryProjectInput('p',{action:'add_plan_input',body,sourceMessageId:source.canonicalMessageId,expectedProjectRevision:f.hub.getProject('p').projectRevision},authority.user(source));expect(result.ok).toBe(true);operationId=result.operation.operationId;}
  return response;
 };
 const first=await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal);expect(first).toMatchObject({ok:false,error:'PLAN_INPUT_REVISION_CONFLICT'});expect(f.modelCalls).toBe(0);
 const request=f.store.list()[0].ownerClaimRequest!;
 expect(()=>f.store.recordOwnerClaimRequest('p',f.job.claimToken!,{...request,expectedPlanInputRevision:1},{...f.job.ownerBinding,planInputRevision:1} as never)).toThrow();
 f.store.markFailed('p',3,'input revision changed',f.job.claimToken!);const [retry]=f.store.claimDue(100000,1);
 expect(await executeOwnedInitialPlanBootstrap(retry,f.deps,new AbortController().signal)).toMatchObject({ok:true});expect(f.modelCalls).toBe(1);
 expect(f.hub.readOrdinaryProjectOperation('p',operationId,authority.reader()).acknowledged).toBe(true);
 expect(f.store.list()[0].ownerClaimRequest?.expectedPlanInputRevision).toBe(1);
 expect(f.store.list()[0].ownerClaimRequestHistory?.[0].expectedPlanInputRevision).toBe(0);
});

it.each(['close','delete'] as const)('the original Main job cannot start a model after an authenticated owner %s settles its pending input',async terminal=>{
 const f=await fixture(),authority=createProjectInputAuthority(f.deps.scope),body='Original pending input',hash=createHash('sha256').update(body).digest('hex');
 const source={schemaVersion:1,...f.deps.scope,threadId:'thread',canonicalUserTaskId:'main-user-task:'+hash,canonicalMessageId:'main-user-message:'+hash,promptSha256:hash,permissionMode:'auto',sourceGoalId:'goal',sourceGoalEpoch:1,sourceGoalTurnId:'turn'};
 const pending=f.hub.applyOrdinaryProjectInput('p',{action:'add_plan_input',body,sourceMessageId:source.canonicalMessageId,expectedProjectRevision:f.hub.getProject('p').projectRevision},authority.user(source));expect(pending.ok).toBe(true);
 const control={requestSource:'user',projectInputAuthority:authority.reader()};
 expect((terminal==='close'?f.hub.handleCloseProject('p','',control):f.hub.deleteProject('p',control)).ok).toBe(true);
 const original=f.store.list()[0];
 for(let n=0;n<2;n++)expect(await executeOwnedInitialPlanBootstrap(f.job,f.deps,new AbortController().signal)).toMatchObject({ok:false,error:terminal==='close'?'PROJECT_TERMINAL_REQUIRES_REOPEN':'PROJECT_NOT_FOUND'});
 expect(f.modelCalls).toBe(0);expect(f.store.list()[0]).toEqual(original);
 const observed=f.hub.readOrdinaryProjectOperation('p',pending.operation.operationId,authority.reader());
 expect(observed).toMatchObject({terminal:true,acknowledged:false,consumption:{state:'not_consumed'},operation:{status:'voided',projectDisposition:terminal==='close'?'closed':'deleted'}});
});
