import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation,issueOriginalManagedGroupResource,readCurrentOriginalTaskRunnerResourceContext} from '../../../src/runtime/task-host/task-runtime-host.js';
export function resourceBarrier(){let release!:()=>void;return {promise:new Promise<void>(yes=>{release=yes;}),release:()=>release()};}
/** Real Store/Population/Host invocation. This fixture issues no Native grant. */
export async function openManagedResourceFixture(){
 const root=mkdtempSync(join(tmpdir(),'managed-resource-host-'));
 const store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store);
 const materialRegistry=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 const entered=resourceBarrier(),hold=resourceBarrier();
 const source={inspectGroupObservationReference(){throw Error('unexpected_group_metadata_read');},commitGroupObservationReference(){throw Error('unexpected_group_metadata_write');}};
 let input:object|undefined,issuer:object|null=null,originalContext:object|null=null;
 const host=population.createHost({materialRegistry,groupObservationSource:source,runner:async actual=>{
   input=actual;originalContext=readCurrentOriginalTaskRunnerResourceContext();issuer=issueOriginalManagedGroupResource(actual,source);entered.release();await hold.promise;
 }});
 const task=await host.createTask({prompt:'Independent resident resource lifetime',materials:[]});await entered.promise;
 if(!issuer)throw Error('fixture_original_group_missing');
 let retained=false;
 return {root,store,population,host,task,input:input!,issuer,source,originalContext:originalContext!,releaseRoot:hold.release,
   retainUnknown(){retained=true;},
   async close(){hold.release();population.stopAccepting('fixture_close');population.abortAllActive('fixture_close');await population.drainShutdown();await population.close();if(!retained)rmSync(root,{recursive:true,force:true,maxRetries:5});}
 };
}
