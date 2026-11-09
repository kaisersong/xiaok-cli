// @vitest-environment node
// Actual Source lifecycle with instrumented dependencies; no Native/OS grant.
import {beforeEach,expect,it,vi} from 'vitest';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixtureRoot=join(tmpdir(),'xiaok-source-bridge-fixture');
const f=vi.hoisted(()=>({events:[] as string[],scope:{profileId:'profile',workspaceId:'workspace'},user:{} as object,realm:{seal(){f.events.push('realm-seal');}},core:{} as object,runtime:{} as object,qualified:true,coreFault:false,corePromise:Promise.resolve({}) as Promise<object>,coreCalls:[] as object[],onLocal:undefined as (()=>void)|undefined}));
vi.mock('../../electron/root-resource-production-qualification.js',()=>({ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED:false,readOriginalProductionRootResourceQualification:()=>({qualified:f.qualified})}));
vi.mock('../../electron/main-dsh-bootstrap-authority.js',()=>({createMainDshBootstrapAuthority:()=>f.realm,
 async joinOriginalMainDshServiceComponent(){},
 assertOptionalOriginalMainDshServiceComponent:()=>null,
 prepareOriginalMainDshCoreInfrastructure(realm:object){expect(realm).toBe(f.realm);f.events.push('core-prepare');return f.core;},
 async startOriginalMainDshCoreInfrastructure(core:object){expect(core).toBe(f.core);f.events.push('core-start');if(f.coreFault)throw undefined;},
 async closeOriginalMainDshCoreInfrastructure(core:object){expect(core).toBe(f.core);f.events.push('core-close');},
}));
vi.mock('../../electron/main-dsh-control-source.js',()=>({readOriginalMainDshControlSourceBinding:(user:object)=>{expect(user).toBe(f.user);return {scope:f.scope,storageScope:f.scope,principalId:'desktop-user:'+f.scope.profileId,assertLocal(){f.onLocal?.();}};}}));
vi.mock('../../electron/main-dsh-budget-authority-source.js',()=>({createMainDshBudgetAuthoritySource:()=>({seal(){f.events.push('budget-seal');},async drain(){f.events.push('budget-drain');}}),isOriginalMainDshBudgetActor:()=>false}));
vi.mock('../../electron/dsh-github-source-session.js',()=>({createMainGithubSourceConnectionPopulation:()=>({sourceReadAuthoritySource:{},stopAccepting(){},async close(){}}),isOriginalGithubSourcePopulationBudgetActor:()=>false}));
vi.mock('../../electron/harness-optimization-service.js',()=>({
 async createHarnessOptimizationRuntime(options:{originalCoreLease?:object}){expect(options.originalCoreLease).toBe(f.qualified?f.core:undefined);f.events.push('budget-open');return f.runtime;},
 readOriginalDshBudgetRuntimeBinding:()=>({}),
 readOriginalDshBudgetRuntimeDisposal:()=>({async dispose(){f.events.push('budget-close');}}),
}));
vi.mock('../../electron/desktop-multi-agent-store.js',()=>({DesktopMultiAgentStore:class{close(){f.events.push('store-close');}},readOriginalDshAdmissionPort:()=>({}),readOriginalDshUserControlPort:()=>({})}));
vi.mock('../../electron/desktop-service-scope.js',()=>({resolveDesktopServiceScope:()=>f.scope}));
vi.mock('../../electron/main-dsh-business-source.js',()=>({createMainDshBusinessSource:()=>({stopAccepting(){},async close(){f.events.push('business-close');}})}));
vi.mock('../../electron/main-dsh-core-kswarm.js',()=>({prepareOriginalMainDshKSwarmChild(core:object){f.coreCalls.push(core);return f.corePromise;}}));
let api:typeof import('../../electron/main-dsh-service-sources.js');
beforeEach(async()=>{vi.resetModules();f.events.length=0;f.scope={profileId:'profile',workspaceId:'workspace'};f.user={};f.core={};f.runtime={};f.qualified=true;f.coreFault=false;f.coreCalls=[];f.corePromise=Promise.resolve(Object.freeze({fixtureOnly:true}));f.onLocal=undefined;api=await import('../../electron/main-dsh-service-sources.js');});
function birth(){return api.createOriginalMainDshServiceSources({scope:f.scope,userSource:f.user});}
function prepare(source:object){return api.prepareOriginalMainDshServiceSources(source,{dataRoot:fixtureRoot,harnessUserActor:{requestSource:'user',principalId:'actor'}});}
function bridge(){const fn=(api as unknown as {prepareOriginalMainDshSourceKSwarmChild?:Function}).prepareOriginalMainDshSourceKSwarmChild;expect(fn).toBeTypeOf('function');return fn!;}
async function transferred(){const source=birth();await prepare(source);const lease=api.claimOriginalMainDshServiceSources(source,f.scope);const {DesktopMultiAgentStore}=await import('../../electron/desktop-multi-agent-store.js');api.recordOriginalMainDshServiceStore(lease,new DesktopMultiAgentStore(join(fixtureRoot,'groups.sqlite')));api.transferOriginalMainDshServiceSources(lease);return {source,lease};}
it('uses only the private Core lease and returns its exact original Promise',async()=>{const call=bridge(),{source,lease}=await transferred();expect(call(source,lease)).toBe(f.corePromise);expect(f.coreCalls).toEqual([f.core]);await api.closeOriginalMainDshServiceResources(lease);await api.finishOriginalMainDshServiceStore(lease);});
it('rejects foreign/copied/proxy tuple members and caller Core leases before their properties',async()=>{const call=bridge(),{source,lease}=await transferred();let hits=0;const hostile=new Proxy({},{get(){hits++;throw 0;},ownKeys(){hits++;throw 0;}});for(const [a,b]of [[hostile,lease],[source,hostile],[{},lease],[source,{...lease}],[source,f.core],[Object.create(source),lease]])expect(()=>call(a,b)).toThrow('DSH_MAIN_SERVICE_SOURCES_REQUIRED');expect(()=>call(source,lease,hostile)).toThrow();expect(hits).toBe(0);expect(f.coreCalls).toEqual([]);await api.closeOriginalMainDshServiceResources(lease);await api.finishOriginalMainDshServiceStore(lease);});
it('does not prepare before the actual Store/Services lifetime transfer',async()=>{const call=bridge(),source=birth();await prepare(source);const lease=api.claimOriginalMainDshServiceSources(source,f.scope);expect(()=>call(source,lease)).toThrow();expect(f.coreCalls).toEqual([]);await api.closeOriginalMainDshStartupSources(source);});
it('genuine ordinary Sources without a Core cannot opt into Native by shape',async()=>{const call=bridge();f.qualified=false;const {source,lease}=await transferred();expect(()=>call(source,lease)).toThrow();expect(f.coreCalls).toEqual([]);await api.closeOriginalMainDshServiceResources(lease);await api.finishOriginalMainDshServiceStore(lease);});
it('closure synchronously blocks a late positive prepare',async()=>{const call=bridge(),{source,lease}=await transferred();const closing=api.closeOriginalMainDshServiceResources(lease);expect(()=>call(source,lease)).toThrow();expect(f.coreCalls).toEqual([]);await closing;await api.finishOriginalMainDshServiceStore(lease);});
it('rechecks private closure after the original local guard synchronously reenters shutdown',async()=>{const call=bridge(),{source,lease}=await transferred();let closing:Promise<void>|undefined;f.onLocal=()=>{f.onLocal=undefined;closing=api.closeOriginalMainDshServiceResources(lease);};expect(()=>call(source,lease)).toThrow();expect(f.coreCalls).toEqual([]);await closing;await api.finishOriginalMainDshServiceStore(lease);});
it('does not replace a rejected original Core Promise or its undefined first value',async()=>{const call=bridge(),{source,lease}=await transferred();f.corePromise=Promise.reject(undefined);const result=call(source,lease);expect(result).toBe(f.corePromise);await expect(result).rejects.toBeUndefined();await api.closeOriginalMainDshServiceResources(lease);await api.finishOriginalMainDshServiceStore(lease);});
