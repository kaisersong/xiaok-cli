import {ContinuitySdkCustody} from './sdk-custody.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {DesktopContextContinuity} from './runtime.js';
import {DesktopInputQueue} from './input-queue.js';
import {resolveDesktopProfile,type DesktopProfileIdentity} from './profile.js';
import {describeProfileFailure} from '../desktop-main-identity.js';
import {InProcessTaskRuntimeHost,type TaskIdentityReservation} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import type {TaskCreateInput,TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import type {NativeActor} from '../codex-native-service.js';
interface Claim{inputId:string;reservation?:TaskIdentityReservation;entered:boolean;active:boolean}
/** One canonical journal and one queue owned by the existing DesktopServices.
 * Empty ALS tokens retain no callable context or Native authority. */
export function createContinuityMainBinding(dataRoot:string,snapshotStore:FileTaskSnapshotStore,resolved?:{continuity:DesktopProfileIdentity|null;failure?:string},log?:(line:string)=>void){
 // Main resolves the identity once (resolveDesktopMainIdentity) before any scope row is written.
 let identity:DesktopProfileIdentity|null=null;
 if(resolved){identity=resolved.continuity;if(identity===null)log?.(`[context-continuity] unavailable at identity: ${resolved.failure??'profile_identity_unavailable'}`);}
 else try{identity=resolveDesktopProfile(dataRoot);}catch(raw){/* Profile failure grants no continuity access. */log?.(`[context-continuity] unavailable at identity: ${describeProfileFailure(raw)}`);}
 const runtime=new DesktopContextContinuity(dataRoot,id=>FileTaskSnapshotStore.prototype.inspectPersistedTask.call(snapshotStore,id),identity,undefined,log);
 const scope=new AsyncLocalStorage<object>(),claims=new WeakMap<object,Claim>();let queue:DesktopInputQueue|undefined;
 let closed=false;const sdk=new ContinuitySdkCustody();
 function currentClaim(){const token=scope.getStore(),claim=token&&claims.get(token);if(claim&&!claim.active)throw Error('input_execution_authority_unavailable');return claim;}
 function authority(profileId:string,workspaceId:string,revision:string){return createHash('sha256').update(JSON.stringify(['continuity-input-v1',profileId,workspaceId,revision])).digest('hex');}
 return {
  runtime,
  get queue(){return queue;},
  hostOptions:{
   readPendingInputIdentity:(id:string)=>runtime.inputs().readPendingIdentity(id),
   authorizeInputPreparation:(id:string,identity:import('../../../src/runtime/task-host/task-runtime-host.js').PendingTaskInputIdentity,input:TaskCreateInput)=>runtime.inputs().assertPreparation(id,identity,input),
   authorizeInputAdmission:(snapshot:TaskSnapshot)=>runtime.assertInputAdmission(snapshot),
   onPreparedSnapshot:(snapshot:TaskSnapshot)=>runtime.registerGuardedSnapshot(snapshot),
   resolveOwnedHistory:(taskId:string,context:TaskCreateInput['context'])=>runtime.assembleOwnedHistory(taskId,context),
   assertHistoryRead:(taskId:string,conversationId:string|undefined)=>runtime.assertTaskHistoryReadable(taskId,conversationId),
   onHistoryLoaded:(taskId:string,sources:TaskSnapshot[],conversationId:string|undefined)=>runtime.recordLoadedHistory(taskId,sources,conversationId),
   onWorkReleased:async()=>{await runtime.reconcile();queue?.wakeAll();},
  },
  async claimPreparation(input:TaskCreateInput):Promise<TaskIdentityReservation|undefined>{const claim=currentClaim();if(!claim)return;if(claim.entered)throw Error('input_identity_conflict');claim.entered=true;const result=await runtime.inputs().claim(claim.inputId,input);if(!claim.active)throw Error('input_execution_authority_unavailable');claim.reservation=result.reservation;return result.reservation;},
  async bindPrepared(input:TaskCreateInput,taskId:string,host:InProcessTaskRuntimeHost,publicInput?:import('../../shared/context-continuity-types.js').PublicTaskInput){try{await runtime.bindPrepared(input,taskId,id=>host.inspectTask(id),publicInput);}catch(raw){try{await host.cancelTask(taskId,'continuity_binding_failed');}catch(extra){throw new AggregateError([raw,extra],'continuity_binding_and_cancel_failed',{cause:raw});}throw raw;}},
  initialize(options:{host:InProcessTaskRuntimeHost;materialRegistry:MaterialRegistry;ready:Promise<void>;profileId:string;workspaceId:string;executionRevision:(id:string)=>string;assertThread:(id:string)=>void;assertExecutor:(input:TaskCreateInput)=>void;prepare:(input:TaskCreateInput)=>Promise<{taskId:string}>;setGoalPending:(id:string,pending:boolean)=>Promise<void>}){
   const {executionRevision,assertThread,assertExecutor,prepare}=options;
   const revision=(id:string)=>sdk.invokeSync<string>(executionRevision,undefined,[id]);
   const checkThread=(id:string)=>sdk.invokeSync<void>(assertThread,undefined,[id]);
   const checkExecutor=(input:TaskCreateInput)=>sdk.invokeSync<void>(assertExecutor,undefined,[input]);
   runtime.configureInputOwner({host:options.host,materialRegistry:options.materialRegistry,snapshotStore,
    captureExecutionAuthority:id=>{if(closed)throw Error('input_owner_unavailable');return authority(options.profileId,options.workspaceId,revision(id));},
    assertExecutionAuthority:(value,id)=>{if(closed||value!==authority(options.profileId,options.workspaceId,revision(id)))throw Error('input_execution_authority_changed');checkThread(id);},
    authorizePreparedInput:(_id,input)=>{const claim=currentClaim();if(!claim||claim.inputId!==_id||!claim.active)throw Error('prepared_origin_missing');},
   });
   queue=new DesktopInputQueue({assertBeforeEnqueueEffects:request=>checkExecutor({prompt:request.prompt,materials:[],context:{threadId:request.conversationId}}),get service(){return runtime.port().service;},get actor(){return runtime.port().actor;},requestActorId:`desktop-user:${options.profileId}`,host:options.host,
    journal:()=>runtime.inputs(),ready:()=>options.ready,withUserRequest:async(actor:NativeActor,work)=>{if(closed||actor.requestSource!=='user'||actor.actorId!==`desktop-user:${options.profileId}`)throw Error('input_user_required');await options.ready;return work();},
    prepare:async(input,inputId)=>{if(closed)throw Error('input_owner_unavailable');checkExecutor(input);checkThread(input.context!.threadId!);const token=Object.freeze(Object.create(null)),claim:Claim={inputId,entered:false,active:true};claims.set(token,claim);try{return await scope.run(token,()=>sdk.invoke<{taskId:string}>(prepare,undefined,[input]));}catch(raw){try{runtime.inputs().finalizePreparationFailure(inputId);}catch{try{runtime.inputs().markClaimUnknown(inputId);}catch{/* Keep original unconfirmed claim. */}}throw raw;}finally{claim.active=false;}},
    readSource:id=>InProcessTaskRuntimeHost.prototype.readContinuitySourceSnapshot.call(options.host,id),setGoalPending:options.setGoalPending,observeGoalPending:()=>{},
   });
   runtime.configureScopePolicy(id=>{try{checkThread(id);return 'readable';}catch{return 'blocked';}});
  },
  stopIngress(){closed=true;runtime.stopIngress();},
  async close(){closed=true;const failures:unknown[]=[];try{await queue?.close();}catch(raw){failures.push(raw);}try{await sdk.waitKnown();}catch(raw){failures.push(raw);}try{await runtime.close();}catch(raw){failures.push(raw);}if(failures.length)throw new AggregateError(failures,'continuity_main_close_unconfirmed',{cause:failures[0]});},
 };
}
