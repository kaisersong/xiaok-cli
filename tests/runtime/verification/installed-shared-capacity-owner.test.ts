import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as capacity from '../../../src/runtime/verification/installed-shared-capacity.js';
it('keeps one irreversible owner per actual lifetime and reopens the original pool only under a new actual lifetime',async()=>{
 const spy=vi.spyOn(capacity,'createInstalledSharedCapacity');const f=await installedControllerFixture();let next:Awaited<ReturnType<typeof installedControllerFixture>>|undefined;
 try{
  const token=spy.mock.calls.at(-1)![0],first=spy.mock.results.at(-1)!.value as ReturnType<typeof capacity.createInstalledSharedCapacity>;
  const pool=f.database.prepare('SELECT * FROM verification_authority_pool').all();
  expect(first.capacity.migrateLegacy().chargedResources).toBe(0);expect(()=>capacity.createInstalledSharedCapacity(token)).toThrow('capacity_authority_layer_used');
  expect(()=>capacity.assertInstalledSharedCapacity(first,f.lifetime,true)).toThrow('installed_capacity_in_use');
  await f.close(true);expect(()=>capacity.createInstalledSharedCapacity(token)).toThrow('capacity_authority_closed');
  next=await installedControllerFixture({existingRoot:f.root,recoveryOnly:true});
  const second=spy.mock.results.at(-1)!.value as ReturnType<typeof capacity.createInstalledSharedCapacity>;
  expect(next.database.prepare('SELECT * FROM verification_authority_pool').all()).toEqual(pool);expect(second).not.toBe(first);expect(second.capacity.migrateLegacy().chargedResources).toBe(0);
 }finally{spy.mockRestore();if(next)await next.close();else await f.close();}
});
