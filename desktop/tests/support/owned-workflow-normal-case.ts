import {resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOwnedWorkflowNetworkFixture,type OwnedWorkflowTaskInput} from './owned-workflow-network-fixture.mjs';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import type {createDesktopServices} from '../../electron/desktop-services.js';
type OwnedWorkflowNormalCaseOptions={project:{id:string;name:string;goal:string}}&(
 {issuer?:never;workflowName:string;prompt:string;label:string;phaseTitle:string}|
 {issuer:'po_generated';tasks:[OwnedWorkflowTaskInput]}|
 {issuer:'po_generated_project';tasks:OwnedWorkflowTaskInput[]}
);
/** Test-only setup uses a genuine Hub issuer/factory; never grants permission to a caller. */
export async function openOwnedWorkflowNormalCase(options:OwnedWorkflowNormalCaseOptions) {
 const fixture=await createOwnedWorkflowNetworkFixture(null,options);
 const previous={fetch:globalThis.fetch,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url));
 // Bind the private server's physical entry, matching its real health identity
 // even when the test worktree reaches the sibling through a symlink.
 process.env.KSWARM_SERVER_PATH=realpathSync(resolve(repositoryRoot,'..','kswarm','src/server/index.js'));process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
 const restore=()=>{globalThis.fetch=previous.fetch;for(const [key,value] of [['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
 let kswarmService:ReturnType<typeof createKSwarmService>;
 try{kswarmService=createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});}
 catch(error){restore();try{await fixture.close();}catch(cleanup){throw new AggregateError([error,cleanup],'owned_workflow_fixture_setup_and_cleanup_failed',{cause:error});}throw error;}
 let closed=false;
 return {fixture,kswarmService,handoff:{...fixture.issued.dispatches[0],project:{...fixture.project,workFolder:fixture.workspace.path}},
 async close(desktop?:ReturnType<typeof createDesktopServices>){if(closed)return;closed=true;const errors:unknown[]=[];
 if(desktop){
 try{await desktop.closeTaskSourceWritersForMigration();}catch(error){errors.push(error);}
 try{await desktop.disposeMultiAgent();}catch(error){errors.push(error);}
 }
 try{await sealAndDrainKSwarmServiceInstance(kswarmService);}catch(error){errors.push(error);}
 restore();try{await fixture.close();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'owned_workflow_fixture_cleanup_failed');
 }};
}
