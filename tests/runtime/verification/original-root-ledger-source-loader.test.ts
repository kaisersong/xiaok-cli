import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform')!;
let loads=0,seenPath='',outcome:unknown,namespace:object;
beforeEach(()=>{
 Object.defineProperty(process,'platform',{...originalPlatform,value:'darwin'});
 vi.resetModules();loads=0;seenPath='';outcome=undefined;
 namespace=Object.freeze(Object.assign(Object.create(null),{captureExistingOriginalRootPoolLedger(){},closeOriginalRootPoolLedgerSource(){},holdExistingOriginalRootPoolLedger(){}}));
 vi.spyOn(process,'dlopen').mockImplementation(((module:NodeModule,file:string)=>{loads++;seenPath=file;Object.defineProperty(module,'exports',{value:namespace,writable:true});if(outcome&&typeof outcome==='object'&&'throw'in outcome)throw (outcome as {throw:unknown}).throw;return outcome;}) as typeof process.dlopen);
});
afterEach(()=>{vi.restoreAllMocks();Object.defineProperty(process,'platform',originalPlatform);});
async function loader(){return (await import('../../../src/runtime/verification/original-root-ledger-source-loader.js')).loadOriginalRootLedgerSource as (...args:unknown[])=>unknown;}
it('loads only the fixed cold-only artifact once and returns exactly its three fixed functions',async()=>{
 const load=await loader(),actual=load();expect(actual).toBe(namespace);expect(load()).toBe(actual);expect(loads).toBe(1);
 expect(seenPath.replaceAll('\\','/')).toMatch(/\/native\/darwin-universal\/root_resource_ledger_source\.node$/);
 expect(Reflect.ownKeys(actual as object).sort()).toEqual(['captureExistingOriginalRootPoolLedger','closeOriginalRootPoolLedgerSource','holdExistingOriginalRootPoolLedger']);
});
it.each([undefined,Error('original dlopen')])('retains a first thrown value across later default loads',async first=>{
 const load=await loader();outcome={throw:first};let caught={present:false,value:undefined as unknown};try{load();}catch(value){caught={present:true,value};}expect(caught.present).toBe(true);expect(caught.value).toBe(first);
 outcome=undefined;try{load();throw Error('unexpected success');}catch(value){expect(value).toBe(first);}expect(loads).toBe(1);
});
it.each(['getter','extra','proxy','nonvoid'] as const)('refuses %s partial results and keeps the failed birth sticky',async kind=>{
 const load=await loader();let hits=0;
 if(kind==='getter'){namespace=Object.create(null);Object.defineProperty(namespace,'captureExistingOriginalRootPoolLedger',{get(){hits++;throw Error('getter');}});}
 if(kind==='extra')namespace={...namespace,installFresh(){}};
 if(kind==='proxy')namespace=new Proxy(namespace,{ownKeys(){hits++;throw Error('trap');}});
 if(kind==='nonvoid')outcome=0;
 expect(()=>load()).toThrow();namespace=Object.freeze({captureExistingOriginalRootPoolLedger(){},closeOriginalRootPoolLedgerSource(){},holdExistingOriginalRootPoolLedger(){}});outcome=undefined;expect(()=>load()).toThrow();expect(loads).toBe(1);expect(hits).toBe(0);
});
it('refuses caller input before reflecting it or performing a native load',async()=>{
 const load=await loader();let hits=0;const input=new Proxy({},{get(){hits++;throw Error('trap');},ownKeys(){hits++;throw Error('trap');}});
 expect(()=>load(input)).toThrow('ROOT_LEDGER_SOURCE_ARGUMENT_INVALID');expect(hits).toBe(0);expect(loads).toBe(0);
});

it.each(['win32','linux'])('refuses %s before loading a Native artifact',async platform=>{Object.defineProperty(process,'platform',{...originalPlatform,value:platform});const load=await loader();expect(()=>load()).toThrow('ROOT_RESOURCE_PLATFORM_UNAVAILABLE');expect(loads).toBe(0);});
