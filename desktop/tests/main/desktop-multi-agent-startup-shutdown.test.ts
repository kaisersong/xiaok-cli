// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopMultiAgentService} from '../../electron/desktop-multi-agent-service.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'ma-startup-shutdown-')),store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));
 const materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024}),snapshots=new FileTaskSnapshotStore(join(root,'tasks'));
 const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:async()=>{throw Error('must not create a model session');}});
 const host=new InProcessTaskRuntimeHost({snapshotStore:snapshots,materialRegistry:materials,runner:async()=>{throw Error('must not run task');}});
 return {root,store,service,host,async close(){await service.dispose();await host.drain();await snapshots.closeAndDrain();await materials.sealAndDrainInstanceMutations();store.close();rmSync(root,{recursive:true,force:true,maxRetries:3});}};
}
it('original never-entered MA recovery can shut down without entering recovery, and cannot initialize after disposal',async()=>{
 const f=fixture(),claim=vi.spyOn(f.store,'claimBootOwnership');
 try{await f.service.quiesceShutdown();expect(f.service.isShutdownQuiescent()).toBe(true);expect(claim).not.toHaveBeenCalled();await f.service.dispose();let failure:unknown;try{await f.service.initialize(f.host);}catch(raw){failure=raw;}expect(claim).not.toHaveBeenCalled();expect(failure).toEqual(Error('multi_agent_shutting_down'));}
 finally{await f.close();}
});
it.each(['success','failure'] as const)('entered MA recovery remains unconfirmed while pending and preserves %s fate',async outcome=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(yes=>release=yes),ready=new Promise<void>(yes=>entered=yes),raw=Error('original recovery failure');
 const inspect=f.host.inspectActiveTasks.bind(f.host);vi.spyOn(f.host,'inspectActiveTasks').mockImplementation(async()=>{entered();await gate;if(outcome==='failure')throw raw;return inspect();});
 try{const initializing=f.service.initialize(f.host);void initializing.catch(()=>{});await ready;const closing=f.service.quiesceShutdown();void closing.catch(()=>{});let settled=false;void closing.then(()=>settled=true,()=>settled=true);await Promise.resolve();expect(settled).toBe(false);expect(f.service.isShutdownQuiescent()).toBe(false);release();if(outcome==='failure'){await expect(initializing).rejects.toBe(raw);await expect(closing).rejects.toBe(raw);expect(f.service.isShutdownQuiescent()).toBe(false);}else{await initializing;await closing;expect(f.service.isShutdownQuiescent()).toBe(true);}}
 finally{release();await f.close();}
});
it('synchronous original Host binding reentry reuses the same pending recovery promise',async()=>{
 const f=fixture(),bind=f.host.bindMultiAgentRecovery.bind(f.host);let reentered:Promise<void>|undefined;
 vi.spyOn(f.host,'bindMultiAgentRecovery').mockImplementation(promise=>{reentered=f.service.initialize(f.host);return bind(promise);});
 try{const initializing=f.service.initialize(f.host);expect(reentered).toBe(initializing);expect(f.service.isShutdownQuiescent()).toBe(false);await initializing;await f.service.quiesceShutdown();expect(f.service.isShutdownQuiescent()).toBe(true);}
 finally{await f.close();}
});
