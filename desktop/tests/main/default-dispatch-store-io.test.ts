// @vitest-environment node
// Fixed original Store IO only; controlled Source is not NativeMain authority.
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import * as stores from '../../../src/runtime/task-host/snapshot-store.js';
import {createTaskDefaultDispatchPreparationIssuer} from '../../../src/runtime/task-host/default-dispatch-preparation.js';
import {buildTaskUnderstanding} from '../../../src/runtime/task-host/task-understanding.js';
const {defaultDispatchBusinessIdentity}=createRequire(resolve('package.json'))(resolve('../../kswarm/src/core/default-dispatch-birth-rules.js'));
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:5});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'dsh-store-io-')),path=join(root,'tasks');roots.push(root);const store=new stores.FileTaskSnapshotStore(path),proof=Object.freeze({}),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 const data={scope,projectId:'p',taskId:'p__a',runId:'original-run',businessExecutionGeneration:1,childKey:defaultDispatchBusinessIdentity(scope,'p','p__a').childKey,payloadHash:'d'.repeat(64),bindingDigest:'e'.repeat(64),hostId:'host',input:{prompt:'Original requested work',materials:[],permissionMode:'plan'}};
 const issuer=createTaskDefaultDispatchPreparationIssuer(store,{resolve(value:object){if(value!==proof)throw Error('controlled_original_proof_required');return{data,assertCurrent(){}};}}),identity=stores.readOriginalPreparationStoreBinding(store).identity;
 function io(){const read=(stores as any).readOriginalPreparationStoreIO;expect(read).toBeTypeOf('function');return read(store,identity);}
 function ticket(){const frame=issuer.open(proof,'scheduler');return frame.issue(()=>({taskId:frame.marker.taskId,sessionId:frame.marker.sessionId,status:'understanding',prompt:data.input.prompt,materials:[],understanding:buildTaskUnderstanding({prompt:data.input.prompt,materials:[]}),events:[{type:'task_started',taskId:frame.marker.taskId},{type:'understanding_updated',understanding:buildTaskUnderstanding({prompt:data.input.prompt,materials:[]})}],usage:{inputTokens:0,outputTokens:0,known:false},createdAt:1,updatedAt:1}));}
 const observation=()=>issuer.open(proof,'scheduler','observe').issueObservation();
 return{root,path,store,identity,io,ticket,observation};
}
it('reads fixed IO only for the original store and exact birth identity before candidate getters',()=>{
 const f=fixture(),io=f.io();expect(f.io()).toBe(io);expect(Object.isFrozen(io)).toBe(true);expect(existsSync(f.path)).toBe(false);let reads=0;const proxy=new Proxy({},{get(){reads++;throw Error('forbidden');}}),read=(stores as any).readOriginalPreparationStoreIO;
 expect(()=>read(proxy,f.identity)).toThrow();expect(()=>read(f.store,proxy)).toThrow();expect(()=>read({...f.store},f.identity)).toThrow();expect(reads).toBe(0);
});
it('keeps the original physical root on the existing original prepare entry after a late root shadow',async()=>{
 const f=fixture(),foreign=join(f.root,'foreign');Object.defineProperty(f.store,'rootDir',{value:foreign,writable:true});const result=await f.store.prepareDefaultDispatchSnapshot(f.ticket());expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);expect(existsSync(foreign)).toBe(false);await f.store.closeAndDrain();
});
it('does not let a late SDK consumer substitute cached bytes for the original observer',async()=>{
 const f=fixture(),prepared=await f.store.prepareDefaultDispatchSnapshot(f.ticket()),checkpoint=join(f.path,'snapshots',prepared.fact.taskId+'.json'),original=readFileSync(checkpoint,'utf8'),altered=JSON.parse(original);altered.prompt='Changed actual checkpoint';writeFileSync(checkpoint,JSON.stringify(altered));
 (f.store as any).consumeSyncSdk=async(raw:Promise<unknown>)=>{const value=await raw;return{value:typeof value==='string'&&value.includes(prepared.fact.taskId)?original:value};};
 await expect(f.store.readDefaultDispatchPreparation(f.observation())).rejects.toThrow();await f.store.closeAndDrain();
});
it('uses original prepare and uncached observation instead of later public method getters',async()=>{
 const f=fixture(),io=f.io();let reads=0;for(const name of ['prepareDefaultDispatchSnapshot','readDefaultDispatchPreparation'])Object.defineProperty(f.store,name,{get(){reads++;throw Error('late public method');}});
 const result=await io.prepare(f.ticket());expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);expect(await io.observe(f.observation())).toEqual(result.fact);expect(reads).toBe(0);await f.store.closeAndDrain();
});
it('keeps the born root and original inner helpers when public shadows attempt to redirect IO or replace the queue',async()=>{
 const f=fixture(),io=f.io(),foreign=join(f.root,'foreign');let reads=0;
 for(const name of ['rootDir','writerQueue','cache','assertWriterCurrent','snapshotDir','snapshotPath','journalPath','indexPath','enqueueWrite','loadSnapshotState','saveSerial','syncCommittedWrite','consumeSyncSdk'])Object.defineProperty(f.store,name,{configurable:true,get(){reads++;if(name==='rootDir')return foreign;throw Error('late inner dispatch '+name);}});
 const result=await io.prepare(f.ticket());expect(existsSync(join(f.path,'snapshots',result.fact.taskId+'.json'))).toBe(true);expect(existsSync(foreign)).toBe(false);expect(await io.observe(f.observation())).toEqual(result.fact);expect(reads).toBe(0);await f.store.closeAndDrain();
});
it('reads actual checkpoint bytes without index repair and rejects changed bytes instead of the prior prepared marker',async()=>{
 const f=fixture(),io=f.io(),prepared=await io.prepare(f.ticket()),checkpoint=join(f.path,'snapshots',prepared.fact.taskId+'.json'),index=join(f.path,'active-task.json');rmSync(index);
 expect(await io.observe(f.observation())).toEqual(prepared.fact);expect(existsSync(index)).toBe(false);const altered=JSON.parse(readFileSync(checkpoint,'utf8'));altered.prompt='Changed bytes';writeFileSync(checkpoint,JSON.stringify(altered));await expect(io.observe(f.observation())).rejects.toThrow();expect(existsSync(index)).toBe(false);await f.store.closeAndDrain();
});
