// @vitest-environment node
// Passive original-object identity and source-present constructor binding.
// No NativeMain/authenticated B/Host IO qualification is asserted here.
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as hosts from '../../../src/runtime/task-host/task-runtime-host.js';
import * as stores from '../../../src/runtime/task-host/snapshot-store.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'dsh-host-binding-'));roots.push(root);const path=join(root,'tasks'),store=new stores.FileTaskSnapshotStore(path);let sources=0;
 const source={resolve(){sources++;throw Error('no preparation proof');}};
 const options={snapshotStore:store,defaultDispatchPreparationSource:source,materialRegistry:{} as any,runner:async function*(){throw Error('runner must not start');},now:()=>1};
 return{root,path,store,source,options,get sources(){return sources;}};
}
it('a source-present Host refuses a snapshotStore accessor before either getter value can become its issuer or IO store',()=>{
 const f=fixture(),other=new stores.FileTaskSnapshotStore(join(f.root,'other'));let reads=0;
 const options=Object.defineProperty({...f.options},'snapshotStore',{enumerable:true,get(){reads++;return reads===1?f.store:other;}});
 expect(()=>new hosts.InProcessTaskRuntimeHost(options)).toThrow('DEFAULT_DISPATCH_PREPARATION_STORE_REQUIRED');expect(reads).toBe(0);expect(f.sources).toBe(0);expect(existsSync(f.path)).toBe(false);
});
it('passive Host and Store readers prove exact original objects without Source or filesystem calls',()=>{
 const f=fixture(),host=new hosts.InProcessTaskRuntimeHost(f.options);
 expect(typeof hosts.readOriginalTaskHostPreparationBinding).toBe('function');expect(typeof stores.readOriginalPreparationStoreBinding).toBe('function');
 const store=stores.readOriginalPreparationStoreBinding(f.store),binding=hosts.readOriginalTaskHostPreparationBinding(host,f.source);
 expect(binding.store).toBe(f.store);expect(binding.storeIdentity).toBe(store.identity);expect(Object.isFrozen(binding)).toBe(true);expect(Object.getPrototypeOf(binding)).toBe(null);
 expect(hosts.readOriginalTaskHostPreparationBinding(host,f.source)).toBe(binding);expect(f.sources).toBe(0);expect(existsSync(f.path)).toBe(false);
});
it('unknown copied proxy and wrong-source identities are refused before candidate getters',()=>{
 const f=fixture(),host=new hosts.InProcessTaskRuntimeHost(f.options);let reads=0;
 const fake=Object.defineProperty({},'options',{get(){reads++;throw Error('forbidden');}}),proxy=new Proxy(host,{get(){reads++;throw Error('forbidden');},getOwnPropertyDescriptor(){reads++;throw Error('forbidden');}});
 for(const candidate of [fake,proxy,{...host},Object.create(hosts.InProcessTaskRuntimeHost.prototype)])expect(()=>hosts.readOriginalTaskHostPreparationBinding(candidate,f.source)).toThrow();
 expect(()=>hosts.readOriginalTaskHostPreparationBinding(host,{resolve(){throw Error('wrong source');}})).toThrow();
 for(const candidate of [{...f.store},new Proxy(f.store,{get(){reads++;throw Error('forbidden');}}),Object.create(stores.FileTaskSnapshotStore.prototype)])expect(()=>stores.readOriginalPreparationStoreBinding(candidate)).toThrow();expect(reads).toBe(0);
});
it('source-present Host keeps its exact options and store identity while ordinary legacy Host options remain compatible',()=>{
 const f=fixture(),host=new hosts.InProcessTaskRuntimeHost(f.options),isolated=(host as any).options,other=new stores.FileTaskSnapshotStore(join(f.root,'other'));
 expect(Reflect.set(isolated,'snapshotStore',other)).toBe(false);expect(Reflect.set(host,'options',{...isolated,snapshotStore:other})).toBe(false);expect(hosts.readOriginalTaskHostPreparationBinding(host,f.source).store).toBe(f.store);
 const {defaultDispatchPreparationSource:_,...legacyOptions}=f.options,legacy=new hosts.InProcessTaskRuntimeHost(legacyOptions);expect(Reflect.set((legacy as any).options,'snapshotStore',other)).toBe(true);
 host.stopAccepting('fixture_done');expect(()=>hosts.readOriginalTaskHostPreparationBinding(host,f.source)).toThrow();expect(f.sources).toBe(0);
});
it('only source-present construction requires the original FileStore and refuses options proxies without invoking traps',()=>{
 const f=fixture();let reads=0;const fake=Object.defineProperty(Object.create(stores.FileTaskSnapshotStore.prototype),'prepareDefaultDispatchSnapshot',{get(){reads++;throw Error('forbidden');}});
 expect(()=>new hosts.InProcessTaskRuntimeHost({...f.options,snapshotStore:fake})).toThrow('DEFAULT_DISPATCH_PREPARATION_STORE_REQUIRED');
 const proxy=new Proxy(f.options,{get(){reads++;throw Error('forbidden');},getOwnPropertyDescriptor(){reads++;throw Error('forbidden');}});expect(()=>new hosts.InProcessTaskRuntimeHost(proxy)).toThrow('DEFAULT_DISPATCH_PREPARATION_SOURCE_REQUIRED');
 const {defaultDispatchPreparationSource:_,...legacy}=f.options;expect(()=>new hosts.InProcessTaskRuntimeHost({...legacy,snapshotStore:fake})).not.toThrow();expect(reads).toBe(0);expect(f.sources).toBe(0);
});

it('reads only actual preparation members of the exact original Population without Source or filesystem calls',async()=>{
 const read=(hosts as any).readOriginalTaskSourcePopulationPreparationBinding;expect(read).toBeTypeOf('function');
 const f=fixture(),population=hosts.createTaskSourceWriterPopulation(f.store),other=hosts.createTaskSourceWriterPopulation(f.store);
 const {snapshotStore:_,...options}=f.options,host=population.createHost(options),standalone=new hosts.InProcessTaskRuntimeHost(f.options);
 try{
  const view=read(population,host,f.source),binding=hosts.readOriginalTaskHostPreparationBinding(host,f.source);
  expect(view.store).toBe(f.store);expect(view.hostIdentity).toBe(binding.identity);expect(view.storeIdentity).toBe(binding.storeIdentity);expect(read(population,host,f.source)).toBe(view);
  expect(Object.isFrozen(view)).toBe(true);expect(Object.getPrototypeOf(view)).toBe(null);expect(Object.isFrozen(view.identity)).toBe(true);expect(Object.getPrototypeOf(view.identity)).toBe(null);
  expect(()=>read(other,host,f.source)).toThrow();expect(()=>read(population,standalone,f.source)).toThrow();expect(()=>read(population,host,{resolve(){throw Error('foreign');}})).toThrow();
  let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('candidate get');},getOwnPropertyDescriptor(){traps++;throw Error('candidate descriptor');}});
  expect(()=>read(fake,host,f.source)).toThrow();expect(()=>read({...population},host,f.source)).toThrow();expect(()=>read(population,fake,f.source)).toThrow();expect(traps).toBe(0);
  expect(f.sources).toBe(0);expect(existsSync(f.path)).toBe(false);
 }finally{await population.close();await other.close();await standalone.closeSourceWriterForMigration();}
});
it('withdraws actual Population membership at retirement start and ingress stop, preserving the original close owner',async()=>{
 const read=(hosts as any).readOriginalTaskSourcePopulationPreparationBinding;expect(read).toBeTypeOf('function');
 const f=fixture(),population=hosts.createTaskSourceWriterPopulation(f.store),{snapshotStore:_,...options}=f.options;
 const retiring=population.createHost(options),remaining=population.createHost(options);read(population,retiring,f.source);
 const retirement=population.retireHost(retiring);expect(()=>read(population,retiring,f.source)).toThrow();await retirement;expect(()=>read(population,retiring,f.source)).toThrow();
 read(population,remaining,f.source);population.stopAccepting();expect(()=>read(population,remaining,f.source)).toThrow();await population.close();expect(()=>read(population,remaining,f.source)).toThrow();expect(f.sources).toBe(0);
});
