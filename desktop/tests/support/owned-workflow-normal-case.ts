import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawn,type ChildProcess} from 'node:child_process';
import type {createOwnedWorkflowNetworkFixture,OwnedWorkflowTaskInput} from './owned-workflow-network-fixture.mjs';
import type {createKSwarmService} from '../../electron/kswarm-service.js';
import type {createDesktopServices} from '../../electron/desktop-services.js';
type Desktop=ReturnType<typeof createDesktopServices>;
type ServiceCaseOptions=Parameters<typeof createOwnedWorkflowNetworkFixture>[1]&{originalServiceChild?:boolean};
type Failure={error:unknown};
type OwnedWorkflowNormalCaseOptions={project:{id:string;name:string;goal:string};reviewFormat?:'markdown'|'html';originalServiceChild?:boolean}&(
 {issuer?:never;workflowName:string;prompt:string;label:string;phaseTitle:string}|
 {issuer:'po_generated';tasks:[OwnedWorkflowTaskInput]}|
 {issuer:'po_generated_project';tasks:OwnedWorkflowTaskInput[]}
);
/** Real manager scope/credential and original Hub/HTTP, without caller capabilities. */
export async function openOwnedWorkflowServiceCase(permissions:Parameters<typeof createOwnedWorkflowNetworkFixture>[0]=null,options:ServiceCaseOptions={}) {
 const previous={fetch:globalThis.fetch,config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 const configRoot=mkdtempSync(join(tmpdir(),'workflow-service-config-'));
 const config=join(configRoot,'config');mkdirSync(config,{mode:0o700});
 // Existing normal callers already own their isolated model configuration.
 process.env.XIAOK_CONFIG_DIR=previous.config??config;
 const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
 process.env.KSWARM_SERVER_PATH=resolve(repositoryRoot,'..','kswarm','src/server/index.js');process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';
 const restore=()=>{globalThis.fetch=previous.fetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
 const desktopProjectScope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 let manager:ReturnType<typeof createKSwarmService>|undefined;
 let fixture:Awaited<ReturnType<typeof createOwnedWorkflowNetworkFixture>>|undefined;
 let originalChild:ChildProcess|undefined,childClosed:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
 let drain:((service:ReturnType<typeof createKSwarmService>)=>Promise<void>)|undefined;
 async function closeResources(desktop?:Desktop){
  const errors:unknown[]=[];
  if(desktop)for(const close of [()=>desktop.closeTaskSourceWritersForMigration(),()=>desktop.disposeMultiAgent()])try{await close();}catch(error){errors.push(error);}
  if(manager&&drain)try{await drain(manager);}catch(error){errors.push(error);}
  // A failed Source close cannot leave forwarding fetch or configuration installed.
  restore();
  if(fixture)try{await fixture.close({retainRoot:errors.length!==0});console.log(JSON.stringify({fixture:'workflow-service-server-close',...fixture.getOwnedServerState(),reaped:true}));}catch(error){errors.push(error);}
  if(childClosed){try{const result=await childClosed;console.log(JSON.stringify({fixture:'workflow-source-original-service-child',pid:originalChild?.pid,...result,reaped:true,notNativeQualification:true}));if(result.code!==0||result.signal!==null)errors.push(Error('fixture_original_child_exit_unconfirmed'));}catch(error){errors.push(error);}}
  if(!errors.length)try{rmSync(configRoot,{recursive:true,force:true});}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'owned_workflow_fixture_cleanup_failed');
 }
 try{
  const ks=await import('../../electron/kswarm-service.js');drain=ks.sealAndDrainKSwarmServiceInstance;
  // Compile original modules before the real server's existing five-second lease.
  await import('../../electron/desktop-services.js');
  const network=await import('./owned-workflow-network-fixture.mjs');
  manager=ks.createKSwarmService({desktopProjectScope,spawnProcess:((_command,_args,spawnOptions)=>{if(!options.originalServiceChild||originalChild)throw Error('fixture_foreign_spawn_denied');originalChild=spawn(process.execPath,['--input-type=module','-e',"process.on('message',()=>{});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},10000);"],{...spawnOptions,stdio:['ignore','pipe','pipe','ipc']});childClosed=new Promise(yes=>originalChild!.once('close',(code,signal)=>yes({code,signal})));return originalChild;}) as typeof spawn,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
  fixture=await network.createOwnedWorkflowNetworkFixture(permissions,{...options,desktopProjectScope,desktopMutationToken:manager.getDesktopMutationToken()});
  const forwarded=fixture.forwardedFetch;globalThis.fetch=options.originalServiceChild?async(input,init)=>{const url=new URL(String(input));if(url.port==='4400'&&url.pathname==='/health'&&!originalChild)return new Response('{"ok":false}',{status:503});return forwarded(input,init);}:forwarded;
 }catch(error){
  try{await closeResources();}catch(cleanup){throw new AggregateError([error,cleanup],'owned_workflow_fixture_setup_and_cleanup_failed',{cause:error});}throw error;
 }
 const owned=fixture,kswarmService=manager;let closing:Promise<void>|undefined;
 return {fixture:owned,kswarmService,handoff:{...owned.issued.dispatches[0],project:{...owned.project,workFolder:owned.workspace.path}},
 close(desktop?:Desktop){return closing??=Promise.resolve().then(()=>closeResources(desktop));}};
}
/** Preserve the existing normal-case API and genuine manager path. */
export function openOwnedWorkflowNormalCase(options:OwnedWorkflowNormalCaseOptions){return openOwnedWorkflowServiceCase(null,options);}
/** Fixture cleanup only: callbacks restore tests, never grant production authority. */
export async function finishOwnedWorkflowServiceCase(owned:Awaited<ReturnType<typeof openOwnedWorkflowServiceCase>>,desktop:Desktop|undefined,first:Failure|undefined,cleanup:ReadonlyArray<()=>unknown|Promise<unknown>>=[],afterCleanup:ReadonlyArray<()=>unknown|Promise<unknown>>=[]){
 const errors:unknown[]=[];
 for(const close of cleanup)try{await close();}catch(error){errors.push(error);}
 try{await owned.close(desktop);}catch(error){errors.push(error);}
 for(const close of afterCleanup)try{await close();}catch(error){errors.push(error);}
 if(first){if(errors.length)throw new AggregateError([first.error,...errors],'owned_workflow_body_and_cleanup_failed',{cause:first.error});throw first.error;}
 if(errors.length)throw new AggregateError(errors,'owned_workflow_test_cleanup_failed');
}
