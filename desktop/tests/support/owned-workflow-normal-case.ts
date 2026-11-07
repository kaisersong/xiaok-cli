import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,type ChildProcess} from 'node:child_process';
import {createOwnedWorkflowNetworkFixture,type OwnedWorkflowTaskInput} from './owned-workflow-network-fixture.mjs';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import type {createDesktopServices} from '../../electron/desktop-services.js';
type OwnedWorkflowNormalCaseOptions={project:{id:string;name:string;goal:string};reviewFormat?:'markdown'|'html';originalServiceChild?:boolean}&(
 {issuer?:never;workflowName:string;prompt:string;label:string;phaseTitle:string}|
 {issuer:'po_generated';tasks:[OwnedWorkflowTaskInput]}|
 {issuer:'po_generated_project';tasks:OwnedWorkflowTaskInput[]}
);
/** Actual original manager credential + real B issuer/HTTP; never mints a caller capability. */
export async function openOwnedWorkflowNormalCase(options:OwnedWorkflowNormalCaseOptions) {
 const previous={fetch:globalThis.fetch,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url));
 process.env.KSWARM_SERVER_PATH=resolve(repositoryRoot,'..','kswarm','src/server/index.js');process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';
 const restore=()=>{globalThis.fetch=previous.fetch;for(const [key,value] of [['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
 const desktopProjectScope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 let kswarmService:ReturnType<typeof createKSwarmService>|undefined;
 let fixture:Awaited<ReturnType<typeof createOwnedWorkflowNetworkFixture>>|undefined;
 let originalChild:ChildProcess|undefined,childClosed:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
 try{
  kswarmService=createKSwarmService({desktopProjectScope,spawnProcess:((_command,_args,spawnOptions)=>{if(!options.originalServiceChild||originalChild)throw Error('fixture_foreign_spawn_denied');originalChild=spawn(process.execPath,['--input-type=module','-e',"process.on('message',()=>{});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},10000);"],{...spawnOptions,stdio:['ignore','pipe','pipe','ipc']});childClosed=new Promise(yes=>originalChild!.once('close',(code,signal)=>yes({code,signal})));return originalChild;}) as typeof spawn,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
  fixture=await createOwnedWorkflowNetworkFixture(null,{...options,desktopProjectScope,desktopMutationToken:kswarmService.getDesktopMutationToken()});
  const forwarded=fixture.forwardedFetch;globalThis.fetch=options.originalServiceChild?async(input,init)=>{const url=new URL(String(input));if(url.port==='4400'&&url.pathname==='/health'&&!originalChild)return new Response('{"ok":false}',{status:503});return forwarded(input,init);}:forwarded;
 }catch(error){
  const errors:unknown[]=[error];if(kswarmService)try{await sealAndDrainKSwarmServiceInstance(kswarmService);}catch(cleanup){errors.push(cleanup);}
  restore();if(fixture)try{await fixture.close();}catch(cleanup){errors.push(cleanup);}
  if(errors.length>1)throw new AggregateError(errors,'owned_workflow_fixture_setup_and_cleanup_failed',{cause:error});throw error;
 }
 const owned=fixture,manager=kswarmService;let closed=false;
 return {fixture:owned,kswarmService:manager,handoff:{...owned.issued.dispatches[0],project:{...owned.project,workFolder:owned.workspace.path}},
 async close(desktop?:ReturnType<typeof createDesktopServices>){if(closed)return;closed=true;const errors:unknown[]=[];
 if(desktop){try{await desktop.closeTaskSourceWritersForMigration();}catch(error){errors.push(error);}try{await desktop.disposeMultiAgent();}catch(error){errors.push(error);}}
 try{await sealAndDrainKSwarmServiceInstance(manager);}catch(error){errors.push(error);}
 if(childClosed){const result=await childClosed;console.log(JSON.stringify({fixture:'workflow-source-original-service-child',pid:originalChild?.pid,...result,reaped:true,notNativeQualification:true}));if(result.code!==0||result.signal!==null)errors.push(Error('fixture_original_child_exit_unconfirmed'));}
 restore();try{await owned.close();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'owned_workflow_fixture_cleanup_failed');
 }};
}
