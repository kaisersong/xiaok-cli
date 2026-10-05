import {it,expect} from 'vitest';
import {createInstalledEngineQualification} from '../../../src/runtime/verification/installed-engine-qualification.js';
it('rejects a copied observed engine before touching DB, budget or endpoint',()=>{
 const untouched=new Proxy({},{get(){throw Error('fixture must not be consumed');}});
 expect(()=>createInstalledEngineQualification({engine:{qualified:true,hostSocket:'/tmp/docker.sock'} as never,database:untouched as never,budget:untouched as never})).toThrow('installed_engine_handle');
});
