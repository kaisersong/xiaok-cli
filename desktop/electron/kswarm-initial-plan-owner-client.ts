import {captureIpcData} from './ipc-data-snapshot.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import type {KSwarmService} from './kswarm-service.js';
import type {KSwarmInitialPlanOwnerBinding} from './kswarm-initial-plan-bootstrap.js';

type Data=Record<string,unknown>;
const record=(value:unknown):value is Data=>!!value && typeof value==='object' && !Array.isArray(value);

/** Settle the original response on admission failure; cancellation is not proof
 * of an owner rollback. Both an admission error and an unknown cleanup survive. */
export async function readPlanningOwnerResponse(response:Response,beforeEffects?:()=>void):Promise<unknown>{
  try{assertBeforeEffects(beforeEffects);const value:unknown=await response.json();assertBeforeEffects(beforeEffects);return value;}
  catch(error){
    if(!response.bodyUsed&&response.body){try{await response.body.cancel(error);}catch(cleanup){throw new AggregateError([error,cleanup],'planning_response_cleanup_failed',{cause:error});}}
    throw error;
  }
}

/** Evidence of one authenticated owner read, never business/model authority. */
export interface UnclaimedInitialPlanState {readonly opaqueUnclaimedInitialPlanState:never}
export interface InitialPlanTaskOwnerMetadata {
  projectId:string;scope:{profileId:string;workspaceId:string};writerStoreId:string;bindingDigest:string;createReceiptDigest:string;contract:'ordinary_initial_plan_additive_v2';
}
export interface InitialPlanTaskControl {
  projectControlDigest:string;projectRevision:number;poAgent:string;startPolicy:'plan_only'|'auto_activate_after_plan'|'activate_and_dispatch_after_plan';taskOwner:InitialPlanTaskOwnerMetadata;
}
const unclaimedStates=new WeakMap<object,{gateway:object;current:()=>void;binding:KSwarmInitialPlanOwnerBinding;planInputRevision:number;taskControl?:InitialPlanTaskControl}>();
export function inspectUnclaimedInitialPlanState(proof:UnclaimedInitialPlanState,expectedGateway?:object){
  const state=unclaimedStates.get(proof);
  if(!state||expectedGateway!==undefined&&state.gateway!==expectedGateway)throw Error('bootstrap_unclaimed_owner_state_unverified');
  state.current();const {gateway:_,current:__,...facts}=state;return structuredClone(facts);
}
function readTaskOwnerMetadata(value:unknown,expected:KSwarmInitialPlanOwnerBinding):InitialPlanTaskOwnerMetadata{
  const owner=captureIpcData(value,'bootstrap_owner_metadata_invalid'),fields=['projectId','scope','writerStoreId','bindingDigest','createReceiptDigest','contract'];
  if(!record(owner)||Object.keys(owner).length!==fields.length||Object.keys(owner).some(key=>!fields.includes(key))||!record(owner.scope)
    ||Object.keys(owner.scope).length!==2||!Object.keys(owner.scope).every(key=>key==='profileId'||key==='workspaceId')
    ||owner.scope.profileId!==expected.profileId||owner.scope.workspaceId!==expected.workspaceId||owner.projectId!==expected.projectId||owner.contract!=='ordinary_initial_plan_additive_v2'
    ||typeof owner.writerStoreId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(owner.writerStoreId)
    ||!['bindingDigest','createReceiptDigest'].every(key=>typeof owner[key]==='string'&&/^[a-f0-9]{64}$/.test(owner[key] as string)))throw Error('bootstrap_owner_metadata_invalid');
  return structuredClone(owner) as unknown as InitialPlanTaskOwnerMetadata;
}

/** Main composition supplies this authenticated service transport. A DTO cannot
 * mint the negative reservation fact used to refresh a stale pre-claim CAS. The
 * owner claim still performs its own CAS; this read never permits a model. */
export function createInitialPlanOwnerClient(
  gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'>,
  binding:KSwarmInitialPlanOwnerBinding,
  signal:AbortSignal,
  beforeEffects?:()=>void,
){
  const expected=structuredClone(binding);
  const path=`/projects/${encodeURIComponent(expected.projectId)}/initial-plan-inputs`;
  const request=async(suffix:''|'/claim'|'/commit'='',body?:Data):Promise<Data>=>{
    signal.throwIfAborted();assertBeforeEffects(beforeEffects);
    const token=gateway.getDesktopMutationToken();
    if(!token)throw Error('mutation_credential_required');
    const response=await gateway.request(path+suffix,{signal,method:body?'POST':'GET',
      headers:{'content-type':'application/json','x-kswarm-mutation-token':token},
      ...(body?{body:JSON.stringify(body)}:{})},beforeEffects);
    const value=await readPlanningOwnerResponse(response,()=>{signal.throwIfAborted();assertBeforeEffects(beforeEffects);});
    if(!record(value))throw Error('bootstrap_owner_response_invalid');
    if(!response.ok || value.ok!==true)return {...value,ok:false,error:typeof value.error==='string'?value.error:'bootstrap_owner_request_failed'};
    return value;
  };
  return Object.freeze({request,async read(){
    const state=await request();
    signal.throwIfAborted();assertBeforeEffects(beforeEffects);
    if(!state.ok)return {state};
    const owner=state.ownerBinding;
    if(!record(owner) || Object.entries(expected).some(([key,value])=>owner[key]!==value)
      || !Number.isSafeInteger(state.planInputRevision) || Number(state.planInputRevision)<0)throw Error('bootstrap_owner_binding_mismatch');
    let taskOwner:InitialPlanTaskOwnerMetadata|undefined;
    if(expected.protocol==='ordinary_initial_plan_additive_v2'){
      taskOwner=readTaskOwnerMetadata(state.taskOwner,expected);
      if(!Number.isSafeInteger(state.projectRevision)||Number(state.projectRevision)<1||typeof state.poAgent!=='string'||!state.poAgent||state.poAgent.length>256||state.poAgent.trim()!==state.poAgent
        ||typeof state.startPolicy!=='string'||!['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan'].includes(state.startPolicy))throw Error('bootstrap_owner_metadata_invalid');
    }
    if(state.reservation!==null)return {state};
    if(taskOwner&&(typeof state.projectControlDigest!=='string'||!/^[a-f0-9]{64}$/.test(state.projectControlDigest)))throw Error('bootstrap_owner_metadata_invalid');
    const taskControl:InitialPlanTaskControl|undefined=taskOwner?{taskOwner,projectControlDigest:String(state.projectControlDigest),projectRevision:Number(state.projectRevision),poAgent:String(state.poAgent),startPolicy:state.startPolicy as InitialPlanTaskControl['startPolicy']}:undefined;
    const unclaimedProof=Object.freeze(Object.create(null)) as UnclaimedInitialPlanState;
    unclaimedStates.set(unclaimedProof,{gateway,current(){signal.throwIfAborted();assertBeforeEffects(beforeEffects);},binding:structuredClone(expected),planInputRevision:Number(state.planInputRevision),...(taskControl?{taskControl}:{})});
    return {state,unclaimedProof};
  }});
}
