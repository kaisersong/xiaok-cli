// Uninstalled ordinary coverage only. Positive candidates require the real Main binder fixture.
import {afterEach,expect,it,vi} from 'vitest';
import {writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import * as original from '../../electron/kswarm-service.js';
import {RoomWorkspaceLocalStore,prepareWorkspaceRoot,workspaceDigest} from '../../electron/room-workspace-local.js';
import {createRoomWorkspaceRuntime,readOriginalRoomProjectRootBinding,readOriginalRoomProjectRoot} from '../../electron/room-workspace-runtime.js';
import {createKSwarmRuntimeBridge,readOriginalKSwarmHandoffRoot,readOriginalKSwarmHandoffRootBinding} from '../../electron/kswarm-runtime-bridge.js';
import {scope,services,cleanups,childFixture} from '../support/kswarm-owned-preparation-fixture.js';
afterEach(async()=>{try{for(const cleanup of cleanups.splice(0).reverse())await cleanup();for(const service of services.splice(0))await original.sealAndDrainKSwarmServiceInstance(service);}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}});
it('does not mint a direct candidate without the original Native Owner facet',async()=>{
 const f=await childFixture(false),handoffPath=join(f.root,'direct-handoff.json'),raw=JSON.stringify({kind:'kswarm_task_handoff_v1',runId:'run-1',project:{id:'p',name:'P',goal:'G'},task:{id:'task-1',title:'T'}});writeFileSync(handoffPath,raw);
 let proof:object|undefined,started!:()=>void,finish!:()=>void;
 const ready=new Promise<void>(yes=>{started=yes;}),held=new Promise<void>(yes=>{finish=yes;});
 const publicRead=f.service.readProjectExecutionStart,publicAssert=f.service.assertProjectExecutionStartRead;
 f.service.readProjectExecutionStart=async()=>{throw Error('replaced public read');};f.service.assertProjectExecutionStartRead=()=>{throw Error('replaced public assert');};
 const bridge=createKSwarmRuntimeBridge({kswarmService:f.service,allowedRoots:[f.root],async runDesktopTask(input){proof=input.originalRootCandidate;started();await held;return{summary:'accepted fixture'};},async submitResult(){return new Response('{}');}});
 const pending=bridge.handleTaskHandoff({handoffPath,projectId:'p',taskId:'task-1',runId:'run-1'});
 try{
  // Positive identity/current/changed-bytes coverage lives at the real Main binder.
  await ready;expect(proof).toBeUndefined();
  expect(readOriginalKSwarmHandoffRootBinding(bridge,f.service)).toBeUndefined();
  let traps=0;const foreign=new Proxy({},{get(){traps++;throw undefined;},getOwnPropertyDescriptor(){traps++;throw undefined;}});
  expect(()=>readOriginalKSwarmHandoffRoot(bridge,foreign)).toThrow();expect(traps).toBe(0);
  expect(()=>readOriginalKSwarmHandoffRoot(bridge,{})).toThrow();
 }finally{finish();await pending;f.service.readProjectExecutionStart=publicRead;f.service.assertProjectExecutionStartRead=publicAssert;}
 expect(()=>readOriginalKSwarmHandoffRoot(bridge,proof!)).toThrow();
},15000);

it('does not mint a Room project candidate without the original Native Owner facet',async()=>{
 const f=await childFixture(false),store=new RoomWorkspaceLocalStore(join(f.root,'room-local.sqlite')),physical=await prepareWorkspaceRoot(f.root);
 store.prepareBinding({...physical,bindingId:'b',roomId:'r',workspaceId:'w',hostId:'h',generation:1,requestId:'q',payloadDigest:workspaceDigest('binding',physical),createdBy:'user.local'});store.activateBinding('b',{workspaceId:'w',activeBindingId:'b',generation:1});
 const config={activeBindingId:'b',workspaceId:'w',originHostId:'h',generation:1,revision:3,phase:'active'};
 const broker={async get(){return{ok:true,config};},async request(_roomId:string,action:string,input:any){if(action==='acquire')return{ok:true,claim:{...config,...input,roomId:'r',workspaceRevision:3,bindingId:'b',claimId:'claim',protocolVersion:1,hostIncarnation:1,instructionsRevision:0,executionState:'admitted',authorizationState:'valid'}};return{ok:true};}};
 let proof:object|undefined,started!:()=>void,finish!:()=>void;
 const ready=new Promise<void>(yes=>{started=yes;}),held=new Promise<void>(yes=>{finish=yes;});
 const runtime=createRoomWorkspaceRuntime({kswarmService:f.service,store,broker,wake:{async claimWake(){return{};},async completeWake(){return{};}},async execute(){throw Error('discussion must not execute');},async ensureProtocol(){},projectAdapter:{async resolve(){return{mapping:{workFolder:realpathSync(f.root),artifactsDir:realpathSync(f.root),mappingRevision:1},task:{id:'p__t'}};},async dispatch(){return{ok:true};},async authorize(){return{};}} as any,async executeProject(input){proof=input.originalRootCandidate;started();await held;await input.workspace.port.release(input.workspace.context,{executorInstanceId:input.workspace.context.executorInstanceId,kind:'resources-disposed',verified:true});}});
 try{
  await runtime.prepareProjectTask({roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'source'});
  const context=store.getRecord<any>('project-execution','claim')!.context;
  const pending=runtime.runProjectTask({handoff:{kind:'kswarm_task_handoff_v1',runId:context.runId,project:{id:'p',name:'P',goal:'G'},task:{id:'p__t',title:'T'},workspaceContext:context},targetParticipantId:'a'});
  try{await ready;expect(proof).toBeUndefined();expect(readOriginalRoomProjectRootBinding(runtime,f.service)).toBeUndefined();
   let traps=0;const foreign=new Proxy({},{get(){traps++;throw undefined;},getOwnPropertyDescriptor(){traps++;throw undefined;}});
   expect(()=>readOriginalRoomProjectRoot(runtime,foreign)).toThrow();expect(traps).toBe(0);
   expect(()=>readOriginalRoomProjectRoot(runtime,{})).toThrow();expect(()=>readOriginalKSwarmHandoffRoot(runtime,{})).toThrow();}finally{finish();expect(await pending).toEqual({ok:true});}
  expect(()=>readOriginalRoomProjectRoot(runtime,{})).toThrow();
 }finally{finish();await runtime.shutdown();store.close();}
},15000);
