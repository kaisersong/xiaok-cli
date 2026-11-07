// @vitest-environment node
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

const facts=vi.hoisted(()=>({events:[] as string[],issuer:{} as object,session:{} as object,store:{} as object,connectFault:false,rootFault:false,closeFault:false,connectOverride:undefined as {value:unknown}|undefined,onConnect:undefined as (()=>void)|undefined,connectError:undefined as unknown,rootError:undefined as unknown}));
vi.mock('node:module',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:module')>();
 return {...actual,createRequire:(url:string|URL)=>{
  const original=actual.createRequire(url);
  return (name:string)=>name.endsWith('/main_bootstrap.node')?{
   createOriginalMainIssuer(){facts.events.push('birth');return facts.issuer;},
   assertOriginalMainIssuerCurrent(){facts.events.push('current');},
   revokeOriginalMainIssuer(){facts.events.push('revoke');},
   connectOriginalMainInstallation(value:object){expect(value).toBe(facts.issuer);facts.events.push('connect');facts.onConnect?.();if(facts.connectFault)throw facts.connectError;return facts.connectOverride?facts.connectOverride.value:value;},
   closeOriginalMainInstallation(value:object){expect(value).toBe(facts.issuer);facts.events.push('installation-close');},
  }:original(name);
 }};
});
vi.mock('../../electron/harness-protected-budget-worker.js',()=>({
 prepareOriginalProtectedAdmissionDatabase(value:object){expect(value).toBe(facts.issuer);facts.events.push('admission-prepare');return Object.freeze({closeOwned(){facts.events.push('admission-close');}});},
 prepareOriginalProtectedBudgetWorker(){throw Error('unexpected budget Worker in lifecycle-only fixture');},
}));
vi.mock('../../electron/desktop-multi-agent-store.js',()=>({readOriginalDshAdmissionPort(store:object){if(store!==facts.store)throw Error('foreign store');return {};}}));
vi.mock('../../../src/runtime/verification/original-main-native-loader.js',()=>({loadOriginalMainResourceAuthority(){facts.events.push('load-fixed-root');return {
 openOriginalInstalledMainIssuer(value:object){expect(value).toBe(facts.issuer);facts.events.push('root-open');if(facts.rootFault)throw facts.rootError;return facts.session;},
 bootstrapOriginalMainPool(value:object){expect(value).toBe(facts.session);facts.events.push('core-bootstrap');return 'fresh';},
 readOriginalMainPoolBootstrap(value:object){expect(value).toBe(facts.session);facts.events.push('read-bootstrap');return Object.freeze({kind:'original_main_pool_bootstrap_v1',bootstrap:'fresh',profile:'ordinary_runtime_root_resource_reservation_writer_v8_protected_io',schemaVersion:4,semanticDigest:'a'.repeat(64),businessSealed:false});},
 sealOriginalMainRootBusiness(value:object){expect(value).toBe(facts.session);facts.events.push('business-seal');},
 close(value:object){expect(value).toBe(facts.session);facts.events.push('root-close');if(facts.closeFault)throw Error('actual busy');},
};}}));
let api:Record<string,any>;
beforeEach(async()=>{
 vi.resetModules();facts.events.length=0;facts.issuer={};facts.session={};facts.store={};facts.connectFault=false;facts.rootFault=false;facts.closeFault=false;facts.connectOverride=undefined;facts.onConnect=undefined;
 facts.connectError=undefined;facts.rootError=undefined;
 const actual=process;
 vi.stubGlobal('process',{...actual,platform:'darwin',versions:{...actual.versions,electron:'39.8.10',modules:'140'}});
 api=await import('../../electron/main-dsh-bootstrap-authority.js');
});
afterEach(()=>{vi.unstubAllGlobals();});
function setup(){
 expect(api.prepareOriginalMainDshInstalledRootPool).toBeTypeOf('function');
 expect(api.openOriginalMainDshInstalledRootPool).toBeTypeOf('function');
 expect(api.closeOriginalMainDshInstalledRootPool).toBeTypeOf('function');
 const realm=api.createMainDshBootstrapAuthority();realm.bindStore(facts.store);
 const lease=api.prepareOriginalMainDshInstalledRootPool(realm,facts.store);
 return {realm,lease};
}
it('production TS lease connects the same issuer once and closes actual Root before infrastructure',async()=>{
 const {lease}=setup();expect(facts.events).not.toContain('connect');
 const opening=api.openOriginalMainDshInstalledRootPool(lease);
 expect(api.openOriginalMainDshInstalledRootPool(lease)).toBe(opening);
 expect(await opening).toBe(facts.session);
 const closing=api.closeOriginalMainDshInstalledRootPool(lease);
 expect(api.closeOriginalMainDshInstalledRootPool(lease)).toBe(closing);await closing;
 expect(facts.events.filter(x=>x==='connect')).toHaveLength(1);
 expect(facts.events.filter(x=>x==='root-open')).toHaveLength(1);
 expect(facts.events.indexOf('root-close')).toBeLessThan(facts.events.indexOf('installation-close'));
 await expect(api.openOriginalMainDshInstalledRootPool(lease)).rejects.toBeDefined();
});
it('unknown realm, Store and lease refuse before hostile properties and Native calls',async()=>{
 setup();let hits=0;const foreign=new Proxy({},{get(){hits++;throw Error('trap');},ownKeys(){hits++;throw Error('trap');},getOwnPropertyDescriptor(){hits++;throw Error('trap');}});
 const before=facts.events.length;
 expect(()=>api.prepareOriginalMainDshInstalledRootPool(foreign,foreign)).toThrow();
 expect(()=>api.prepareOriginalMainDshInstalledRootPool({},facts.store)).toThrow();
 expect(()=>api.prepareOriginalMainDshInstalledRootPool(api.createMainDshBootstrapAuthority(),foreign)).toThrow();
 await expect(api.openOriginalMainDshInstalledRootPool(foreign)).rejects.toBeDefined();
 await expect(api.closeOriginalMainDshInstalledRootPool(foreign)).rejects.toBeDefined();
 expect(hits).toBe(0);expect(facts.events.length).toBe(before);
});
it('thrown undefined from connect is present, sticky and never opens a different Root',async()=>{
 const {lease}=setup();facts.connectFault=true;
 const opening=api.openOriginalMainDshInstalledRootPool(lease);
 await expect(opening).rejects.toBeUndefined();
 expect(api.openOriginalMainDshInstalledRootPool(lease)).toBe(opening);
 await api.closeOriginalMainDshInstalledRootPool(lease).catch(()=>{});
 expect(facts.events.filter(x=>x==='connect')).toHaveLength(1);
 expect(facts.events).not.toContain('root-open');expect(facts.events).toContain('installation-close');
});
it('Root failure preserves original first value and retains the independent close path',async()=>{
 const {lease}=setup();facts.rootFault=true;const first=Object.freeze({failure:'root-open'});facts.rootError=first;
 await expect(api.openOriginalMainDshInstalledRootPool(lease)).rejects.toBe(first);
 await api.closeOriginalMainDshInstalledRootPool(lease).catch(()=>{});
 expect(facts.events).toContain('installation-close');expect(facts.events).not.toContain('root-close');
});
it('Native Root BUSY refuses infrastructure close and cannot retry with a new lease',async()=>{
 const {realm,lease}=setup();await api.openOriginalMainDshInstalledRootPool(lease);facts.closeFault=true;
 await expect(api.closeOriginalMainDshInstalledRootPool(lease)).rejects.toThrow('actual busy');
 expect(facts.events).not.toContain('installation-close');
 expect(api.prepareOriginalMainDshInstalledRootPool(realm,facts.store)).toBe(lease);
 await expect(api.openOriginalMainDshInstalledRootPool(lease)).rejects.toBeDefined();
});
it('seal leaves the original negative consumer usable and never closes sockets early',async()=>{
 const {realm,lease}=setup();await api.openOriginalMainDshInstalledRootPool(lease);realm.seal();
 expect(facts.events).not.toContain('installation-close');await api.closeOriginalMainDshInstalledRootPool(lease);
 expect(facts.events).toContain('root-close');expect(facts.events).toContain('installation-close');
});
it('close before open has no Native birth and forbids a later positive open',async()=>{
 const {lease}=setup();await api.closeOriginalMainDshInstalledRootPool(lease);
 expect(facts.events).not.toContain('connect');expect(facts.events).not.toContain('installation-close');
 await expect(api.openOriginalMainDshInstalledRootPool(lease)).rejects.toBeDefined();
});
it.each(['undefined','null','proxy'] as const)('rejects a nonidentical %s connection result without Root open',async kind=>{
 const {lease}=setup();let hits=0;
 facts.connectOverride={value:kind==='undefined'?undefined:kind==='null'?null:new Proxy({},{get(){hits++;throw Error('trap');},ownKeys(){hits++;throw Error('trap');}})};
 await expect(api.openOriginalMainDshInstalledRootPool(lease)).rejects.toBeDefined();
 await api.closeOriginalMainDshInstalledRootPool(lease).catch(()=>{});
 expect(facts.events).not.toContain('root-open');expect(facts.events).toContain('installation-close');expect(hits).toBe(0);
});
it('synchronous connect reentry publishes close before any later Root effect',async()=>{
 const {lease}=setup();let negative:Promise<void>|undefined;
 facts.onConnect=()=>{negative=api.closeOriginalMainDshInstalledRootPool(lease);};
 await expect(api.openOriginalMainDshInstalledRootPool(lease)).rejects.toBeDefined();await negative;
 expect(facts.events.filter(x=>x==='connect')).toHaveLength(1);
 expect(facts.events).not.toContain('root-open');expect(facts.events).toContain('installation-close');
});
function coreSetup(){
 expect(api.prepareOriginalMainDshCoreInfrastructure).toBeTypeOf('function');
 expect(api.startOriginalMainDshCoreInfrastructure).toBeTypeOf('function');
 expect(api.closeOriginalMainDshCoreInfrastructure).toBeTypeOf('function');
 expect(api.returnOriginalMainDshInstalledRootPool).toBeTypeOf('function');
 const realm=api.createMainDshBootstrapAuthority();
 const core=api.prepareOriginalMainDshCoreInfrastructure(realm);return {realm,core};
}
it('original Core bootstraps before Store binding, and Owner borrows the same session without another bootstrap',async()=>{
 const {realm,core}=coreSetup();expect(facts.events).not.toContain('connect');
 const starting=api.startOriginalMainDshCoreInfrastructure(core);expect(api.startOriginalMainDshCoreInfrastructure(core)).toBe(starting);await starting;
 expect(facts.events.filter(x=>x==='core-bootstrap')).toHaveLength(1);expect(facts.events.indexOf('core-bootstrap')).toBeLessThan(facts.events.indexOf('admission-prepare'));
 realm.bindStore(facts.store);
 const lease=api.prepareOriginalMainDshInstalledRootPool(realm,facts.store);expect(lease).toBe(core);
 expect(await api.openOriginalMainDshInstalledRootPool(lease)).toBe(facts.session);
 await api.returnOriginalMainDshInstalledRootPool(lease);
 expect(facts.events).toContain('business-seal');expect(facts.events).not.toContain('root-close');expect(facts.events).not.toContain('installation-close');
 await api.closeOriginalMainDshCoreInfrastructure(core);
 expect(facts.events.filter(x=>x==='root-close')).toHaveLength(1);expect(facts.events.filter(x=>x==='core-bootstrap')).toHaveLength(1);
 expect(facts.events.indexOf('business-seal')).toBeLessThan(facts.events.indexOf('root-close'));
});
it('Core close waits its actual borrowed Owner return before any Root close',async()=>{
 const {realm,core}=coreSetup();await api.startOriginalMainDshCoreInfrastructure(core);realm.bindStore(facts.store);
 const lease=api.prepareOriginalMainDshInstalledRootPool(realm,facts.store);await api.openOriginalMainDshInstalledRootPool(lease);
 let closed=false;const closing=api.closeOriginalMainDshCoreInfrastructure(core).then(()=>{closed=true;});
 await new Promise(resolve=>setTimeout(resolve,10));expect(closed).toBe(false);expect(facts.events).not.toContain('root-close');
 await api.returnOriginalMainDshInstalledRootPool(lease);await closing;expect(closed).toBe(true);
});
it('startup failure before any Store still has the original registered Core negative consumer',async()=>{
 const {core}=coreSetup();facts.connectFault=true;
 await expect(api.startOriginalMainDshCoreInfrastructure(core)).rejects.toBeUndefined();
 await api.closeOriginalMainDshCoreInfrastructure(core).catch(()=>{});
 expect(facts.events).toContain('installation-close');expect(facts.events).not.toContain('root-open');
});
it('a foreign Core candidate is rejected without reflecting its properties',async()=>{
 coreSetup();let hits=0;const fake=new Proxy({},{get(){hits++;throw Error('trap');},ownKeys(){hits++;throw Error('trap');}});
 expect(()=>api.prepareOriginalMainDshCoreInfrastructure(fake)).toThrow();
 await expect(api.startOriginalMainDshCoreInfrastructure(fake)).rejects.toBeDefined();
 await expect(api.closeOriginalMainDshCoreInfrastructure(fake)).rejects.toBeDefined();expect(hits).toBe(0);
});
