// @vitest-environment node
// Instrumented actual Core; these ABI doubles grant no Native membership.
import {it,expect} from 'vitest';
import {api,f,core,deferred,hostile} from '../support/core-broker-instrumented.js';
it('KS entered-no-handle unknown still attempts Broker cancellation before refusing Root close',async()=>{
 const {lease}=await core();f.ksFailure={raw:undefined};await expect(api.prepareOriginalMainDshKSwarmChild(lease)).rejects.toBeUndefined();await api.prepareOriginalMainDshBrokerChild(lease);
 await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeUndefined();expect(f.events).toContain('cancel');expect(f.events).toContain('terminal');expect(f.events).not.toContain('root-close');
});
it('Broker entered-no-handle unknown still attempts KS cancellation before refusing Root close',async()=>{
 const {lease}=await core();f.prepareFailure={raw:undefined};await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBeUndefined();await api.prepareOriginalMainDshKSwarmChild(lease);
 await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeUndefined();expect(f.events).toContain('ks-cancel');expect(f.events).toContain('ks-terminal');expect(f.events).not.toContain('root-close');
});
it('both fixed terminal consumers precede Root and installation close',async()=>{
 const {lease}=await core();await Promise.all([api.prepareOriginalMainDshBrokerChild(lease),api.prepareOriginalMainDshKSwarmChild(lease)]);await api.closeOriginalMainDshCoreInfrastructure(lease);
 for(const event of ['ks-terminal','terminal'])expect(f.events.indexOf(event)).toBeLessThan(f.events.indexOf('root-close'));expect(f.events.indexOf('root-close')).toBeLessThan(f.events.indexOf('installation-close'));
});
it('Native function symbol Promise metadata is joined before the prepare SDK',async()=>{
 const {lease}=await core(),gate=deferred();Object.defineProperty(f.exported!.prepareOriginalBrokerChild,Symbol('SDK-metadata'),{value:gate.promise});const opening=api.prepareOriginalMainDshBrokerChild(lease);let done=false;void opening.then(()=>{done=true;},()=>{done=true;});
 for(let i=0;i<30;i++)await Promise.resolve();expect(done).toBe(false);expect(f.events).not.toContain('prepare-port');gate.resolve();await opening;await api.closeOriginalMainDshCoreInfrastructure(lease);
});
it('Native function hostile metadata stays unknown without running Proxy traps',async()=>{
 const {lease}=await core(),h=hostile();Object.defineProperty(f.exported!.prepareOriginalBrokerChild,Symbol('SDK-metadata'),{value:h.value});await expect(api.prepareOriginalMainDshBrokerChild(lease)).rejects.toBeDefined();await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeDefined();expect(h.hits()).toBe(0);expect(f.events).not.toContain('prepare-port');expect(f.events).not.toContain('root-close');
});

it('failed Owner return still attempts both original child negatives and holds Root',async()=>{
 const {lease}=await core();await api.openOriginalMainDshInstalledRootPool(lease);await Promise.all([api.prepareOriginalMainDshBrokerChild(lease),api.prepareOriginalMainDshKSwarmChild(lease)]);f.ownerFailure={raw:undefined};
 await expect(api.returnOriginalMainDshInstalledRootPool(lease)).rejects.toBeUndefined();await expect(api.closeOriginalMainDshCoreInfrastructure(lease)).rejects.toBeUndefined();expect(f.events).toContain('ks-cancel');expect(f.events).toContain('cancel');expect(f.events).not.toContain('root-close');
});

it('a held KS SDK close cannot postpone the independent Broker negative entry',async()=>{
 const {lease}=await core(),gate=deferred();await Promise.all([api.prepareOriginalMainDshBrokerChild(lease),api.prepareOriginalMainDshKSwarmChild(lease)]);
 f.ksClose=async()=>{await gate.promise;f.ksTerminal=true;};f.ksFate=Object.freeze({async waitPhysicalKnown(){await gate.promise;},assertPhysicalKnown(){}});
 const closing=api.closeOriginalMainDshCoreInfrastructure(lease);for(let i=0;i<120;i++)await Promise.resolve();
 try{expect(f.events).toContain('cancel');expect(f.events).not.toContain('root-close');}finally{gate.resolve();await closing;}
});
