// @vitest-environment node
// Instrumented fixed Native ABI; these tests do not confer Main/installation qualification.
import {afterEach,beforeEach,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({events:[] as string[],issuer:{} as object,session:{} as object,store:{} as object,port:{} as object,terminal:false,
 prepareHook:undefined as (()=>unknown)|undefined,assertHook:undefined as (()=>void)|undefined,prepareFailure:undefined as {raw:unknown}|undefined,
 fate:undefined as object|undefined,sourceClose:undefined as (()=>unknown)|undefined,rootFailure:undefined as {raw:unknown}|undefined,exported:undefined as Record<string,Function>|undefined,currentFailure:undefined as {raw:unknown}|undefined,serviceClose:undefined as (()=>unknown)|undefined,serviceFate:undefined as object|undefined}));
vi.mock('node:module',async load=>{const actual=await load<typeof import('node:module')>();return {...actual,createRequire:(url:string|URL)=>{const original=actual.createRequire(url);return (name:string)=>/[\\/]main_bootstrap\.node$/.test(name)?(f.exported={
 createOriginalMainIssuer(){return f.issuer;},assertOriginalMainIssuerCurrent(){f.events.push('current');if(f.currentFailure)throw f.currentFailure.raw;},revokeOriginalMainIssuer(){f.events.push('revoke');},
 connectOriginalMainInstallation(value:object){expect(value).toBe(f.issuer);f.events.push('connect');return value;},
 closeOriginalMainInstallation(value:object){expect(value).toBe(f.issuer);f.events.push('installation-close');},
 prepareOriginalKSwarmChild(value:object){expect(this).toBe(f.exported);expect(value).toBe(f.issuer);f.events.push('prepare-port');if(f.prepareFailure)throw f.prepareFailure.raw;return f.prepareHook?f.prepareHook():f.port;},
 assertOriginalKSwarmChildPort(value:object){expect(value).toBe(f.port);f.events.push('assert-port');f.assertHook?.();},
 assertOriginalKSwarmChildTerminal(value:object){expect(this).toBe(f.port);expect(value).toBe(f.port);f.events.push('terminal');if(!f.terminal)throw Error('native terminal pending');},
}):original(name);}};});
vi.mock('../../electron/desktop-multi-agent-store.js',()=>({readOriginalDshAdmissionPort(store:object){if(store!==f.store)throw Error('foreign store');return {};}}));
vi.mock('../../electron/harness-protected-budget-worker.js',()=>({prepareOriginalProtectedAdmissionDatabase(){return Object.freeze({closeOwned(){f.events.push('admission-close');}});},prepareOriginalProtectedBudgetWorker(){throw Error('unexpected budget');}}));
vi.mock('../../../src/runtime/verification/original-main-native-loader.js',()=>({loadOriginalMainResourceAuthority(){return {
 openOriginalInstalledMainIssuer(value:object){expect(value).toBe(f.issuer);return f.session;},bootstrapOriginalMainPool(){return 'fresh';},
 readOriginalMainPoolBootstrap(){return Object.freeze({kind:'original_main_pool_bootstrap_v1',bootstrap:'fresh',profile:'ordinary_runtime_root_resource_reservation_writer_v8_protected_io',schemaVersion:4,semanticDigest:'a'.repeat(64),businessSealed:false});},
 close(value:object){expect(value).toBe(f.session);f.events.push('root-close');if(f.rootFailure)throw f.rootFailure.raw;},
};}}));
vi.mock('../../electron/kswarm-protected-service-binding.js',()=>({closeOptionalOriginalProtectedKSwarmServicePort(port:object){expect(port).toBe(f.port);f.events.push('service-close');return f.serviceClose?f.serviceClose():null;},readOptionalOriginalProtectedKSwarmServicePortFate(port:object){expect(port).toBe(f.port);return f.serviceFate??null;}}));
vi.mock('../../electron/kswarm-protected-child.js',()=>({
 readOptionalOriginalProtectedKSwarmChildPortFate(port:object){expect(port).toBe(f.port);f.events.push('source-reader');return f.fate??null;},
 closeOriginalProtectedKSwarmChild(port:object){expect(port).toBe(f.port);f.events.push('source-close');return f.sourceClose?.();},
}));
let api:typeof import('../../electron/main-dsh-bootstrap-authority.js');
beforeEach(async()=>{
 vi.resetModules();f.events.length=0;f.issuer={};f.session={};f.store={};f.terminal=false;f.prepareHook=undefined;f.assertHook=undefined;f.prepareFailure=undefined;f.fate=undefined;f.sourceClose=undefined;f.rootFailure=undefined;f.currentFailure=undefined;f.serviceClose=undefined;f.serviceFate=undefined;
 f.port=Object.freeze(Object.assign(Object.create(null),{cancel(){f.events.push('cancel');f.terminal=true;}}));
 const actual=process;vi.stubGlobal('process',{...actual,platform:'darwin',versions:{...actual.versions,electron:'39.8.10',modules:'140'}});
 api=await import('../../electron/main-dsh-bootstrap-authority.js');
});
afterEach(()=>{vi.unstubAllGlobals();});
async function core(){const realm=api.createMainDshBootstrapAuthority();const lease=api.prepareOriginalMainDshCoreInfrastructure(realm);await api.startOriginalMainDshCoreInfrastructure(lease);return {realm,lease};}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}
function hostile(){let traps=0;const value=new Proxy({},{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;},getOwnPropertyDescriptor(){traps++;throw 0;},getPrototypeOf(){traps++;throw 0;}});return {value,hits:()=>traps};}

export {api,f,core,deferred,hostile};
