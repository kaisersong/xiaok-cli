import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {rmSync} from 'node:fs';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as installedController from '../../../src/runtime/verification/installed-controller.js';
import * as shutdown from '../../../src/runtime/verification/controller-shutdown.js';
import * as capacity from '../../../src/runtime/verification/installed-shared-capacity.js';
import {assertVerificationBlobBudgetDatabase} from '../../../src/runtime/verification/blob-budget.js';
it('retains actual budget and database when the actual installed qualification drain fails',async()=>{
 const spy=vi.spyOn(capacity,'createInstalledSharedCapacity');let calls=0;
 const f=await installedControllerFixture({onQualificationClose(){calls++;throw Error('actual qualification cleanup unknown');}});
 const owner=spy.mock.results.at(-1)!.value as ReturnType<typeof capacity.createInstalledSharedCapacity>;
 try{
  const failure=await f.close().then(()=>undefined,error=>error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(installedController.isInstalledControllerShutdownUnresolved(failure)).toBe(true);
  expect(installedController.isInstalledControllerShutdownUnresolved({...failure})).toBe(false);
  expect(installedController.isInstalledControllerShutdownUnresolved(new Error('installed_controller_shutdown_unknown'))).toBe(false);
  expect(calls).toBe(1);expect(f.database.open).toBe(true);
  expect(()=>assertVerificationBlobBudgetDatabase(owner.budget,f.database)).not.toThrow();
  await expect(f.close()).rejects.toThrow('installed_controller_shutdown_unknown');expect(calls).toBe(1);
 }finally{spy.mockRestore();if(f.database.open)f.database.close();rmSync(f.root,{recursive:true,force:true});}
});

it('returns the exact same original installed close attempt to concurrent callers',async()=>{
 const f=await installedControllerFixture();
 try{const first=f.installed.close(),second=f.installed.close();expect(first).toBe(second);await first;}finally{await f.close();}
});

it('publishes the installed close attempt before a fixed drain can reenter',async()=>{
 const f=await installedControllerFixture(),original=shutdown.closeInstalledControllerComponents;let nested:Promise<void>|undefined,calls=0;
 const spy=vi.spyOn(shutdown,'closeInstalledControllerComponents').mockImplementation(input=>{calls++;if(calls===1)nested=f.installed.close();return original(input);});
 try{const first=f.installed.close();expect(nested).toBe(first);expect(calls).toBe(1);await first;}finally{spy.mockRestore();await f.close();}
});
