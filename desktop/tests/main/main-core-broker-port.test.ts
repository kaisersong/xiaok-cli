// @vitest-environment node
// Instrumented fixed ABI only; no Native qualification.
import {expect,it} from 'vitest';
import {api,f,core,deferred,hostile} from '../support/core-broker-instrumented.js';
it('refuses foreign/copied/Proxy leases before any caller reflection or SDK',async()=>{
 const {lease}=await core();const h=hostile();for(const value of [{},Object.assign({},lease),h.value,new Proxy(lease,{get(){throw 0;}})])await expect(api.prepareOriginalMainDshBrokerChild(value)).rejects.toBeDefined();
 expect(h.hits()).toBe(0);expect(f.events).not.toContain('prepare-port');await api.closeOriginalMainDshCoreInfrastructure(lease);
});
it('publishes one sticky Promise before await and delivers the same exact port once',async()=>{
 const {lease}=await core();const opening=api.prepareOriginalMainDshBrokerChild(lease);expect(api.prepareOriginalMainDshBrokerChild(lease)).toBe(opening);
 expect(await opening).toBe(f.port);expect(api.prepareOriginalMainDshBrokerChild(lease)).toBe(opening);expect(f.events.filter(x=>x==='prepare-port')).toHaveLength(1);
 await api.closeOriginalMainDshCoreInfrastructure(lease);expect(f.events.filter(x=>x==='cancel')).toHaveLength(1);expect(f.events.indexOf('terminal')).toBeLessThan(f.events.indexOf('root-close'));expect(f.events.indexOf('root-close')).toBeLessThan(f.events.indexOf('installation-close'));
});
it('rejects before readiness and never mints a child from a legacy lease',async()=>{
 const realm=api.createMainDshBootstrapAuthority();const lease=api.prepareOriginalMainDshCoreInfrastructure(realm);
 await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toThrow('DSH_MAIN_CORE_NOT_STARTED');expect(f.events).not.toContain('prepare-port');await api.closeOriginalMainDshCoreInfrastructure(lease);
});
it('retains thrown undefined after SDK entry and never closes Root for an unreturned handle',async()=>{
 const {lease}=await core();f.prepareFailure={raw:undefined};const opening=api.prepareOriginalMainDshBrokerChild(lease);await expect(opening).rejects.toBeUndefined();expect(api.prepareOriginalMainDshBrokerChild(lease)).toBe(opening);
 await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeUndefined();expect(f.events.filter(x=>x==='prepare-port')).toHaveLength(1);expect(f.events).not.toContain('root-close');expect(f.events).not.toContain('installation-close');
});
it('close reentry during original prepare keeps the returned port and cancels before Root',async()=>{
 const {lease}=await core();let closing:Promise<void>|undefined;f.prepareHook=()=>{closing=api.closeOriginalMainDshCoreInfrastructure(lease);return f.port;};
 await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBeDefined();await closing;expect(f.events).toContain('cancel');expect(f.events.indexOf('terminal')).toBeLessThan(f.events.indexOf('root-close'));
});
it('seal reentry during port assertion denies delivery while fixed negative cancellation remains usable',async()=>{
 const {realm,lease}=await core();f.assertHook=()=>{f.assertHook=undefined;realm.seal();};await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBeDefined();
 await api.closeOriginalMainDshCoreInfrastructure(lease);expect(f.events).toContain('revoke');expect(f.events).toContain('cancel');expect(f.events).toContain('installation-close');
});
it('an entered Source is joined before Native terminal/Root even when close rejects a known business first cause',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const gate=deferred(),first=Object.freeze({reason:'business'});
 f.fate=Object.freeze({async waitPhysicalKnown(){f.events.push('source-wait');await gate.promise;f.terminal=true;},assertPhysicalKnown(){if(!f.terminal)throw Error('pending');}});
 f.sourceClose=()=>{throw first;};let settled=false;const closing=api.closeOriginalMainDshCoreInfrastructure(lease);const outcome=closing.then(()=>({ok:true}),raw=>({raw}));void outcome.then(()=>{settled=true;});
 for(let i=0;i<20;i++)await Promise.resolve();expect(settled).toBe(false);expect(f.events).not.toContain('root-close');gate.resolve();expect(await outcome).toEqual({raw:first});expect(f.events).not.toContain('cancel');expect(f.events.indexOf('source-wait')).toBeLessThan(f.events.indexOf('terminal'));expect(f.events).toContain('installation-close');
});
it('Source unknown blocks Root and combines secondary physical failure without washing undefined first cause',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const secondary=Object.freeze({physical:'unknown'});
 f.fate=Object.freeze({waitPhysicalKnown(){throw secondary;},assertPhysicalKnown(){throw secondary;}});f.sourceClose=()=>{throw undefined;};
 const raw=await api.closeOriginalMainDshCoreInfrastructure(lease).then(()=>null,raw=>raw);expect(raw).toBeInstanceOf(AggregateError);expect(raw.cause).toBeUndefined();expect(Object.hasOwn(raw,'cause')).toBe(true);expect(raw.errors).toHaveLength(4);expect(raw.errors[0]).toBeUndefined();expect(raw.errors[1]).toBe(secondary);expect(raw.errors[2].message).toBe('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');expect(raw.errors[3].message).toBe('native terminal pending');expect(f.events).toContain('terminal');expect(f.events).not.toContain('root-close');expect(f.events).not.toContain('cancel');
});
it('preserves known Source first cause when later Root BUSY is secondary and leaves installation held',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const first=Object.freeze({source:'first'}),secondary=Object.freeze({root:'busy'});
 f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});f.sourceClose=()=>{throw first;};f.rootFailure={raw:secondary};
 const raw=await api.closeOriginalMainDshCoreInfrastructure(lease).then(()=>null,raw=>raw);expect(raw).toBeInstanceOf(AggregateError);expect(raw.cause).toBe(first);expect(raw.errors).toEqual([first,secondary]);expect(f.events).not.toContain('installation-close');
});
it('hostile returned Proxy causes zero traps and keeps the entered attempt held',async()=>{
 const {lease}=await core();const h=hostile();f.prepareHook=()=>h.value;await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBeDefined();await api.closeOriginalMainDshCoreInfrastructure(lease).catch(()=>{});expect(h.hits()).toBe(0);expect(f.events).not.toContain('root-close');
});
it('Promise own symbol tail remains physically held until its original settlement',async()=>{
 const {lease}=await core();const gate=deferred();const raw=Promise.resolve(f.port);Object.defineProperty(raw,Symbol('held'),{value:gate.promise});f.prepareHook=()=>raw;
 await api.prepareOriginalMainDshBrokerChild(lease);const closing=api.closeOriginalMainDshCoreInfrastructure(lease);let done=false;void closing.then(()=>{done=true;},()=>{done=true;});for(let i=0;i<20;i++)await Promise.resolve();expect(done).toBe(false);expect(f.events).not.toContain('root-close');gate.resolve();await closing;expect(f.events).toContain('installation-close');
});

it('counterfeit accessors/frames cannot register their fake rows in original Main readers',async()=>{
 const {realm,lease}=await core();realm.bindStore(f.store);const fakeLease={},fakeRealm={},foreignPort={};
 const {createOriginalMainDshCoreAccessors}=await import('../../electron/main-dsh-core-accessors.js');
 const maps=new WeakMap<object,any>(),pools=new WeakMap<object,any>();pools.set(fakeLease,{prepareBrokerChild:()=>Promise.resolve(foreignPort)});maps.set(fakeRealm,{local(){},prepareInstalled:()=>fakeLease});
 const {createOriginalMainDshBrokerCleanup}=await import('../../electron/main-dsh-core-broker-cleanup.js');await expect(api.prepareOriginalMainDshBrokerChild(createOriginalMainDshBrokerCleanup())).rejects.toBeDefined();
 const counterfeit=createOriginalMainDshCoreAccessors(maps,pools);expect(await counterfeit.prepareOriginalMainDshBrokerChild(fakeLease)).toBe(foreignPort);
 await expect(api.prepareOriginalMainDshBrokerChild(fakeLease)).rejects.toBeDefined();expect(()=>api.prepareOriginalMainDshCoreInfrastructure(fakeRealm)).toThrow();
 const {createOriginalMainDshFrames}=await import('../../electron/main-dsh-bootstrap-data.js');const frames=createOriginalMainDshFrames(()=>{},()=>{},()=>true);const proof=frames.methods.openReadBasis({same:'data'});
 expect(()=>api.readOriginalDshAdmissionReferences(realm,proof,'read_basis')).toThrow();expect(()=>realm.resolve(proof,'read_basis')).toThrow();
 const genuine=realm.openReadBasis({same:'data'});expect(()=>frames.references(genuine,'read_basis')).toThrow();expect(realm.resolve(genuine,'read_basis').data).toEqual({same:'data'});
 await api.closeOriginalMainDshCoreInfrastructure(lease);
});
it('an Error symbol Promise tail is retained and a failed entered prepare never becomes a fresh attempt',async()=>{
 const {lease}=await core();const gate=deferred(),first=Error('actual SDK first');Object.defineProperty(first,Symbol('tail'),{value:gate.promise});f.prepareFailure={raw:first};
 const opening=api.prepareOriginalMainDshBrokerChild(lease);await expect(opening).rejects.toBe(first);const closing=api.closeOriginalMainDshCoreInfrastructure(lease);await expect(closing).rejects.toBe(first);gate.resolve();await Promise.resolve();
 expect(api.closeOriginalMainDshCoreInfrastructure(lease)).toBe(closing);expect(f.events.filter(x=>x==='prepare-port')).toHaveLength(1);expect(f.events).not.toContain('root-close');
});

it('does not execute a Proxy nested in returned port metadata before Native membership validation',async()=>{
 const {lease}=await core();const h=hostile();f.port=Object.freeze(Object.assign(Object.create(null),{cancel(){f.terminal=true;},[Symbol('raw-tail')]:h.value}));
 await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBeDefined();await api.closeOriginalMainDshCoreInfrastructure(lease).catch(()=>{});expect(h.hits()).toBe(0);expect(f.events).not.toContain('root-close');
});

it('captures original Native function identities before issuer birth and never adopts later public replacements',async()=>{
 const {lease}=await core();let substituted=0;f.exported!.prepareOriginalBrokerChild=()=>{substituted++;return Object.freeze(Object.assign(Object.create(null),{cancel(){}}));};f.exported!.assertOriginalBrokerChildPort=()=>{substituted++;};f.exported!.assertOriginalBrokerChildTerminal=()=>{substituted++;};
 expect(await api.prepareOriginalMainDshBrokerChild(lease)).toBe(f.port);await api.closeOriginalMainDshCoreInfrastructure(lease);expect(substituted).toBe(0);expect(f.events).toContain('terminal');expect(f.events).toContain('root-close');
});

it('joins a current-check Error symbol tail even when child prepare has not entered',async()=>{
 const {lease}=await core();const gate=deferred(),first=Error('current failed before child SDK');Object.defineProperty(first,Symbol('held'),{value:gate.promise});f.currentFailure={raw:first};
 await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBe(first);expect(f.events).not.toContain('prepare-port');const closing=api.closeOriginalMainDshCoreInfrastructure(lease);let done=false;void closing.then(()=>{done=true;},()=>{done=true;});
 for(let i=0;i<20;i++)await Promise.resolve();expect(done).toBe(false);expect(f.events).not.toContain('root-close');gate.resolve();await closing;expect(f.events).toContain('installation-close');
});

it('drains the exact bound Service before Source cleanup and Core physical closure',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const gate=deferred();f.serviceClose=async()=>{f.events.push('business-drain');await gate.promise;};f.serviceFate=Object.freeze({waitPhysicalKnown(){},assertPhysicalKnown(){}});f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});
 const closing=api.closeOriginalMainDshCoreInfrastructure(lease);for(let i=0;i<20;i++)await Promise.resolve();expect(f.events).toContain('business-drain');expect(f.events).not.toContain('source-close');expect(f.events).not.toContain('root-close');gate.resolve();await closing;
 expect(f.events.indexOf('service-close')).toBeLessThan(f.events.indexOf('source-close'));expect(f.events).not.toContain('cancel');expect(f.events).toContain('installation-close');
});

it('preserves undefined Service first cause and distinct Source secondary after complete physical joins',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const second=Object.freeze({source:'second'});f.serviceClose=()=>{throw undefined;};f.serviceFate=Object.freeze({waitPhysicalKnown(){},assertPhysicalKnown(){}});f.sourceClose=()=>{throw second;};f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});
 const raw=await api.closeOriginalMainDshCoreInfrastructure(lease).then(()=>null,raw=>raw);expect(raw).toBeInstanceOf(AggregateError);expect(Object.hasOwn(raw,'cause')).toBe(true);expect(raw.cause).toBeUndefined();expect(raw.errors).toEqual([undefined,second]);expect(f.events).toContain('installation-close');
});
it('retains Service SDK Error symbol tails and deduplicates the same Source business first cause',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const gate=deferred(),first=Error('service and source first');Object.defineProperty(first,Symbol('held'),{value:gate.promise});f.serviceClose=()=>{throw first;};f.serviceFate=Object.freeze({waitPhysicalKnown(){},assertPhysicalKnown(){}});f.sourceClose=()=>{throw first;};f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});
 const closing=api.closeOriginalMainDshCoreInfrastructure(lease),outcome=closing.then(()=>({ok:true}),raw=>({raw}));for(let i=0;i<30;i++)await Promise.resolve();expect(f.events).not.toContain('root-close');gate.resolve();expect(await outcome).toEqual({raw:first});expect(f.events).toContain('installation-close');
});
it('unexpected Service close data attempts Source cleanup but never authorizes Root closure',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const rawResult=Object.freeze({unexpected:'nonvoid'});f.serviceClose=()=>rawResult;f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});
 await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeDefined();expect(f.events).toContain('source-close');expect(f.events).not.toContain('root-close');
});

it('Service private physical unknown cannot be washed by Source and Native terminal success',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const first=Object.freeze({service:'first'}),unknown=Object.freeze({servicePhysical:'unknown'});f.serviceClose=()=>{throw first;};f.serviceFate=Object.freeze({async waitPhysicalKnown(){throw unknown;},assertPhysicalKnown(){throw unknown;}});f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});
 const raw=await api.closeOriginalMainDshCoreInfrastructure(lease).then(()=>null,raw=>raw);expect(raw.cause).toBe(first);expect(raw.errors).toEqual([first,unknown]);expect(f.events).toContain('source-close');expect(f.events).toContain('terminal');expect(f.events).not.toContain('root-close');
});
it('private fate Proxy is retained and refused before descriptor traps',async()=>{
 const {lease}=await core();await api.prepareOriginalMainDshBrokerChild(lease);const h=hostile();f.serviceClose=()=>undefined;f.serviceFate=h.value;f.fate=Object.freeze({waitPhysicalKnown(){f.terminal=true;},assertPhysicalKnown(){}});
 await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeDefined();expect(h.hits()).toBe(0);expect(f.events).toContain('source-close');expect(f.events).not.toContain('root-close');
});
