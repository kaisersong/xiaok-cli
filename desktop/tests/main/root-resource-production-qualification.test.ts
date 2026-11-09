// @vitest-environment node
import {it,expect} from 'vitest';
const path='../../electron/root-resource-production-qualification.js';
const module:Record<string,any>=await import(/* @vite-ignore */path).catch(error=>{
    if(String(error?.message).includes('Cannot find module')||String(error?.code).includes('MODULE_NOT_FOUND'))return {};
    throw error;
});
it('has a fixed production qualification reader which does not accept an opt-in or Main-role DTO',()=>{
    expect(module.readOriginalProductionRootResourceQualification).toBeTypeOf('function');
    const result=module.readOriginalProductionRootResourceQualification();
    expect(result.qualified).toBe(false);
    expect(result.kind).toBe('root_resource_production_qualification_v1');
    expect(result).not.toHaveProperty('api');
    let traps=0;const fake=new Proxy({qualified:true},{get(){traps++;return true;}});
    expect(()=>module.readOriginalProductionRootResourceQualification(fake)).toThrow('ROOT_RESOURCE_QUALIFICATION_ARGUMENT_INVALID');
    expect(traps).toBe(0);
});
