// @vitest-environment node
// Actual Source lifecycle with instrumented dependencies; no Native/OS grant.
import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({events:[] as string[],scope:{profileId:'profile',workspaceId:'workspace'},user:{} as object,realm:{seal(){f.events.push('realm-seal');}},core:{} as object,runtime:{} as object,qualified:true,coreFault:false}));
vi.mock('../../electron/main-dsh-source-component.js',()=>({assertOptionalOriginalMainDshServiceComponent:()=>null}));
vi.mock('../../electron/root-resource-production-qualification.js',()=>({ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED:false,readOriginalProductionRootResourceQualification:()=>({qualified:f.qualified})}));
vi.mock('../../electron/main-dsh-bootstrap-authority.js',()=>({createMainDshBootstrapAuthority:()=>f.realm,
 prepareOriginalMainDshCoreInfrastructure(realm:object){expect(realm).toBe(f.realm);f.events.push('core-prepare');return f.core;},
 async startOriginalMainDshCoreInfrastructure(core:object){expect(core).toBe(f.core);f.events.push('core-start');if(f.coreFault)throw undefined;},
 async closeOriginalMainDshCoreInfrastructure(core:object){expect(core).toBe(f.core);f.events.push('core-close');},
}));
vi.mock('../../electron/main-dsh-control-source.js',()=>({readOriginalMainDshControlSourceBinding:(user:object)=>{expect(user).toBe(f.user);return {scope:f.scope,storageScope:f.scope,principalId:'desktop-user:'+f.scope.profileId,assertLocal(){}};}}));
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
let api:typeof import('../../electron/main-dsh-service-sources.js');
beforeEach(async()=>{vi.resetModules();f.events.length=0;f.scope={profileId:'profile',workspaceId:'workspace'};f.user={};f.core={};f.runtime={};f.qualified=true;f.coreFault=false;api=await import('../../electron/main-dsh-service-sources.js');});
function birth(){return api.createOriginalMainDshServiceSources({scope:f.scope,userSource:f.user});}
function prepare(source:object){return api.prepareOriginalMainDshServiceSources(source,{dataRoot:'/private/test',harnessUserActor:{requestSource:'user',principalId:'actor'}});}
it('starts original Core before first budget Worker and keeps Core until the final Store close',async()=>{
 const source=birth();await prepare(source);
 expect(f.events.indexOf('core-start')).toBeGreaterThanOrEqual(0);expect(f.events.indexOf('core-start')).toBeLessThan(f.events.indexOf('budget-open'));
 const lease=api.claimOriginalMainDshServiceSources(source,f.scope);
 const {DesktopMultiAgentStore}=await import('../../electron/desktop-multi-agent-store.js');
 api.recordOriginalMainDshServiceStore(lease,new DesktopMultiAgentStore('/private/test/groups.sqlite'));
 api.transferOriginalMainDshServiceSources(lease);
 await api.closeOriginalMainDshServiceResources(lease);expect(f.events).not.toContain('core-close');
 await api.finishOriginalMainDshServiceStore(lease);
 expect(f.events.indexOf('budget-close')).toBeLessThan(f.events.indexOf('store-close'));
 expect(f.events.indexOf('store-close')).toBeLessThan(f.events.indexOf('core-close'));
 expect(f.events.indexOf('core-close')).toBeLessThan(f.events.indexOf('realm-seal'));
});
it('a failed Core start opens no budget and startup cleanup still consumes the registered passive Core',async()=>{
 const source=birth();f.coreFault=true;await expect(prepare(source)).rejects.toBeUndefined();
 await api.closeOriginalMainDshStartupSources(source).catch(()=>{});
 expect(f.events).not.toContain('budget-open');expect(f.events).toContain('core-close');
});
it('unqualified legacy fixture startup preserves its original path with no transport opt-in',async()=>{
 f.qualified=false;const source=birth();await prepare(source);await api.closeOriginalMainDshStartupSources(source);
 expect(f.events).toContain('budget-open');expect(f.events).not.toContain('core-prepare');
});
