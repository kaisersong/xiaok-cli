import {it,expect} from 'vitest';
import {initializeInstalledMacEngine,assertInstalledMacEngineHandle,inspectInstalledMacEngineHandle} from '../../../src/runtime/verification/installed-engine.js';
it('gates non-macOS before inspecting files or a database',async()=>{
 const original=Object.getOwnPropertyDescriptor(process,'platform')!;
 Object.defineProperty(process,'platform',{value:'win32'});
 try{await expect(initializeInstalledMacEngine({database:new Proxy({},{get(){throw Error('database must not be read');}}) as never})).rejects.toThrow('installed_engine_platform');}finally{Object.defineProperty(process,'platform',original);}
});
it('has no caller path, command, Docker context or Boolean qualification overrides',async()=>{
 await expect(initializeInstalledMacEngine({database:{} as never,releaseRoot:'/tmp/fake'} as any)).rejects.toThrow('installed_engine_arguments');
});

it('does not upgrade copied installation facts or callbacks into a private installed handle',async()=>{
 const fake={qualified:true,hostSocket:'/tmp/socket',assertCurrent(){},async inspect(){return {engineId:'fake'};}};
 expect(()=>assertInstalledMacEngineHandle(fake)).toThrow('installed_engine_handle');
 await expect(inspectInstalledMacEngineHandle(fake)).rejects.toThrow('installed_engine_handle');
});
