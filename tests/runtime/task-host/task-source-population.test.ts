import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as hostModule from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'task-population-'));roots.push(root);const store=new FileTaskSnapshotStore(join(root,'tasks'));const population=hostModule.createTaskSourceWriterPopulation(store);const options={materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async()=>{}};return{store,population,options};}
it('seals all actual Hosts but leaves their shared store open until accepted preparation drains',async()=>{
 const{store,population,options}=fixture();const busy=population.createHost(options),idle=population.createHost(options);
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const save=store.save.bind(store);let first=true;vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(first){first=false;entered();await wait;}return save(...args);});const close=vi.spyOn(store,'closeAndDrain');
 const preparing=busy.prepareTask({prompt:'accepted original',materials:[]});await ready;
 const closing=idle.closeSourceWriterForMigration();expect(closing).toBe(busy.closeSourceWriterForMigration());expect(closing).toBe(population.close());
 try{expect(()=>population.createHost(options)).toThrow('task_source_population_closing');await expect(idle.prepareTask({prompt:'new ingress',materials:[]})).rejects.toThrow('task_source_closing');await Promise.resolve();expect(close).not.toHaveBeenCalled();}
 finally{release();}
 const task=await preparing;await closing;expect(close).toHaveBeenCalledTimes(1);expect((await store.recoverTask(task.taskId))?.events.map(e=>e.type)).toEqual(['task_started','understanding_updated']);
});
it('waits the other original Host after one participant has an unconfirmed write',async()=>{
 const{store,population,options}=fixture();const failed=population.createHost(options),busy=population.createHost(options);
 const save=store.save.bind(store);let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(args[0].prompt==='failed source')throw Error('original_source_io_failure');if(args[0].prompt==='busy source'){entered();await wait;}return save(...args);});
 await expect(failed.prepareTask({prompt:'failed source',materials:[]})).rejects.toThrow('original_source_io_failure');
 const preparing=busy.prepareTask({prompt:'busy source',materials:[]});await ready;let settled=false;const close=vi.spyOn(store,'closeAndDrain');const closing=population.close().catch(error=>{settled=true;return error;});
 await new Promise(r=>setTimeout(r,10));expect(settled).toBe(false);expect(close).not.toHaveBeenCalled();release();await preparing;expect(await closing).toBeInstanceOf(AggregateError);expect(close).toHaveBeenCalledTimes(1);
});
it('publishes the same close Promise before synchronously sealing any actual participant',async()=>{
 const{store,population,options}=fixture();const first=population.createHost(options),second=population.createHost(options);let nested:Promise<void>|undefined,creationError:unknown;
 const stop=first.stopAccepting.bind(first);vi.spyOn(first,'stopAccepting').mockImplementation(reason=>{nested=second.closeSourceWriterForMigration();try{population.createHost(options);}catch(error){creationError=error;}stop(reason);});
 const closing=population.close();expect(nested).toBe(closing);expect(String(creationError)).toContain('task_source_population_closing');await closing;await expect(store.clearActiveTask('new')).rejects.toThrow('task_store_closed');
});
it('does not register a partially constructed Host when original options throw',async()=>{
 const{store,population,options}=fixture();let calls=0;const broken={...options,get runner():hostModule.TaskRunner{throw Error('original_constructor_input_failed');}};
 expect(()=>population.createHost(broken)).toThrow('original_constructor_input_failed');const host=population.createHost({...options,runner:async()=>{calls++;}});await host.createTask({prompt:'actual healthy member',materials:[]});await population.close();expect(calls).toBe(1);await expect(store.clearActiveTask('new')).rejects.toThrow('task_store_closed');
});
it('retires only the original member after its drain without closing the shared store',async()=>{
 const{store,population,options}=fixture();const original=population.createHost(options);await original.createTask({prompt:'original member',materials:[]});const close=vi.spyOn(store,'closeAndDrain');
 const retiring=population.retireHost(original);expect(population.retireHost(original)).toBe(retiring);await retiring;expect(original.closeSourceWriterForMigration()).toBe(retiring);expect(population.retainedHostCount).toBe(0);expect(close).not.toHaveBeenCalled();await expect(original.prepareTask({prompt:'leaked old host',materials:[]})).rejects.toThrow('task_source_closing');
 const foreign=new hostModule.InProcessTaskRuntimeHost({...options,snapshotStore:store});await expect(population.retireHost(foreign)).rejects.toThrow('task_source_population_member_required');population.createHost(options);expect(population.retainedHostCount).toBe(1);await population.close();
});
it('joins an original retirement drain concurrently with whole population close',async()=>{
 const{store,population,options}=fixture();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);const host=population.createHost({...options,runner:async()=>{entered();await wait;}});await host.createTask({prompt:'concurrent retirement',materials:[]});await ready;const retiring=population.retireHost(host);const closing=population.close();const close=vi.spyOn(store,'closeAndDrain');await Promise.resolve();expect(close).not.toHaveBeenCalled();release();await Promise.all([retiring,closing]);expect(close).toHaveBeenCalledTimes(1);expect(population.retainedHostCount).toBe(0);
});
it('retains an unconfirmed member and refuses new members after failed retirement',async()=>{
 const{store,population,options}=fixture();const host=population.createHost(options);vi.spyOn(store,'save').mockRejectedValue(Error('original_io_unconfirmed'));await expect(host.prepareTask({prompt:'unconfirmed',materials:[]})).rejects.toThrow('original_io_unconfirmed');await expect(population.retireHost(host)).rejects.toThrow('task_source_close_unconfirmed');expect(population.retainedHostCount).toBe(1);expect(()=>population.createHost(options)).toThrow('task_source_population_unconfirmed');await expect(population.close()).rejects.toThrow('task_source_close_unconfirmed');
});
