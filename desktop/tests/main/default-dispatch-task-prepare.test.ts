// @vitest-environment node
// Original file-store physical prepare seam only; source is a controlled
// constructor port, not NativeMain/B/runtime execution qualification.
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import * as fileIo from 'node:fs/promises';
const {defaultDispatchBusinessIdentity}=createRequire(resolve('package.json'))(resolve('../../kswarm/src/core/default-dispatch-birth-rules.js'));
import {afterEach,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>{vi.resetModules();return({reads:0,readFileHook:undefined as ((original:Function,args:any[])=>unknown)|undefined,failClose:false,failSync:false,held:[] as Array<{close:()=>Promise<void>}>,closeError:Error('actual original handle close failure'),syncError:Error('actual original handle sync failure')});});

// Preserve the actual SDK for all reads; fault tests alter only its returned
// raw at this exact lower boundary and assert the original entry was reached.
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,readFile(...args:any[]){io.reads++;return io.readFileHook?io.readFileHook(actual.readFile,args):Reflect.apply(actual.readFile,actual,args);}};
});

import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation,InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {buildTaskUnderstanding} from '../../../src/runtime/task-host/task-understanding.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {createTaskDefaultDispatchPreparationIssuer,originalPreparedContentDigest} from '../../../src/runtime/task-host/default-dispatch-preparation.js';
const roots:string[]=[];afterEach(async()=>{io.readFileHook=undefined;io.failClose=false;io.failSync=false;const held=io.held.splice(0);for(const h of held)await h.close();if(held.length)console.log(JSON.stringify({test:'original-prepare-filehandle-fixture-cleanup',ownedHandles:held.length,actualOriginalCloseCompleted:held.length,notProductionPhysicalClose:true}));for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'default-dispatch-task-')),path=join(root,'tasks');roots.push(root);const store=new FileTaskSnapshotStore(path),frames=new WeakMap<object,any>();let builds=0,live=true,resolveHook:(()=>void)|undefined;
 const source={resolve(proof:object){const data=frames.get(proof);if(!data)throw Error('original_prepare_proof_required');resolveHook?.();return{data,assertCurrent(){if(!live)throw Error('original_prepare_withdrawn');}};}};
 const issuer=createTaskDefaultDispatchPreparationIssuer(store,source),data={scope:{profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},projectId:'p',taskId:'p__a',runId:'run-original',businessExecutionGeneration:1,childKey:defaultDispatchBusinessIdentity({profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},'p','p__a').childKey,payloadHash:'d'.repeat(64),bindingDigest:'e'.repeat(64),hostId:'stable-host',input:{prompt:'Original request',materials:[],permissionMode:'plan'}};
 async function prepare(next=data,target=store){const proof=Object.freeze({});frames.set(proof,next);const frame=issuer.open(proof,'scheduler');return target.prepareDefaultDispatchSnapshot(frame.issue(()=>{builds++;return{taskId:frame.marker.taskId,sessionId:frame.marker.sessionId,status:'understanding',prompt:next.input.prompt,materials:[],events:[{type:'task_started',taskId:frame.marker.taskId},{type:'understanding_updated',understanding:buildTaskUnderstanding({prompt:next.input.prompt,materials:[]})}],usage:{inputTokens:0,outputTokens:0,known:false},createdAt:1,updatedAt:1};}));}
 return{root,path,store,issuer,source,frames,data,prepare,get builds(){return builds;},setResolveHook(hook:()=>void){resolveHook=hook;},withdraw(){live=false;}};
}
it('writes one original sealed checkpoint and reuses it across duplicate calls and a fresh original store',async()=>{
 const f=fixture(),a=await f.prepare(),b=await f.prepare();expect(a.fact).toEqual(b.fact);expect(f.builds).toBe(1);expect(a.fact.taskId).toMatch(/^task_default_dispatch_[a-f0-9]{64}$/);expect((await f.store.recoverTask(a.fact.taskId))?.events).toHaveLength(2);
 const reopened=new FileTaskSnapshotStore(f.path),issuer=createTaskDefaultDispatchPreparationIssuer(reopened,f.source),proof=Object.freeze({});f.frames.set(proof,f.data);const frame=issuer.open(proof,'scheduler');const c=await reopened.prepareDefaultDispatchSnapshot(frame.issue(()=>{throw Error('duplicate prepare body');}));expect(c.fact).toEqual(a.fact);expect(c.receipt).not.toBe(a.receipt);
});
it('reaches the same deterministic identity and rejects a changed payload without a second prepare',async()=>{
 const f=fixture();await f.prepare();await expect(f.prepare({...f.data,payloadHash:'f'.repeat(64)})).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_CONFLICT');expect(f.builds).toBe(1);
});
it('repairs an index failure after the actual checkpoint without rebuilding or inventing another task',async()=>{
 const f=fixture();mkdirSync(f.path,{recursive:true});mkdirSync(join(f.path,'active-task.json'));await expect(f.prepare()).rejects.toThrow();expect(f.builds).toBe(1);rmSync(join(f.path,'active-task.json'),{recursive:true});const value=await f.prepare();expect(f.builds).toBe(1);expect(JSON.parse(readFileSync(join(f.path,'active-task.json'),'utf8')).activeTaskIds).toEqual([value.fact.taskId]);
});
it('refuses fake/copied tickets and a different original store before running a builder',async()=>{
 const f=fixture();await expect(f.store.prepareDefaultDispatchSnapshot({})).rejects.toThrow();const other=new FileTaskSnapshotStore(join(f.root,'other'));await expect(f.prepare(f.data,other)).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');expect(f.builds).toBe(0);
});
it('default-denies non-scheduler and unknown proof before capturing a caller object',()=>{
 const f=fixture();let reads=0;const proof=Object.defineProperty({},'scope',{get(){reads++;throw Error('forbidden');}});expect(()=>f.issuer.open(proof,'agent')).toThrow();expect(()=>f.issuer.open(proof,'user')).toThrow();expect(()=>f.issuer.open(proof,'scheduler')).toThrow('original_prepare_proof_required');expect(reads).toBe(0);
});
it('withdraws the original admission before the first physical checkpoint',async()=>{
 const f=fixture();f.withdraw();await expect(f.prepare()).rejects.toThrow('original_prepare_withdrawn');expect(f.builds).toBe(0);
});

it('generic original save paths cannot mint, erase, alter or execute a durable preparation marker',async()=>{
 const f=fixture(),value=await f.prepare(),original=(await f.store.recoverTask(value.fact.taskId))!;
 const forged=new FileTaskSnapshotStore(join(f.root,'forged'));await expect(forged.save(original)).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_IMMUTABLE');
 for(const change of [(s:any)=>{delete s.originalChildPreparation;},(s:any)=>{s.originalChildPreparation.payloadHash='f'.repeat(64);},(s:any)=>{s.prompt='Different work';},(s:any)=>{s.status='running';}]){
  const next=JSON.parse(JSON.stringify(original));change(next);await expect(f.store.save(next)).rejects.toThrow();await expect(f.store.saveWithReceipt(next)).rejects.toThrow();expect(await f.store.recoverTask(value.fact.taskId)).toEqual(original);
 }
});
it('uses the actual original Host builder once and denies old launch, answer, cancel and recovery effects',async()=>{
 const f=fixture(),population=createTaskSourceWriterPopulation(f.store),materials=new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),proof=Object.freeze({});f.frames.set(proof,f.data);let builds=0,tokens=0,runs=0;
 const options={materialRegistry:materials,defaultDispatchPreparationSource:f.source,runner:async()=>{runs++;},now:()=>{builds++;return 1;},acquireExecutionToken:()=>{tokens++;return{release(){}};}},a=population.createHost(options),b=population.createHost(options);
 try{
  const one=await a.prepareDefaultDispatchTask(proof,'scheduler'),two=await b.prepareDefaultDispatchTask(proof,'scheduler');expect(one.fact).toEqual(two.fact);expect(builds).toBe(1);expect(a.getPreparedSourceReceipt(one.fact.taskId)).toBeUndefined();
  const snapshot=(await a.recoverTask(one.fact.taskId)).snapshot;expect(snapshot.originalChildPreparation).toEqual(one.fact);expect(snapshot.understanding?.goal).toBeTruthy();expect(snapshot.events).toHaveLength(2);
  await expect(a.startTask(one.fact.taskId)).rejects.toThrow('DEFAULT_DISPATCH_EXECUTION_UNAVAILABLE');await expect(a.answerQuestion({taskId:one.fact.taskId,answer:{questionId:'fake',type:'choice',choiceId:'confirm'}})).rejects.toThrow('DEFAULT_DISPATCH_EXECUTION_UNAVAILABLE');await expect(a.cancelTask(one.fact.taskId)).rejects.toThrow('DEFAULT_DISPATCH_EXECUTION_UNAVAILABLE');expect(tokens).toBe(0);expect(runs).toBe(0);
 }finally{await population.close();}
});
it('an ordinary original Host without its constructor source cannot prepare a durable child',async()=>{
 const f=fixture(),host=new InProcessTaskRuntimeHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),snapshotStore:f.store,runner:async()=>{throw Error('must not execute');}});
 try{await expect(host.prepareDefaultDispatchTask({},'scheduler')).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_SOURCE_REQUIRED');}finally{await host.closeSourceWriterForMigration();}
});

it('does not report a healthy original store close after a real retained FileHandle close failed',async()=>{
 const f=fixture(),fs=createRequire(resolve('package.json'))('node:fs/promises'),probe=await fs.open(join(f.root,'io-probe'),'w'),prototype=Object.getPrototypeOf(probe),sync=prototype.sync;await probe.close();
 prototype.sync=async function(...args:any[]){if(io.failClose){const close=this.close.bind(this);this.close=async()=>{io.held.push({close});throw io.closeError;};if(io.failSync)throw io.syncError;}return Reflect.apply(sync,this,args);};
 try{io.failClose=true;await expect(f.prepare()).rejects.toBe(io.closeError);expect(io.held).toHaveLength(1);io.failClose=false;await expect(f.store.closeAndDrain()).rejects.toThrow('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');}finally{prototype.sync=sync;io.failClose=false;}
});

it('joins a held standard raw in the assertCurrent field before reporting original source close',async()=>{
 const f=fixture();let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;}),issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve(){return{data:f.data,assertCurrent:raw};}});
 expect(()=>issuer.open({},'scheduler')).toThrow();let done=false;const close=issuer.drain().then(()=>{done=true;},()=>{done=true;});try{await new Promise(yes=>setTimeout(yes,15));expect(done).toBe(false);}finally{release();await close;}
});
for(const phase of ['resolve','current'])it('reserves its '+phase+' SDK root before a reentrant source drain can report completion',async()=>{
 const f=fixture();let release!:()=>void,done=false,close:Promise<void>|undefined;const raw=new Promise<void>(yes=>{release=yes;});let issuer:ReturnType<typeof createTaskDefaultDispatchPreparationIssuer>;
 const reenter=()=>{close=issuer.drain().then(()=>{done=true;},()=>{done=true;});return raw;};issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve(){return phase==='resolve'?reenter():{data:f.data,assertCurrent:reenter};}});
 expect(()=>issuer.open({},'scheduler')).toThrow();try{await new Promise(yes=>setTimeout(yes,15));expect(done).toBe(false);}finally{release();await close;}
});
for(const phase of ['resolve','current'])it('refuses a bound async '+phase+' before its SDK body or late continuation',async()=>{
 const f=fixture();let body=0,late=0;const fn=(async()=>{body++;await Promise.resolve();late++;}).bind(null);let issuer:ReturnType<typeof createTaskDefaultDispatchPreparationIssuer>|undefined;
 try{if(phase==='resolve'){try{issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve:fn});issuer.open({},'scheduler');}catch{}}else{issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve(){return{data:f.data,assertCurrent:fn};}});expect(()=>issuer!.open({},'scheduler')).toThrow();}await Promise.resolve();expect(body).toBe(0);expect(late).toBe(0);}finally{if(issuer)await issuer.drain().catch(()=>{});}
});
it('does not admit or inspect a source envelope carrying an inherited then accessor',async()=>{
 const f=fixture();let reads=0;const reply=Object.assign(Object.create(Object.defineProperty({},'then',{get(){reads++;throw Error('forbidden inherited then');}})),{data:f.data,assertCurrent(){}}),issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve(){return reply;}});
 try{expect(()=>issuer.open({},'scheduler')).toThrow();expect(reads).toBe(0);}finally{await issuer.drain().catch(()=>{});}
});
it('joins known SDK siblings even when the source envelope has a rejected foreign prototype',async()=>{
 const f=fixture();let release!:()=>void,done=false;const raw=new Promise<void>(yes=>{release=yes;}),reply=Object.assign(Object.create({foreign:true}),{data:f.data,assertCurrent(){},extra:raw});
 const issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve(){return reply;}});expect(()=>issuer.open({},'scheduler')).toThrow();const close=issuer.drain().then(()=>{done=true;},()=>{done=true;});
 try{await new Promise(yes=>setTimeout(yes,15));expect(done).toBe(false);expect(existsSync(f.path)).toBe(false);}finally{release();await close;}
});
for(const kind of ['foreign','promise','array-sidecar','array-index','array-long'])it('keeps known raw siblings inside a rejected '+kind+' source value until their actual settlement',async()=>{
 const f=fixture();let release!:()=>void,done=false;const held=new Promise<void>(yes=>{release=yes;}),extra=kind==='array-sidecar'?Object.assign([],{sidecar:held}):kind==='array-index'?Object.assign([],{['01']:held}):kind==='array-long'?Object.assign(new Array(1_000_001),{sidecar:held}):Object.assign(kind==='promise'?Promise.resolve():Object.create({foreign:true}),{held});
 const issuer=createTaskDefaultDispatchPreparationIssuer(f.store,{resolve(){return{data:f.data,assertCurrent(){},extra};}});expect(()=>issuer.open({},'scheduler')).toThrow();const close=issuer.drain().then(()=>{done=true;},()=>{done=true;});
 try{await new Promise(yes=>setTimeout(yes,15));expect(done).toBe(false);}finally{release();await close;}
});
it('refuses a reserved deterministic task identity whose marker was omitted by an ordinary writer',async()=>{
 const f=fixture(),proof=Object.freeze({});f.frames.set(proof,f.data);const frame=f.issuer.open(proof,'scheduler');
 await expect(f.store.save({taskId:frame.marker.taskId,sessionId:frame.marker.sessionId,status:'understanding',prompt:'Different work',materials:[],events:[],createdAt:1,updatedAt:1})).rejects.toThrow();
});
it('does not certify changed checkpoint content as the original prepared child after reopen',async()=>{
 const f=fixture(),first=await f.prepare(),path=join(f.path,'snapshots',first.fact.taskId+'.json'),checkpoint=JSON.parse(readFileSync(path,'utf8'));checkpoint.prompt='Different work';const fs=await import('node:fs');fs.writeFileSync(path,JSON.stringify(checkpoint));
 const reopened=new FileTaskSnapshotStore(f.path),issuer=createTaskDefaultDispatchPreparationIssuer(reopened,f.source),proof=Object.freeze({});f.frames.set(proof,f.data);const frame=issuer.open(proof,'scheduler');await expect(reopened.prepareDefaultDispatchSnapshot(frame.issue(()=>{throw Error('must not rebuild');}))).rejects.toThrow();
});
it('requires the original natural child identity instead of allowing another plausible key to create a second host task',async()=>{
 const f=fixture();await f.prepare();await expect(f.prepare({...f.data,childKey:'default-dispatch-child:'+'f'.repeat(64)})).rejects.toThrow();expect(f.builds).toBe(1);
});

it('does not lose the original failed sync when its rejection value is undefined',async()=>{
 const f=fixture(),fs=createRequire(resolve('package.json'))('node:fs/promises'),probe=await fs.open(join(f.root,'io-probe'),'w'),prototype=Object.getPrototypeOf(probe),sync=prototype.sync;await probe.close();let calls=0;
 prototype.sync=async function(){calls++;throw undefined;};try{await expect(f.prepare()).rejects.toBeUndefined();expect(calls).toBe(1);}finally{prototype.sync=sync;}
});
it('does not certify a non-Promise close return while the actual original descriptor remains open',async()=>{
 const f=fixture(),fs=createRequire(resolve('package.json'))('node:fs/promises'),probe=await fs.open(join(f.root,'io-probe'),'w'),prototype=Object.getPrototypeOf(probe),sync=prototype.sync;await probe.close();
 prototype.sync=async function(...args:any[]){const close=this.close.bind(this);this.close=()=>{io.held.push({close});return undefined;};return Reflect.apply(sync,this,args);};
 try{await expect(f.prepare()).rejects.toThrow();expect(io.held).toHaveLength(1);await expect(f.store.closeAndDrain()).rejects.toThrow('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');}finally{prototype.sync=sync;}
});
it('checks the original source input again when a changed checkpoint carries a self-consistent digest',async()=>{
 const f=fixture(),first=await f.prepare(),path=join(f.path,'snapshots',first.fact.taskId+'.json'),checkpoint=JSON.parse(readFileSync(path,'utf8'));checkpoint.prompt='Different work';checkpoint.originalChildPreparation.preparedContentDigest=originalPreparedContentDigest(checkpoint,checkpoint.originalChildPreparation.inputDigest);const fs=await import('node:fs');fs.writeFileSync(path,JSON.stringify(checkpoint));
 const reopened=new FileTaskSnapshotStore(f.path),issuer=createTaskDefaultDispatchPreparationIssuer(reopened,f.source),proof=Object.freeze({});f.frames.set(proof,f.data);const frame=issuer.open(proof,'scheduler');await expect(reopened.prepareDefaultDispatchSnapshot(frame.issue(()=>{throw Error('must not rebuild');}))).rejects.toThrow();
});
it('refuses a first builder whose prompt is different from its original fixed source input',async()=>{
 const f=fixture(),proof=Object.freeze({});f.frames.set(proof,f.data);const frame=f.issuer.open(proof,'scheduler');await expect(f.store.prepareDefaultDispatchSnapshot(frame.issue(()=>({taskId:frame.marker.taskId,sessionId:frame.marker.sessionId,status:'understanding',prompt:'Different work',materials:[],events:[],createdAt:1,updatedAt:1})))).rejects.toThrow('DEFAULT_DISPATCH_PREPARED_CONTENT_INVALID');
});
for(const seam of ['now','material'])it('holds the original Host '+seam+' SDK raw before any projection can discard it',async()=>{
 const f=fixture(),population=createTaskSourceWriterPopulation(f.store),materials=new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),proof=Object.freeze({});let release!:()=>void,done=false;const raw=new Promise<void>(yes=>{release=yes;});
 const data=seam==='material'?{...f.data,input:{...f.data.input,materials:[{materialId:'m'}]}}:f.data;f.frames.set(proof,data);if(seam==='material')materials.get=(()=>raw) as never;
 const host=population.createHost({materialRegistry:materials,defaultDispatchPreparationSource:f.source,runner:async()=>{throw Error('must not run');},now:(seam==='now'?()=>raw:()=>1) as never});await expect(host.prepareDefaultDispatchTask(proof,'scheduler')).rejects.toThrow();
 const closing=population.close().then(()=>{done=true;},()=>{done=true;});try{await new Promise(yes=>setTimeout(yes,15));expect(done).toBe(false);}finally{release();await closing;}
});

it('preserves ordinary material preparation inputs through the actual fixed Host and only reads the registry once',async()=>{
 const f=fixture(),population=createTaskSourceWriterPopulation(f.store),registry=new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),fs=await import('node:fs'),source=join(f.root,'source.md');fs.writeFileSync(source,'# Original material');
 const material=await registry.importMaterial({taskId:'seed',sourcePath:source,role:'customer_material',roleSource:'user'}),proof=Object.freeze({});f.frames.set(proof,{...f.data,input:{...f.data.input,materials:[{materialId:material.materialId,role:'customer_material'}]}});const get=registry.get.bind(registry);let reads=0;registry.get=function(id){reads++;return get(id);};const host=population.createHost({materialRegistry:registry,defaultDispatchPreparationSource:f.source,runner:async()=>{throw Error('must not run');},now:()=>1});
 try{const first=await host.prepareDefaultDispatchTask(proof,'scheduler'),second=await host.prepareDefaultDispatchTask(proof,'scheduler');expect(second.fact).toEqual(first.fact);expect(reads).toBe(1);expect((await host.inspectTask(first.fact.taskId))?.materials[0]).toMatchObject({materialId:material.materialId,role:'customer_material'});}finally{await population.close();}
});

it('keeps the original configured receiver for the fixed preparation clock',async()=>{
 const f=fixture(),population=createTaskSourceWriterPopulation(f.store),proof=Object.freeze({});f.frames.set(proof,f.data);const options={materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),defaultDispatchPreparationSource:f.source,runner:async()=>{},clockValue:7,now(){return this.clockValue;}};const host=population.createHost(options);
 try{const receipt=await host.prepareDefaultDispatchTask(proof,'scheduler');expect((await host.inspectTask(receipt.fact.taskId))?.createdAt).toBe(7);}finally{await population.close();}
});

// Preparation observations are read-cut metadata, never durable write or launch receipts.
function observation(f:ReturnType<typeof fixture>,target=f.store){
 const issuer=createTaskDefaultDispatchPreparationIssuer(target,f.source),proof=Object.freeze({});f.frames.set(proof,f.data);
 return issuer.open(proof,'scheduler','observe').issueObservation();
}
it('observes an absent original preparation without creating its root, lock or index',async()=>{
 const f=fixture();expect(existsSync(f.path)).toBe(false);
 expect(await f.store.readDefaultDispatchPreparation(observation(f))).toBeNull();expect(existsSync(f.path)).toBe(false);expect(f.builds).toBe(0);
});
it('reads the original preparation after reopen without repairing its index or issuing a write receipt',async()=>{
 const f=fixture(),prepared=await f.prepare();rmSync(join(f.path,'active-task.json'));const names=readdirSync(f.path).sort(),checkpoint=readFileSync(join(f.path,'snapshots',prepared.fact.taskId+'.json'),'utf8');
 const reopened=new FileTaskSnapshotStore(f.path),fact=await reopened.readDefaultDispatchPreparation(observation(f,reopened));
 expect(fact).toEqual(prepared.fact);expect(fact).not.toHaveProperty('receipt');expect(Object.isFrozen(fact)).toBe(true);
 expect(readdirSync(f.path).sort()).toEqual(names);expect(existsSync(join(f.path,'active-task.json'))).toBe(false);expect(readFileSync(join(f.path,'snapshots',prepared.fact.taskId+'.json'),'utf8')).toBe(checkpoint);expect(f.builds).toBe(1);
});
it('keeps original observation and preparation tickets mutually non-interchangeable',async()=>{
 const f=fixture(),proof=Object.freeze({});f.frames.set(proof,f.data);const birth=f.issuer.open(proof,'scheduler'),read=f.issuer.open(proof,'scheduler','observe');
 expect(()=>birth.issueObservation()).toThrow('DEFAULT_DISPATCH_PREPARATION_PURPOSE_REQUIRED');expect(()=>read.issue(()=>{throw Error('must not build');})).toThrow('DEFAULT_DISPATCH_PREPARATION_PURPOSE_REQUIRED');
 await expect(f.store.prepareDefaultDispatchSnapshot(read.issueObservation())).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');
 await expect(f.store.readDefaultDispatchPreparation(birth.issue(()=>{throw Error('must not build');}))).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');expect(f.builds).toBe(0);expect(existsSync(f.path)).toBe(false);
});
for(const damage of ['orphan-journal','partial-tail','changed-body','duplicate-key','unsealed','missing-marker'])it('refuses '+damage+' as an observation and never repairs it',async()=>{
 const f=fixture(),prepared=await f.prepare(),checkpointPath=join(f.path,'snapshots',prepared.fact.taskId+'.json'),journalPath=join(f.path,'snapshots',prepared.fact.taskId+'.journal.jsonl');
 if(damage==='orphan-journal'){rmSync(checkpointPath);writeFileSync(journalPath,'{}\n');}
 if(damage==='partial-tail')writeFileSync(journalPath,'{"version":');
 if(damage==='duplicate-key')writeFileSync(checkpointPath,'{"status":"understanding",'+readFileSync(checkpointPath,'utf8').slice(1));
 if(damage==='unsealed'||damage==='missing-marker'){const body=JSON.parse(readFileSync(checkpointPath,'utf8'));delete body[damage==='unsealed'?'__xiaokJournal':'originalChildPreparation'];writeFileSync(checkpointPath,JSON.stringify(body));}
 if(damage==='changed-body'){const body=JSON.parse(readFileSync(checkpointPath,'utf8'));body.prompt='different';body.originalChildPreparation.preparedContentDigest=originalPreparedContentDigest(body,body.originalChildPreparation.inputDigest);writeFileSync(checkpointPath,JSON.stringify(body));}
 const before=existsSync(journalPath)?readFileSync(journalPath,'utf8'):null;
 await expect(f.store.readDefaultDispatchPreparation(observation(f))).rejects.toThrow();
 expect(existsSync(journalPath)?readFileSync(journalPath,'utf8'):null).toBe(before);expect(f.builds).toBe(1);
});
it('binds the original Host proof purpose before any preparation, and observes without a builder',async()=>{
 const f=fixture(),population=createTaskSourceWriterPopulation(f.store),proofs=new WeakMap<object,string>(),p=Object.freeze({}),q=Object.freeze({});proofs.set(p,'prepare');proofs.set(q,'observe');let clocks=0,runs=0;
 const host=population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),defaultDispatchPreparationSource:{resolve(proof,purpose){if(proofs.get(proof as object)!==purpose)throw Error('original_purpose_required');return{data:f.data,assertCurrent(){}};}},now:()=>{clocks++;return 1;},runner:async()=>{runs++;}});
 try{
  await expect(host.readDefaultDispatchPreparation(p,'scheduler')).rejects.toThrow('original_purpose_required');await expect(host.prepareDefaultDispatchTask(q,'scheduler')).rejects.toThrow('original_purpose_required');
  expect(await host.readDefaultDispatchPreparation(q,'scheduler')).toBeNull();expect(existsSync(f.path)).toBe(false);
  const prepared=await host.prepareDefaultDispatchTask(p,'scheduler');expect(await host.readDefaultDispatchPreparation(q,'scheduler')).toEqual(prepared.fact);expect(clocks).toBe(1);expect(runs).toBe(0);
  for(const requestSource of ['user','agent'] as const)await expect(host.readDefaultDispatchPreparation(q,requestSource)).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_SOURCE_REQUIRED');
  await expect(host.readDefaultDispatchPreparation({},'scheduler')).rejects.toThrow('original_purpose_required');
 }finally{await population.close();}
});

for(const fail of [false,true])it('keeps actual original readFile SDK raw through Host close'+(fail?' and preserves its late error':''),async()=>{
 const f=fixture(),prepared=await f.prepare(),population=createTaskSourceWriterPopulation(f.store),proof=Object.freeze({});f.frames.set(proof,f.data);
 const host=population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'workspace'),maxBytes:1024}),defaultDispatchPreparationSource:f.source,runner:async()=>{throw Error('must not execute');}});
 const late=Error('original_readFile_late_failure');let hits=0,release:(()=>void)|undefined,readDone=false,closeDone=false;
 io.readFileHook=(original,args)=>{const raw=Reflect.apply(original,undefined,args);if(typeof args[0]==='string'&&args[0].endsWith(prepared.fact.taskId+'.json')){hits++;return new Promise((yes,no)=>{release=()=>{raw.then((value:unknown)=>{if(fail)no(late);else yes(value);},no);};});}return raw;};
 let read:Promise<any>|undefined,close:Promise<any>|undefined;
 try{
  read=host.readDefaultDispatchPreparation(proof,'scheduler').then(value=>{readDone=true;return{value};},error=>{readDone=true;return{error};});
  await vi.waitFor(()=>expect(hits,JSON.stringify({allMockReads:io.reads,hookPresent:!!io.readFileHook,readIsMockNamespace:typeof fileIo.readFile})).toBe(1));close=population.close().then(()=>{closeDone=true;},error=>{closeDone=true;return error;});
  await new Promise(yes=>setTimeout(yes,15));expect(readDone).toBe(false);expect(closeDone).toBe(false);
  release!();const outcome=await read;await close;
  expect(outcome.error).toBeTruthy();if(fail)expect(outcome.error).toBe(late);else expect(outcome.error.message).toBe('DEFAULT_DISPATCH_PREPARATION_SEALED');expect(hits).toBe(1);
 }finally{release?.();await read;await close;io.readFileHook=undefined;}
});
it('refuses a checkpoint replaced at the actual original readFile SDK seam',async()=>{
 const f=fixture(),prepared=await f.prepare();let hits=0;
 io.readFileHook=async(original,args)=>{const value=await Reflect.apply(original,undefined,args);if(typeof args[0]==='string'&&args[0].endsWith(prepared.fact.taskId+'.json')){hits++;writeFileSync(args[0],String(value)+' ');}return value;};
 try{await expect(f.store.readDefaultDispatchPreparation(observation(f))).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_READ_UNCONFIRMED');expect(hits).toBe(1);expect(f.builds).toBe(1);}finally{io.readFileHook=undefined;}
});
it('refuses copied observation tickets and an observation for another original store before any disk creation',async()=>{
 const f=fixture(),ticket=observation(f),other=new FileTaskSnapshotStore(join(f.root,'other'));
 await expect(f.store.readDefaultDispatchPreparation({...ticket})).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');
 await expect(other.readDefaultDispatchPreparation(ticket)).rejects.toThrow('DEFAULT_DISPATCH_PREPARATION_TICKET_REQUIRED');
 expect(existsSync(f.path)).toBe(false);expect(existsSync(join(f.root,'other'))).toBe(false);
});
it('retains a foreign read SDK raw without invoking its then getter or claiming healthy store close',async()=>{
 const f=fixture(),prepared=await f.prepare();let hits=0,getters=0;const physical:Promise<unknown>[]=[];
 const raw=Object.defineProperty({},'then',{get(){getters++;throw Error('forbidden read raw then');}});
 io.readFileHook=(original,args)=>{const actual=Reflect.apply(original,undefined,args);physical.push(actual);if(typeof args[0]==='string'&&args[0].endsWith(prepared.fact.taskId+'.json')){hits++;return raw;}return actual;};
 try{
  await expect(f.store.readDefaultDispatchPreparation(observation(f))).rejects.toThrow('TASK_SNAPSHOT_SYNC_SDK_UNCONFIRMED');
  expect(hits).toBe(1);expect(getters).toBe(0);await expect(f.store.closeAndDrain()).rejects.toThrow('TASK_SNAPSHOT_SYNC_CLOSE_UNCONFIRMED');
 }finally{io.readFileHook=undefined;await Promise.allSettled(physical);}
});

for(const field of ['payloadHash','bindingDigest','runId'])it('original Host '+field+' validation ignores late RegExp.exec semantics',async()=>{
 const f=fixture(),exec=RegExp.prototype.exec;f.setResolveHook(()=>{RegExp.prototype.exec=function(text:string){if(this.source==='^[a-f0-9]{64}$')return ['forged'] as RegExpExecArray;if(this.source==='[\\x00-\\x1f\\x7f]')return null;return Reflect.apply(exec,this,[text]);};});
 let value:unknown,error:unknown;try{value=await f.prepare({...f.data,[field]:field==='runId'?'bad\nrun':'not-hex'});}catch(cause){error=cause;}finally{RegExp.prototype.exec=exec;}
 console.log(JSON.stringify({test:'original-host-format-field',field,prepared:value!==undefined,builds:f.builds,rootCreated:existsSync(f.path)}));expect(error).toBeTruthy();expect(value).toBeUndefined();expect(f.builds).toBe(0);expect(existsSync(f.path)).toBe(false);
});
