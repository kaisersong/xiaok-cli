// @vitest-environment node
// Actual platform/ABI refusal precedes the fixed Native SDK. No fake UID/role.
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({nativeLoads:0}));
vi.mock('node:module',async load=>{const actual=await load<typeof import('node:module')>();return {...actual,createRequire:(url:string|URL)=>{const original=actual.createRequire(url);return(name:string)=>{if(/[\\/]main_bootstrap\.node$/.test(name)){f.nativeLoads++;throw Error('unexpected Native load');}return original(name);};}};});
beforeEach(()=>{vi.resetModules();f.nativeLoads=0;});afterEach(()=>vi.unstubAllGlobals());
it.each([['win32','140','39.8.10'],['linux','140','39.8.10'],['darwin','137','39.8.10'],['darwin','140','38.0.0']] as const)('refuses unsupported platform/ABI %s %s %s before Native construction',async(platform,modules,electron)=>{
 const actual=process;vi.stubGlobal('process',{...actual,platform,versions:{...actual.versions,modules,electron}});
 const api=await import('../../electron/main-dsh-bootstrap-authority.js');expect(()=>api.createMainDshBootstrapAuthority()).toThrow('DSH_MAIN_NATIVE_UNAVAILABLE');
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;}});await expect(api.prepareOriginalMainDshBrokerChild(proxy)).rejects.toBeDefined();expect(traps).toBe(0);expect(f.nativeLoads).toBe(0);
});
