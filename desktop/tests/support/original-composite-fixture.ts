// @vitest-environment node
// Original B/Host/source/journal components. IPC role port is controlled here;
// real window/actor admission is covered by project-planning-controls, no Native grant.
import {expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHub} from '../../../../kswarm/src/core/hub.js';
import {createProjectInputAuthority} from '../../../../kswarm/src/core/project-input-authority.js';
import {ConversationProjectService} from '../../electron/conversation-project-service.js';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue} from '../../electron/kswarm-initial-plan-bootstrap.js';
import {createInitialPlanOwnerClient} from '../../electron/kswarm-initial-plan-owner-client.js';
import {registerProjectPlanningIpc} from '../../electron/project-planning-typed-ipc.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
export async function createOriginalCompositeFixture(closes:Array<()=>Promise<void>>,options:{databaseFileName?:'b.sqlite'|'state.sqlite';poAgent?:string}={}){
 const poAgent=options.poAgent??'po',root=mkdtempSync(join(tmpdir(),'original-main-composite-')),workspace=join(root,'workspace');mkdirSync(workspace);const hash=(value:string)=>createHash('sha256').update(resolve(value)).digest('hex'),scope={profileId:hash(root),workspaceId:hash(workspace)},authority=createProjectInputAuthority(scope),userSubmissions=new MainUserSubmissionOwner({dataRoot:root,...scope});
 const hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,options.databaseFileName??'b.sqlite')},brokerClient:{async getRoomSnapshot(){return{ok:true,room:{status:'active'},members:[{status:'active',subject:{kind:'agent',logicalAgentId:poAgent}}]};},async acquireRoomMembershipLease(){return{ok:true};}}});expect(hub.prepareOrdinaryTaskInputWriter({requestSource:'user',projectInputAuthority:authority.reader()}).ok).toBe(true);await hub.createProject({id:'p',name:'Original P',goal:'Original project goal',poAgent,members:[],primaryRoomId:'room',requestedStartPolicy:'plan_only',autoAssignPo:false},{requestSource:'user',projectInputAuthority:authority.creator('main-create','ordinary_initial_plan_additive_v2')});
 const gateway={submitTaskMetadataOnce:async(projectId:string,envelope:any,context:any)=>{expect(context.requestSource).toBe('user');const body=hub.applyOrdinaryTaskMetadataInput(projectId,envelope.input,{requestSource:'user',projectInputAuthority:authority.user(envelope.source),initialPlanningAuthority:authority.planner(),initialPlanClaim:envelope.initialPlanClaim});return{ok:body.ok,status:body.ok?200:409,body};},getDesktopMutationToken:()=> 'fixture-token',request:async(path:string)=>{if(path==='/projects/p')return Response.json({ok:true,project:hub.getProject('p')});const value=path.includes('/ordinary-inputs/')?hub.readOrdinaryProjectOperation('p',decodeURIComponent(path.split('/ordinary-inputs/')[1]),authority.reader()):hub.readInitialPlanInputs('p',authority.reader());return Response.json(value,{status:value.ok?200:value.error==='OPERATION_NOT_FOUND'?404:409});}};
 const snapshots=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(snapshots),materials=new MaterialRegistry({workspaceRoot:workspace,maxBytes:1024}),host=population.createHost({materialRegistry:materials,runner:async()=>{throw Error('prepared source must not launch');}});
 const projects=new ConversationProjectService({dataRoot:root,workspaceRoot:workspace,userSubmissions,sourceSnapshots:snapshots,kswarmService:gateway}),taskIds:string[]=[];
 const prompt='Add the original user task as a separate item';let sourceProof!:NonNullable<ReturnType<typeof projects.readProjectUserSource>>;
 await projects.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},async()=>{const task=await host.prepareTask({prompt,materials:[],context:{threadId:'thread'},permissionMode:'auto',executionScope:{kind:'goal_turn',origin:'user',goalId:'goal',epoch:1,goalTurnId:'original-turn',threadId:'thread'}});taskIds.push(task.taskId);const snapshot=(await host.inspectTask(task.taskId))!;expect(projects.recordPreparedUserTask(snapshot,{requestSource:'user',preparedSource:host.getPreparedSourceReceipt(task.taskId)})).toBe(true);sourceProof=projects.readProjectUserSource(task.taskId)!;});
 const state=hub.readInitialPlanInputs('p',authority.reader()),payload={projectId:'p',projectName:'Original P',goal:'Original project goal',requirements:'',planningGuidance:'',poAgent,members:[],startPolicy:'plan_only' as const,ownerBinding:state.ownerBinding};
 const store=new JsonKSwarmInitialPlanBootstrapStore(root,{projectSources:projects,gateway});const read=await createInitialPlanOwnerClient(gateway,payload.ownerBinding,new AbortController().signal).read();expect(read.unclaimedProof).toBeDefined();
 let action:(proof:unknown)=>Promise<unknown>=async()=>undefined,privateResult:unknown,privateFailure:unknown,listener:((...args:any[])=>any)|undefined,allowed=true;
 registerProjectPlanningIpc({handle(_name,fn){listener=fn;}},async(_event,_input,proof)=>{try{privateResult=await action(proof);}catch(error){privateFailure=error;}return{ok:false,error:'bootstrap_owner_protocol_unqualified'};},{nativeTrigger:{owner:store,authorize:()=>allowed?{actorId:'desktop-user:'+scope.profileId}:null}});
 const withTrigger=async(fn:typeof action)=>{action=fn;privateResult=undefined;privateFailure=undefined;const {ownerBinding,...wire}=payload;expect(await listener!({},wire)).toEqual({ok:false,error:'bootstrap_owner_protocol_unqualified'});if(privateFailure)throw privateFailure;return privateResult as any;};
 closes.push(async()=>{store.stopAcceptingTaskComposites();store.abortTaskComposites(Error('fixture_cleanup'));await store.drainTaskComposites();projects.sealUserTaskFacts();await projects.drainOriginalTaskReads();for(const id of taskIds)await host.cancelTask(id,'fixture_cleanup');await population.close();await materials.sealAndDrainInstanceMutations();hub.closePersistence();rmSync(root,{recursive:true,force:true});});
 const prepare=(proof:unknown,proposal={title:'User-added item'})=>{const method=Reflect.get(store,'prepareOrJoinTaskComposite');expect(typeof method).toBe('function');return Reflect.apply(method,store,[payload,{triggerProof:proof,ownerStateProof:read.unclaimedProof,sourceProof},proposal,10]);};
 const withActionTrigger=async(input:unknown,fn:typeof action)=>{action=fn;privateResult=undefined;privateFailure=undefined;await listener!({},input);if(privateFailure)throw privateFailure;return privateResult as any;};
 return{root,store,hub,projects,sourceProof,read,payload,authority,prompt,prepare,withTrigger,withActionTrigger,gateway,revoke(){allowed=false;}};
}
