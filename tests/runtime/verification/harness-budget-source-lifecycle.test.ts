import {afterAll,afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const faults=vi.hoisted(()=>({home:'',route:'ordinary',constructorFault:'',closeFault:'',raw:undefined as unknown,failSync:false,calls:0,closes:0,created:[] as import('node:worker_threads').Worker[],rawReturns:[] as Promise<number>[],held:undefined as Promise<void>|undefined,errorTail:undefined as Promise<void>|undefined,errorRaw:undefined as unknown,errorUnknown:false,errorGetterTraps:0}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:faults.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:faults.route})}));
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return {...actual,fsyncSync:(fd:number)=>{if(faults.failSync&&actual.fstatSync(fd).isDirectory())throw faults.raw;return actual.fsyncSync(fd);}};});
vi.mock('node:worker_threads',async load=>{const actual=await load<typeof import('node:worker_threads')>();class ObservedWorker extends actual.Worker {
 constructor(...args:ConstructorParameters<typeof actual.Worker>){faults.calls++;if(faults.constructorFault==='before')throw faults.raw;super(...args);faults.created.push(this);this.prependListener('error',raw=>{faults.errorRaw=raw;if(faults.errorUnknown)Object.defineProperty(raw,Symbol('unconfirmed-original-sdk-slot'),{get(){faults.errorGetterTraps++;throw Error('must not inspect original SDK getter');}});if(faults.errorTail)Object.defineProperty(raw,Symbol('genuine-worker-error-tail'),{value:faults.errorTail});});if(faults.constructorFault==='after')throw faults.raw;}
 terminate(){faults.closes++;if(faults.closeFault==='before')throw faults.raw;const raw=super.terminate();faults.rawReturns.push(raw);if(faults.held)Object.defineProperty(raw,Symbol('owned-held-sdk-tail'),{value:faults.held});if(faults.closeFault==='after')throw faults.raw;return raw;}
 }return {...actual,Worker:ObservedWorker};});
const actual=await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads'),rawTerminate=actual.Worker.prototype.terminate;
const root=realpathSync(mkdtempSync(join(tmpdir(),'budget-lifecycle-'))),oldConfig=process.env.XIAOK_CONFIG_DIR;let serial=0;
beforeEach(()=>{vi.resetModules();faults.home=join(root,'account-'+serial++);mkdirSync(faults.home,{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(faults.home,'.xiaok');faults.route='ordinary';faults.constructorFault='';faults.closeFault='';faults.raw=undefined;faults.failSync=false;faults.calls=0;faults.closes=0;faults.created=[];faults.rawReturns=[];faults.held=undefined;faults.errorTail=undefined;faults.errorRaw=undefined;faults.errorUnknown=false;faults.errorGetterTraps=0;});
afterEach(async()=>{for(const worker of faults.created)await Reflect.apply(rawTerminate,worker,[]);await Promise.allSettled(faults.rawReturns);});
afterAll(()=>{if(oldConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=oldConfig;rmSync(root,{recursive:true,force:true});});
async function load(){return import('../../../desktop/electron/harness-optimization-store.js');}
async function data(){const config=await import('../../../desktop/electron/harness-optimization-config.js'),directory=join(faults.home,'db');mkdirSync(directory);const stat=statSync(directory,{bigint:true});return {dbPath:join(directory,'harness-optimization.sqlite'),root:directory,identity:`${stat.dev}:${stat.ino}`,ownerId:'original-owner',initOperationId:'original-init',initializing:true,now:1000,defaultConfig:structuredClone(config.DEFAULT_HARNESS_OPTIMIZATION_CONFIG),profileId:'original-profile',workspaceId:'original-workspace'};}
function thrown(work:()=>unknown){try{work();throw Error('expected failure');}catch(raw){return raw;}}
it.each(['before','after'])('keeps constructor-entered bare undefined at %s unknown without a replacement writer',async phase=>{
 const api=await load(),input=await data();faults.constructorFault=phase;
 expect(thrown(()=>new api.HarnessOptimizationStore(input,()=>{}))).toBeUndefined();expect(faults.calls).toBe(1);expect(faults.created).toHaveLength(phase==='after'?1:0);
 faults.constructorFault='';expect(()=>new api.HarnessOptimizationStore(input,()=>{})).toThrow('budget_source_initialization_unknown');expect(faults.calls).toBe(1);
});
it('runs the fixed negative consumer after a positive observer rejects bare undefined and notifies the original Service',async()=>{
 const api=await load(),input=await data();faults.failSync=true;let notices=0;const store=new api.HarnessOptimizationStore(input,()=>{notices++;});let rejected=false;
 const result=await store.ready.then(()=>{throw Error('expected failure');},raw=>{rejected=true;return raw;});expect(rejected).toBe(true);expect(result).toBeUndefined();expect(notices).toBe(1);expect(faults.closes).toBe(1);await expect(store.call('read')).rejects.toThrow('optimization_store_unavailable');expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).not.toThrow();
});
it('waits the original observer Error symbol tail after actual Worker exit and preserves that first cause',async()=>{
 const api=await load(),input=await data();let release!:()=>void;const held=new Promise<void>(r=>{release=r;}),sentinel=new Error('original-observer');Object.defineProperty(sentinel,Symbol('owned-tail'),{value:held});faults.raw=sentinel;faults.failSync=true;let notices=0;
 const store=new api.HarnessOptimizationStore(input,()=>{notices++;});let settled=false;const operation=store.ready.then(()=>{settled=true;return null;},raw=>{settled=true;return raw;});
 try{await vi.waitFor(()=>expect(faults.closes).toBe(1));expect(notices).toBe(1);expect(settled).toBe(false);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');}finally{release();}
 expect(await operation).toBe(sentinel);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).not.toThrow();
});
it.each(['before','after'])('retains terminate SDK %s bare undefined as unknown and never retries a new close/birth',async phase=>{
 const api=await load(),input=await data(),store=new api.HarnessOptimizationStore(input,()=>{});await store.ready;faults.closeFault=phase;const operation=store.dispose();expect(store.dispose()).toBe(operation);let rejected=false;
 expect(await operation.then(()=>{throw Error('expected failure');},raw=>{rejected=true;return raw;})).toBeUndefined();expect(rejected).toBe(true);expect(faults.closes).toBe(1);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');faults.closeFault='';expect(()=>new api.HarnessOptimizationStore(input,()=>{})).toThrow('budget_source_initialization_unknown');expect(faults.calls).toBe(1);
});
it('joins a genuine successful terminate raw Promise own-symbol tail before known writer fate',async()=>{
 const api=await load(),input=await data(),store=new api.HarnessOptimizationStore(input,()=>{});await store.ready;let release!:()=>void;faults.held=new Promise<void>(r=>{release=r;});let settled=false;const operation=store.dispose();void operation.then(()=>{settled=true;});
 try{await vi.waitFor(()=>expect(faults.closes).toBe(1));expect(settled).toBe(false);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');}finally{release();}await operation;expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).not.toThrow();
});
it('attempts all physical joins when notification is unknown while the original observer tail is still held',async()=>{
 const api=await load(),input=await data();let release!:()=>void;const held=new Promise<void>(r=>{release=r;}),sentinel=new Error('observer-first');Object.defineProperty(sentinel,Symbol('owned-tail'),{value:held});faults.raw=sentinel;faults.failSync=true;
 const store=new api.HarnessOptimizationStore(input,()=>Promise.resolve('nonvoid') as unknown as void);let settled=false;const operation=store.ready.then(()=>{settled=true;return null;},raw=>{settled=true;return raw;});
 try{await vi.waitFor(()=>expect(faults.closes).toBe(1));expect(settled).toBe(false);}finally{release();}expect(await operation).toBe(sentinel);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');
});
it('does not consult a later public terminate replacement for the captured original negative consumer',async()=>{
 const api=await load(),input=await data(),store=new api.HarnessOptimizationStore(input,()=>{});await store.ready;const Worker=(await import('node:worker_threads')).Worker,original=Worker.prototype.terminate,trap=vi.fn(()=>{throw Error('public trap');});Worker.prototype.terminate=trap;
 try{await store.dispose();expect(trap).not.toHaveBeenCalled();expect(faults.closes).toBe(1);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).not.toThrow();}finally{Worker.prototype.terminate=original;}
});

it.each(['getter','proxy'])('preserves the actual observer %s failure without consulting caller code properties',async kind=>{
 const api=await load(),input=await data();let traps=0;const raw=kind==='getter'?Object.defineProperty(new Error('original-code-getter'),'code',{get(){traps++;throw Error('replacement');}}):new Proxy({},{get(){traps++;throw Error('replacement');},getOwnPropertyDescriptor(){traps++;throw Error('replacement');}});faults.raw=raw;faults.failSync=true;const store=new api.HarnessOptimizationStore(input,()=>{});const result=await store.ready.then(()=>{throw Error('expected failure');},value=>({raw:value}));expect(result.raw).toBe(raw);expect(traps).toBe(0);expect(faults.closes).toBe(1);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');
});

it.each(['protected','unavailable'])('fences the actual ordinary lifecycle before witness/DB IO when %s',async route=>{
 const {HarnessOptimizationLifecycle}=await import('../../../desktop/electron/harness-optimization-lifecycle.js'),directory=join(faults.home,'never-created');faults.route=route;
 const lifecycle=new HarnessOptimizationLifecycle({root:directory,identity:'original',held:()=>true,release(){throw Error('unexpected release');}});await expect(lifecycle.prepare()).rejects.toThrow('ordinary_source_route');const {existsSync}=await import('node:fs');expect(existsSync(directory)).toBe(false);expect(faults.calls).toBe(0);
});
it('denies foreign data Proxy before any constructor or metadata trap',async()=>{
 const api=await load();let traps=0;const input=new Proxy({},{get(){traps++;throw Error('getter');},getOwnPropertyDescriptor(){traps++;throw Error('descriptor');}});expect(()=>new api.HarnessOptimizationStore(input,()=>{})).toThrow('budget_source_path');expect(faults.calls).toBe(0);expect(traps).toBe(0);
});

it('retains a genuine fixed-entry Worker error and its own tail until the original negative close joins it',async()=>{
 const api=await load(),input=await data();let release!:()=>void;faults.errorTail=new Promise<void>(r=>{release=r;});faults.errorUnknown=true;
 const store=new api.HarnessOptimizationStore({...input,originalProtectedBudgetCarrier:{}},()=>{});const failed=await store.ready.then(()=>{throw Error('expected actual Worker error');},raw=>({raw}));expect(failed.raw).toBe(faults.errorRaw);expect(failed.raw).toBeInstanceOf(Error);let settled=false;const operation=store.dispose();const closed=operation.then(()=>{settled=true;return {resolved:true,raw:undefined};},raw=>{settled=true;return {resolved:false,raw};});
 try{await vi.waitFor(()=>expect(faults.closes).toBe(1));expect(settled).toBe(false);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');}finally{release();}const result=await closed;expect(faults.errorGetterTraps).toBe(0);expect(result.resolved).toBe(false);expect(result.raw).toBe(failed.raw);expect(()=>api.readOriginalHarnessBudgetStoreWriterFate(store).assertTerminated()).toThrow('budget_source_physical_unconfirmed');
});
