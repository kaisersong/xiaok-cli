// @vitest-environment node
import {it,expect} from 'vitest';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import {registerDesktopSmallConfigIpc} from '../../electron/desktop-small-config-typed-ipc.ts';
import {registerThreadMetadataIpc} from '../../electron/thread-metadata-typed-ipc.ts';
import {registerKSwarmTeamTypedIpc} from '../../electron/kswarm-team-typed-ipc.ts';
import {registerKSwarmProjectAgentTypedIpc} from '../../electron/kswarm-project-agent-typed-ipc.ts';
import {registerAssistantTypedIpc} from '../../electron/assistant-typed-ipc.ts';
import {registerCollaborationRoomTypedIpc} from '../../electron/collaboration-room-typed-ipc.ts';
import {registerLoopManagementIpc} from '../../electron/loop-management-typed-ipc.ts';
import {registerModelProviderIpc} from '../../electron/model-provider-typed-ipc.ts';
import {registerPrinciplesIpc} from '../../electron/principles-typed-ipc.ts';
import {registerDiagnosticsIpc} from '../../electron/diagnostics-typed-ipc.ts';
const cases=[
{name:'smallconfig',channel:'desktop:getSkillDebugConfig',args:[],error:'desktop_config_projection_unavailable',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerDesktopSmallConfigIpc(ipc,{getSkillDebugConfig:produce} as never)},
{name:'thread',channel:'desktop:getThreadLabels',args:[],error:'thread_meta_projection_unavailable',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerThreadMetadataIpc(ipc,{getAll:produce} as never,()=>{})},
{name:'team',channel:'desktop:kswarm:team:plan',args:[{projectId:'owned'}],error:'kswarm_team_operation_unknown',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerKSwarmTeamTypedIpc(ipc,{planProjectTeam:produce} as never)},
{name:'projectagent',channel:'desktop:kswarm:agent:probe',args:[{agentId:'owned'}],error:'kswarm_semantic_operation_unknown',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerKSwarmProjectAgentTypedIpc(ipc,{probeKSwarmAgent:produce} as never)},
{name:'assistant',channel:'desktop:assistant:getOverview',args:[],error:'assistant_operation_unknown',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerAssistantTypedIpc(ipc,{getOverview:produce} as never,()=>true)},
{name:'room',channel:'desktop:collaborationRoom:listRooms',args:[],error:'room_projection_unavailable',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerCollaborationRoomTypedIpc(ipc,{listRooms:produce} as never)},
{name:'loop',channel:'desktop:loops:listDefinitions',args:[],error:'loop_projection_unavailable',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerLoopManagementIpc(ipc,{loopStore:{listLoopDefinitions:produce}} as never)},
{name:'model',channel:'desktop:getModelConfig',args:[],error:'model_config_operation_unknown',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerModelProviderIpc(ipc,{getModelConfig:produce} as never)},
{name:'principles',channel:'desktop:listPrinciples',args:[],error:'principles_projection_unavailable',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerPrinciplesIpc(ipc,{list:produce} as never)},
{name:'diagnostics',channel:'desktop:getSkillStats',args:[],error:'diagnostics_projection_unavailable',register:(ipc:IpcHandleRegistrar,produce:()=>Promise<unknown>)=>registerDiagnosticsIpc(ipc,{getSkillStats:produce} as never)},
];
for(const c of cases)for(const kind of ['constructor','species'])it(c.name+' rejects '+kind+' before any accessor execution without producer retry',async()=>{
let reads=0,calls=0;const raw=Promise.resolve(null);if(kind==='constructor')Object.defineProperty(raw,'constructor',{configurable:true,get(){reads++;return Promise}});
const handlers=new Map<string,IpcHandlerListener>();c.register({handle:(name:string,fn:IpcHandlerListener)=>handlers.set(name,fn)},()=>{calls++;return raw});const original=Object.getOwnPropertyDescriptor(Promise,Symbol.species)!;
let pending:unknown,failure:unknown;
try{if(kind==='species')Object.defineProperty(Promise,Symbol.species,{configurable:true,get(){reads++;return Promise}});try{pending=handlers.get(c.channel)!({} as never,...c.args)}catch(error){failure=error}}
finally{Object.defineProperty(Promise,Symbol.species,original)}
let reply:unknown;if(!failure)try{reply=await pending}catch(error){failure=error}
expect(calls).toBe(1);expect(reads).toBe(0);
if(c.name==='room')expect(reply).toEqual({ok:false,code:c.error});else expect((failure as Error)?.message).toBe(c.error);
});

const normal:Record<string,unknown>={smallconfig:{enabled:false},thread:{gtdEnabled:false,inbox:[],todo:[],waiting:[],someday:[],archived:[],pinned:[]},team:{planId:'p',projectId:'owned',projectRevision:0,outcome:'no_change',summary:'existing',items:[]},projectagent:{agentId:'owned',runtimeType:null,healthy:false,callability:'unavailable',durationMs:0},assistant:{profile:{id:'default-personal-assistant',status:'needs_consent',locale:'zh',timeZone:'UTC',eveningTime:'18:00',morningTime:'08:00',workdays:[],quietHours:{start:'23:00',end:'07:00'},dataScopes:[],createdAt:1,updatedAt:1},suggestions:[],pendingCandidateCount:0,candidates:[]},room:{ok:true,rooms:[]},loop:[],model:{configPath:'owned',defaultProvider:'p',defaultModelId:'m',providers:[],models:[],providerProfiles:[]},principles:[],diagnostics:[]};
for(const c of cases)for(const kind of ['normal','ownThen','ownConstructor','rejection'])it(c.name+' preserves '+kind+' original promise behavior without reading then',async()=>{
 let calls=0,reads=0;const business=Error('actual-producer-business-error');const value=normal[c.name];const raw=kind==='rejection'?Promise.reject(business):Promise.resolve(value);
 if(kind==='ownThen')Object.defineProperty(raw,'then',{configurable:true,get(){reads++;throw Error('own then executed')}});
 if(kind==='ownConstructor')Object.defineProperty(raw,'constructor',{configurable:true,value:Promise});
 const handlers=new Map<string,IpcHandlerListener>();c.register({handle:(name:string,fn:IpcHandlerListener)=>handlers.set(name,fn)},()=>{calls++;return raw});
 if(kind==='rejection' && c.name==='diagnostics')expect(await handlers.get(c.channel)!({} as never,...c.args)).toEqual([]);
 else if(kind==='rejection')await expect(handlers.get(c.channel)!({} as never,...c.args)).rejects.toBe(business);
 else expect(await handlers.get(c.channel)!({} as never,...c.args)).toEqual(value);
 expect(calls).toBe(1);expect(reads).toBe(0);
});

for(const c of cases)it(c.name+' invokes captured native then without reading its mutable call property',async()=>{
 let reads=0,calls=0;const raw=Promise.resolve(normal[c.name]);const handlers=new Map<string,IpcHandlerListener>();c.register({handle:(name:string,fn:IpcHandlerListener)=>handlers.set(name,fn)},()=>{calls++;return raw});
 const then=Promise.prototype.then,original=Object.getOwnPropertyDescriptor(then,'call'),nativeCall=Function.prototype.call;let pending:unknown;
 try{Object.defineProperty(then,'call',{configurable:true,get(){reads++;return nativeCall}});pending=handlers.get(c.channel)!({} as never,...c.args);}
 finally{if(original)Object.defineProperty(then,'call',original);else Reflect.deleteProperty(then,'call');}
 expect(await pending).toEqual(normal[c.name]);expect(reads).toBe(0);expect(calls).toBe(1);
});
