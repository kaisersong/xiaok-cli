import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import Database from 'better-sqlite3';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as capacity from '../../../src/runtime/verification/installed-shared-capacity.js';
import {assertVerificationBlobBudgetDatabase} from '../../../src/runtime/verification/blob-budget.js';
it('binds only the actual installed live budget to its actual connection',async()=>{
 const spy=vi.spyOn(capacity,'createInstalledSharedCapacity'),f=await installedControllerFixture(),other=new Database(':memory:');
 const budget=(spy.mock.results.at(-1)!.value as ReturnType<typeof capacity.createInstalledSharedCapacity>).budget;
 try{assertVerificationBlobBudgetDatabase(budget,f.database);expect(()=>assertVerificationBlobBudgetDatabase(budget,other)).toThrow();expect(()=>assertVerificationBlobBudgetDatabase({...budget},f.database)).toThrow();await f.close();expect(()=>assertVerificationBlobBudgetDatabase(budget,f.database)).toThrow();}
 finally{spy.mockRestore();other.close();await f.close();}
});
