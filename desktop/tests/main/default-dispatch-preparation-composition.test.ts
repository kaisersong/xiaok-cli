// Dormant composition identity only: deliberately no Native availability or Work.
import {afterEach,expect,it,vi} from 'vitest';
// The observation issuer imports the original controller's membership reader.
// Passive tests still perform no actual Native SDK call.
vi.mock('electron',()=>({app:{isReady(){throw Error('passive Native call');}},BrowserWindow:{getAllWindows(){throw Error('passive Native call');},fromId(){throw Error('passive Native call');},fromWebContents(){throw Error('passive Native call');}},webContents:{fromId(){throw Error('passive Native call');}}}));
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as capsules from '../../electron/default-dispatch-preparation-composition-bootstrap.js';
import * as launchers from '../../electron/activity-owner-writer-launcher.js';
import * as owners from '../../electron/default-dispatch-preparation-owner.js';
import * as native from '../../electron/default-dispatch-preparation-native-source.js';
import * as service from '../../electron/kswarm-service.js';
import * as hosts from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
it('reads passive original composition identity without minting a Native birth or inspecting candidate properties',async()=>{
 const read=(native as any).readOriginalPreparationNativeComposition;expect(read).toBeTypeOf('function');let reads=0;
 const source=native.createDefaultDispatchPreparationNativeSource({window:Object.defineProperty({},'webContents',{get(){reads++;throw Error('Native lookup must not run');}}) as any,scope,isTrustedUrl(){reads++;throw Error('URL policy must not run');}});
 cleanups.push(()=>source.drain());const view=read(source);expect(view.scope).toEqual(scope);expect(Object.isFrozen(view)).toBe(true);expect(Object.getPrototypeOf(view)).toBe(null);view.assertLocal();expect(()=>native.readDefaultDispatchPreparationNativeBirth(source)).toThrow();
 const fake=new Proxy({},{get(){reads++;throw Error('candidate get');},getOwnPropertyDescriptor(){reads++;throw Error('candidate descriptor');}});expect(()=>read(fake)).toThrow();expect(()=>read({...source})).toThrow();expect(reads).toBe(0);
 source.seal();expect(()=>view.assertLocal()).toThrow();expect(()=>read(source)).toThrow();
});

it('binds a dormant original service and the same Population Host while every Work proof remains denied',async()=>{
 let nativeReads=0;const window=Object.defineProperty({},'webContents',{get(){nativeReads++;throw Error('dormant Native lookup');}});
 const source=native.createDefaultDispatchPreparationNativeSource({window:window as any,scope,isTrustedUrl(){nativeReads++;throw Error('dormant URL policy');}}),owner=owners.createDefaultDispatchPreparationOwner(source),root=mkdtempSync(join(tmpdir(),'dsh-preparation-composition-')),path=join(root,'tasks'),store=new FileTaskSnapshotStore(path),population=hosts.createTaskSourceWriterPopulation(store);
 const manager=service.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:owner.transportSource,ownedPreparationAdmission:owner.transportAdmission});
 cleanups.push(async()=>{await population.close();await service.sealAndDrainKSwarmServiceInstance(manager);await owner.drain();rmSync(root,{recursive:true,force:true,maxRetries:5});});
 expect(()=>owners.createDefaultDispatchPreparationOwner(source)).toThrow();expect(()=>owners.readDefaultDispatchPreparationComposition(owner,manager)).toThrow();owner.bindService(manager);
 const host=population.createHost({materialRegistry:{} as any,defaultDispatchPreparationSource:owner.hostSource,runner:async()=>{throw Error('prepare-only runner denied');}});owner.bindOriginalHost(population,host);
 const view=owners.readDefaultDispatchPreparationComposition(owner,manager),binding=hosts.readOriginalTaskSourcePopulationPreparationBinding(population,host,owner.hostSource);
 expect(view.hostIdentity).toBe(binding.hostIdentity);expect(view.storeIdentity).toBe(binding.storeIdentity);expect(view.populationIdentity).toBe(binding.identity);expect(view.scope).toEqual(scope);view.assertLocal();
 expect(()=>owner.bindService(manager)).toThrow();expect(()=>owner.bindOriginalHost(population,host)).toThrow();
 expect(()=>owner.transportSource.resolveWork({},{} as any)).toThrow('DEFAULT_DISPATCH_PREPARATION_WORK_AUTHORIZATION_UNAVAILABLE');expect(()=>owner.transportAdmission({},{} as any)).toThrow('DEFAULT_DISPATCH_PREPARATION_WORK_AUTHORIZATION_UNAVAILABLE');expect(()=>owner.hostSource.resolve({},'prepare')).toThrow('DEFAULT_DISPATCH_PREPARATION_WORK_AUTHORIZATION_UNAVAILABLE');
 expect(()=>native.readDefaultDispatchPreparationNativeBirth(source)).toThrow();expect(nativeReads).toBe(0);expect(existsSync(path)).toBe(false);
 population.stopAccepting();expect(()=>view.assertLocal()).toThrow();
});
it('refuses copied owners and foreign Population or Host bindings before candidate getters',async()=>{
 const source=native.createDefaultDispatchPreparationNativeSource({window:{} as any,scope,isTrustedUrl:()=>false}),owner=owners.createDefaultDispatchPreparationOwner(source),root=mkdtempSync(join(tmpdir(),'dsh-preparation-foreign-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=hosts.createTaskSourceWriterPopulation(store),foreign=hosts.createTaskSourceWriterPopulation(store),manager=service.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:owner.transportSource,ownedPreparationAdmission:owner.transportAdmission});
 cleanups.push(async()=>{await population.close();await foreign.close();await service.sealAndDrainKSwarmServiceInstance(manager);await owner.drain();rmSync(root,{recursive:true,force:true,maxRetries:5});});owner.bindService(manager);
 const host=population.createHost({materialRegistry:{} as any,defaultDispatchPreparationSource:owner.hostSource,runner:async()=>{throw Error('denied');}});expect(()=>owner.bindOriginalHost(foreign,host)).toThrow();owner.bindOriginalHost(population,host);
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('candidate get');},getOwnPropertyDescriptor(){getters++;throw Error('candidate descriptor');}});
 expect(()=>owners.readDefaultDispatchPreparationComposition(fake,manager)).toThrow();expect(()=>owners.readDefaultDispatchPreparationComposition({...owner},manager)).toThrow();expect(()=>owners.readDefaultDispatchPreparationComposition(owner,fake as any)).toThrow();expect(getters).toBe(0);
 await population.retireHost(host);expect(()=>owners.readDefaultDispatchPreparationComposition(owner,manager)).toThrow();
});

it('reads only original owner ports after its exact service bind and before any Host exists',async()=>{
 const read=(owners as any).readDefaultDispatchPreparationOwnerPorts;expect(read).toBeTypeOf('function');
 const source=native.createDefaultDispatchPreparationNativeSource({window:{} as any,scope,isTrustedUrl:()=>false}),owner=owners.createDefaultDispatchPreparationOwner(source),manager=service.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:owner.transportSource,ownedPreparationAdmission:owner.transportAdmission});
 cleanups.push(async()=>{await service.sealAndDrainKSwarmServiceInstance(manager);await owner.drain();});expect(()=>read(owner,manager)).toThrow();owner.bindService(manager);
 const ports=read(owner,manager);expect(ports.hostSource).toBe(owner.hostSource);expect(ports.transportSource).toBe(owner.transportSource);expect(ports.transportAdmission).toBe(owner.transportAdmission);expect(Object.getPrototypeOf(ports)).toBe(null);expect(Object.isFrozen(ports)).toBe(true);ports.assertLocal();
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('unknown owner getter');},getOwnPropertyDescriptor(){getters++;throw Error('unknown owner descriptor');}});expect(()=>read(fake,manager)).toThrow();expect(()=>read(owner,fake)).toThrow();expect(getters).toBe(0);
 await service.sealAndDrainKSwarmServiceInstance(manager);expect(()=>ports.assertLocal()).toThrow();expect(()=>read(owner,manager)).toThrow();
});

it('mints one opaque composition capsule after real Host binding and refuses forged launch-state consumers',async()=>{
 const source=native.createDefaultDispatchPreparationNativeSource({window:{} as any,scope,isTrustedUrl:()=>false}),owner=owners.createDefaultDispatchPreparationOwner(source),root=mkdtempSync(join(tmpdir(),'dsh-composition-capsule-')),store=new FileTaskSnapshotStore(join(root,'tasks')),population=hosts.createTaskSourceWriterPopulation(store),manager=service.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:owner.transportSource,ownedPreparationAdmission:owner.transportAdmission});
 cleanups.push(async()=>{await population.close();await service.sealAndDrainKSwarmServiceInstance(manager);await owner.drain();rmSync(root,{recursive:true,force:true,maxRetries:5});});
 owner.bindService(manager);expect(()=>capsules.createDesktopPreparationCompositionCapsule(owner,manager)).toThrow();
 const host=population.createHost({materialRegistry:{} as any,defaultDispatchPreparationSource:owner.hostSource,runner:async()=>{throw Error('denied');}});owner.bindOriginalHost(population,host);
 const capsule=capsules.createDesktopPreparationCompositionCapsule(owner,manager);expect(Reflect.ownKeys(capsule)).toEqual([]);expect(Object.isFrozen(capsule)).toBe(true);expect(Object.getPrototypeOf(capsule)).toBe(null);expect(()=>capsules.createDesktopPreparationCompositionCapsule(owner,manager)).toThrow();
 expect((launchers as any).readOriginalDesktopPreparationLaunchState).toBeTypeOf('function');
 let getters=0;const fake=new Proxy({},{get(){getters++;throw Error('forged state');},getOwnPropertyDescriptor(){getters++;throw Error('forged state descriptor');}});
 expect(()=>capsules.consumeDesktopPreparationCompositionCapsule(capsule,fake)).toThrow();expect(()=>capsules.consumeDesktopPreparationCompositionCapsule({...capsule},fake)).toThrow();expect(()=>capsules.consumeDesktopPreparationCompositionCapsule({},fake)).toThrow();expect(getters).toBe(0);
 expect(()=>owner.transportSource.resolveWork(capsule,{} as any)).toThrow('DEFAULT_DISPATCH_PREPARATION_WORK_AUTHORIZATION_UNAVAILABLE');
});
