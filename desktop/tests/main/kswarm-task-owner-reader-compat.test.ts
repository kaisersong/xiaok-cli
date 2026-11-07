// @vitest-environment node
// Actual B descriptor/Hub + original Main journal metadata compatibility only.
// The client fixture is in-process transport; no Native/HTTP qualification.
import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue,isInitialPlanOwnerExecutionSupported,type KSwarmInitialPlanBootstrapPayload} from '../../electron/kswarm-initial-plan-bootstrap.js';
import {createInitialPlanOwnerClient,inspectUnclaimedInitialPlanState} from '../../electron/kswarm-initial-plan-owner-client.js';
import {executeOwnedInitialPlanBootstrap} from '../../electron/kswarm-owned-initial-plan.js';
const roots:string[]=[],cleanups:Array<()=>void>=[];afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function originalOwner(){
 const root=mkdtempSync(join(tmpdir(),'main-task-owner-reader-'));roots.push(root);
 const load=async(path:string)=>import(new URL('../../../../kswarm/src/core/'+path,import.meta.url).href);
 const [{createHub},{createProjectInputAuthority}]=await Promise.all([load('hub.js'),load('project-input-authority.js')]);
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},authority=createProjectInputAuthority(scope),hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite')},brokerClient:{async getRoomSnapshot(){return{ok:true,room:{status:'active'},members:[{status:'active',subject:{kind:'agent',logicalAgentId:'po'}}]};},async acquireRoomMembershipLease(){return{ok:true};}}});cleanups.push(()=>hub.closePersistence());
 expect(hub.prepareOrdinaryTaskInputWriter({requestSource:'user',projectInputAuthority:authority.reader()}).ok).toBe(true);await hub.createProject({id:'p',name:'P',goal:'Original goal',poAgent:'po',members:[],primaryRoomId:'room',requestedStartPolicy:'plan_only',autoAssignPo:false},{requestSource:'user',projectInputAuthority:authority.creator('main-create','ordinary_initial_plan_additive_v2')});
 const state=hub.readInitialPlanInputs('p',authority.reader());expect(state.ok).toBe(true);const payload={projectId:'p',projectName:'P',goal:'Original goal',requirements:'',planningGuidance:'',poAgent:'po',members:[],startPolicy:'plan_only',ownerBinding:state.ownerBinding} as KSwarmInitialPlanBootstrapPayload;
 return{root,scope,payload,state};
}
it('the original Main journal retains the actual closed B schema2 owner descriptor without authorizing a physical claim',async()=>{
 const f=await originalOwner(),store=new JsonKSwarmInitialPlanBootstrapStore(join(f.root,'main'));const first=store.upsertPending(f.payload,1);expect(first.ownerBinding).toEqual(f.state.ownerBinding);expect(first.ownerBinding?.protocol).toBe('ordinary_initial_plan_additive_v2');expect(first.status).toBe('pending');expect(Object.hasOwn(first,'claimToken')).toBe(false);expect(first.attempts).toBe(0);
 expect(store.upsertPending(f.payload,2)).toEqual(first);expect(new JsonKSwarmInitialPlanBootstrapStore(join(f.root,'main')).list()).toEqual([first]);expect(store.claimDue(100,1)).toEqual([]);expect(isInitialPlanOwnerExecutionSupported(first.ownerBinding)).toBe(false);
});
it('the original Main queue and owned executor keep the v2 metadata binding blocked before transport or model admission',async()=>{
 const f=await originalOwner(),store=new JsonKSwarmInitialPlanBootstrapStore(join(f.root,'main'));let effects=0;const queue=new KSwarmInitialPlanBootstrapQueue(store,async()=>{effects++;return{ok:true};});
 try{expect(queue.enqueue(f.payload)).toEqual({ok:false,error:'bootstrap_owner_protocol_unqualified'});expect(store.list()).toEqual([]);const job=store.upsertPending(f.payload,1);await queue.runOnce();expect(effects).toBe(0);
 const result=await executeOwnedInitialPlanBootstrap({...job,status:'running',claimToken:'forged'}, {store,scope:f.scope,gateway:{request:async()=>{effects++;return Response.json({ok:true});},getDesktopMutationToken:()=> 'fixture-token'},generateCandidate:async()=>{effects++;return{plan:{phases:[]},tasks:[]};}},new AbortController().signal);expect(result.ok).toBe(false);expect(effects).toBe(0);expect(store.list()[0]).toEqual(job);
 }finally{queue.stopAccepting();await queue.drain();}
});
it('the actual authenticated owner client can read the closed v2 metadata binding while its negative proof remains data only',async()=>{
 const f=await originalOwner(),client=createInitialPlanOwnerClient({request:async()=>Response.json(f.state),getDesktopMutationToken:()=> 'fixture-token'},f.payload.ownerBinding!,new AbortController().signal);const observed=await client.read();expect(observed.state).toEqual(f.state);expect(observed.unclaimedProof).toBeDefined();expect(isInitialPlanOwnerExecutionSupported(f.payload.ownerBinding)).toBe(false);
});
it('the original journal closes every v2 descriptor field and never executes a caller metadata accessor',async()=>{
 const f=await originalOwner(),store=new JsonKSwarmInitialPlanBootstrapStore(join(f.root,'main')),job=store.upsertPending(f.payload,1),binding=f.payload.ownerBinding!;
 for(const patch of [{acceptanceSchemaVersion:1},{semanticSchemaVersion:1},{protocol:'ordinary_initial_plan_additive_v3'},{qualified:true},{handlerDigest:'invalid'}])expect(()=>store.upsertPending({...f.payload,ownerBinding:{...binding,...patch}} as never,2)).toThrow('bootstrap_owner_binding_invalid');
 for(const name of ['handlerDigest','writerFloorDigest'])expect(()=>store.upsertPending({...f.payload,ownerBinding:{...binding,[name]:'f'.repeat(64)}} as never,2)).toThrow('bootstrap_payload_conflict');
 let hooks=0;const accessor={...binding};Object.defineProperty(accessor,'handlerDigest',{enumerable:true,get(){hooks++;return 'e'.repeat(64);}});expect(()=>store.upsertPending({...f.payload,ownerBinding:accessor},2)).toThrow('bootstrap_payload_invalid');expect(hooks).toBe(0);expect(store.list()).toEqual([job]);
});
it('the original negative owner proof freezes actual schema2 control, store, policy and its same authenticated gateway',async()=>{
 const f=await originalOwner(),gateway={request:async()=>Response.json(f.state),getDesktopMutationToken:()=> 'fixture-token'},client=createInitialPlanOwnerClient(gateway,f.payload.ownerBinding!,new AbortController().signal),read=await client.read();expect(read.unclaimedProof).toBeDefined();const inspect=inspectUnclaimedInitialPlanState as (...args:unknown[])=>any;
 const facts=inspect(read.unclaimedProof,gateway);expect(facts.taskControl).toEqual({projectControlDigest:f.state.projectControlDigest,startPolicy:f.state.startPolicy,projectRevision:f.state.projectRevision,poAgent:f.state.poAgent,taskOwner:f.state.taskOwner});expect(()=>inspect(read.unclaimedProof,{})).toThrow('bootstrap_unclaimed_owner_state_unverified');
});
it('a v2 negative read cannot invent missing or mismatched original metadata owner facts',async()=>{
 const f=await originalOwner();for(const taskOwner of [undefined,{...f.state.taskOwner,scope:{...f.scope,workspaceId:'f'.repeat(64)}},{...f.state.taskOwner,qualified:true}]){
  const gateway={request:async()=>Response.json({...f.state,taskOwner}),getDesktopMutationToken:()=> 'fixture-token'},client=createInitialPlanOwnerClient(gateway,f.payload.ownerBinding!,new AbortController().signal);await expect(client.read()).rejects.toThrow('bootstrap_owner_metadata_invalid');
 }
});
