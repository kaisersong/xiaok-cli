// @vitest-environment node
import {it,expect} from 'vitest';
const path='../../electron/main-dsh-budget-authority-source.js';
const api:Record<string,any>=await import(/* @vite-ignore */path).catch(error=>{
    if(String(error?.message).includes('Cannot find module')||String(error?.code).includes('MODULE_NOT_FOUND'))return {};
    throw error;
});
it('provides a fixed Main budget Source with no caller verifier and no fake Native grant',async()=>{
    expect(api.createMainDshBudgetAuthoritySource).toBeTypeOf('function');
    const source=api.createMainDshBudgetAuthoritySource({realm:{},userSource:{}});
    expect(()=>source.openUserBudget({},'a'.repeat(64))).toThrow();
    let traps=0;const fake=new Proxy({},{get(){traps++;},ownKeys(){traps++;return [];}});
    expect(()=>source.bindStore(fake)).toThrow();
    expect(()=>source.openUserBudget(fake,fake)).toThrow();
    expect(api.isOriginalMainDshBudgetActor(fake,fake)).toBe(false);
    expect(traps).toBe(0);source.seal();await source.drain();
});
