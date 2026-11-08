// @vitest-environment node
// Instrumented SDK sequencing only; this does not qualify Native/Main/OS.
import {beforeEach, expect, it, vi} from 'vitest';
const f=vi.hoisted(()=>({events:[] as string[],realm:{} as object,groups:{} as object,lease:{} as object,session:{} as object,source:{} as object,fixture:false,startedCore:false,coreFault:false,openFault:false}));
vi.mock('../../electron/root-resource-production-qualification.js',()=>({ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED:false,readOriginalProductionRootResourceQualification:()=>({qualified:true})}));
vi.mock('../../electron/main-dsh-bootstrap-authority.js',()=>({
 readOriginalMainDshStartedCore(realm:object,store:object){expect(realm).toBe(f.realm);expect(store).toBe(f.groups);if(f.coreFault)throw undefined;return f.startedCore?f.lease:null;},
 prepareOriginalMainDshInstalledRootPool(realm:object,store:object){expect(realm).toBe(f.realm);expect(store).toBe(f.groups);f.events.push('prepare-lease');return f.lease;},
 openOriginalMainDshInstalledRootPool(lease:object){expect(lease).toBe(f.lease);f.events.push('installed-open');if(f.openFault)throw undefined;return f.session;},
 closeOriginalMainDshInstalledRootPool(lease:object){expect(lease).toBe(f.lease);f.events.push('close-lease');},
 returnOriginalMainDshInstalledRootPool(lease:object){expect(lease).toBe(f.lease);f.events.push('close-lease');},
 readOriginalMainDshCoreBootstrap(lease:object,session:object){expect(lease).toBe(f.lease);expect(session).toBe(f.session);f.events.push('read-bootstrap');return 'fresh';},
}));
vi.mock('../../../src/runtime/verification/original-main-native-loader.js',()=>({loadOriginalMainResourceAuthority(){
 const names='takeOriginalModelSdkBridgeKey assertOriginalModelSdkBridge takeOriginalRoomDiscussionSourceKey importOriginalRoomTurnSubject enqueue claimNext consumeLaunch cancelQueued finishOriginalRoot assertOriginalMainIssuerCurrent importOriginalPhysicalContext enqueueOriginalModel claimOriginalModel settleOriginalModel enqueueOriginalProcess enqueueOriginalWorkflowVmProcess claimOriginalProcess settleOriginalProcess prepareOriginalReadonlyLeaf waitOriginalReadonlyLeafReady bindOriginalReadonlyLeaf goOriginalReadonlyLeaf cancelOriginalReadonlyLeaf waitOriginalReadonlyLeafClosed takeOriginalRoomProjectSourceKey takeOriginalKSwarmDirectSourceKey takeOriginalWorkflowRootSourceKey takeOriginalDshDraftSourceKey importOriginalWorkflowRootSubject importOriginalKSwarmTaskSubject importOriginalRoomProjectSubject importOriginalDshDraftSubject takeOriginalAdmissionProbeSourceKey takeOriginalLivePreviewSourceKey takeOriginalMainTurnSourceKey takeOriginalGoalTurnSourceKey takeOriginalNestedSubagentSourceKey takeOriginalSnapshotPrepSourceKey takeOriginalToolWorkerSourceKey takeOriginalMaterialTurnSourceKey takeOriginalCanvasTurnSourceKey'.split(' ');
 const api:Record<string,Function>={};for(const name of names)api[name]=function(){f.events.push(name);return name.startsWith('take')?{}:undefined;};
 api.buildInfo=()=>({buildKind:f.fixture?'fixture':'production_component'});
 api.openOriginalMainIssuer=()=>{f.events.push('legacy-open');if(!f.fixture)throw Error('default VFS forbidden');return f.session;};
 api.bootstrapOriginalMainPool=(session:object)=>{expect(session).toBe(f.session);f.events.push('bootstrap');return 'fresh';};
 api.installFresh=()=>{throw Error('unexpected direct install');};api.close=()=>{f.events.push('legacy-close');};return api;
}}));
vi.mock('../../../src/runtime/verification/original-main-sdk-bridge.js',()=>({installOriginalMainSdkBridge(){f.events.push('sdk-bind');}}));
vi.mock('../../../src/runtime/task-host/task-runtime-host.js',async importOriginal=>({...await importOriginal<object>(),readOriginalTaskHostIdentityIO:()=>({read:async()=>({hostId:'host'})})}));
vi.mock('../../electron/original-room-turn-source.js',async importOriginal=>({...await importOriginal<object>(),readOriginalRoomTurnSourceBinding:(source:object)=>{expect(source).toBe(f.source);return {scope:{profileId:'profile',workspaceId:'workspace'}};}}));
vi.mock('../../electron/desktop-multi-agent-store.js',async importOriginal=>({...await importOriginal<object>(),readOriginalDshAdmissionPort:(store:object,realm:object)=>{expect(store).toBe(f.groups);expect(realm).toBe(f.realm);return {};}}));
vi.mock('../../electron/main-dsh-budget-authority-source.js',async importOriginal=>({...await importOriginal<object>(),readOriginalMainDshBudgetAuthoritySource:()=>({assertLocal(){}})}));
vi.mock('../../electron/harness-optimization-service.js',async importOriginal=>({...await importOriginal<object>(),readOriginalDshBudgetRuntimeBinding:()=>({assertLocal(){}})}));
vi.mock('../../electron/main-dsh-physical-composition.js',()=>({cacheOriginalMainDshPhysicalComposition(){}}));
let api:typeof import('../../electron/main-room-root-admission.js');
beforeEach(async()=>{vi.resetModules();f.events.length=0;f.realm={};f.groups={};f.lease={};f.session={};f.source={};f.fixture=false;f.startedCore=false;f.coreFault=false;f.openFault=false;api=await import('../../electron/main-room-root-admission.js');});
async function bind(){const owner=api.createOriginalMainRootAdmissionOwner({roomSource:f.source,host:{},store:{}});await api.bindOriginalMainDshPhysicalPort(owner,f.realm,f.groups,{},{});return owner;}
it('actual Owner selects installed lease before open and bootstrap before keys, with zero default-VFS open',async()=>{
 const owner=await bind();
 expect(f.events.slice(0,3)).toEqual(['prepare-lease','installed-open','read-bootstrap']);
 expect(f.events).not.toContain('bootstrap');
 expect(f.events.indexOf('read-bootstrap')).toBeLessThan(f.events.indexOf('takeOriginalRoomDiscussionSourceKey'));
 expect(f.events).not.toContain('legacy-open');await owner.drain();
 expect(f.events.filter(x=>x==='close-lease')).toHaveLength(2);expect(f.events).not.toContain('legacy-close');
});
it('actual Owner retains the passive lease when installed open throws undefined, then performs its negative close',async()=>{
 const owner=api.createOriginalMainRootAdmissionOwner({roomSource:f.source,host:{},store:{}});f.openFault=true;
 await expect(api.bindOriginalMainDshPhysicalPort(owner,f.realm,f.groups,{},{})).rejects.toBeUndefined();
 await owner.drain().catch(()=>{});
 expect(f.events).toContain('close-lease');expect(f.events).not.toContain('bootstrap');expect(f.events).not.toContain('legacy-open');
});
it('actual Owner preserves the original fixture API and never creates an installed lease',async()=>{
 f.fixture=true;const owner=await bind();await owner.drain();
 expect(f.events).toContain('legacy-open');expect(f.events).toContain('legacy-close');expect(f.events).not.toContain('prepare-lease');
});

it('fixture Owner borrows an already-started genuine Core instead of opening a legacy Root pool',async()=>{
 f.fixture=true;f.startedCore=true;const owner=await bind();
 expect(f.events).toContain('installed-open');expect(f.events).toContain('read-bootstrap');
 expect(f.events).not.toContain('legacy-open');expect(f.events).not.toContain('bootstrap');
 await owner.drain();expect(f.events).not.toContain('legacy-close');
});
it('genuine Core failure is not a null/legacy fallback and preserves an undefined first error',async()=>{
 f.fixture=true;f.startedCore=true;f.coreFault=true;
 await expect(bind()).rejects.toBeUndefined();expect(f.events).not.toContain('legacy-open');
});

it('a Core appearing after a legacy boot cannot relabel or reuse the other Root pool',async()=>{
 f.fixture=true;const owner=api.createOriginalMainRootAdmissionOwner({roomSource:f.source,host:{},store:{}});
 await owner.room.claimNext();f.startedCore=true;
 await expect(api.bindOriginalMainDshPhysicalPort(owner,f.realm,f.groups,{},{})).rejects.toThrow('ROOT_RESOURCE_CORE_BINDING_AFTER_BOOT');
 expect(f.events.filter(x=>x==='legacy-open')).toHaveLength(1);expect(f.events).not.toContain('installed-open');
 await owner.drain();
});
