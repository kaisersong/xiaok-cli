import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as capacity from '../../../src/runtime/verification/installed-shared-capacity.js';
import * as stacks from '../../../src/runtime/verification/installed-execution-stack.js';
it('does not accept even the actual raw component through the former public slot-registration signature',async()=>{
 const spy=vi.spyOn(capacity,'createInstalledSharedCapacity'),f=await installedControllerFixture();
 try{
  const owner=spy.mock.results.at(-1)!.value as ReturnType<typeof capacity.createInstalledSharedCapacity>;
  expect(()=>capacity.registerInstalledCapacityIssuer(owner,'execution',f.raw)).toThrow('installed_capacity_construction');
 }finally{spy.mockRestore();await f.close();}
});
it('claims the original stack before its first engine await and rejects a concurrent replacement',async()=>{
 const original=stacks.createInstalledExecutionStack;let attempts=0;
 const spy=vi.spyOn(stacks,'createInstalledExecutionStack').mockImplementation(async input=>{
  const first=original(input);attempts++;
  await expect(original(input)).rejects.toThrow('installed_capacity_construction');
  return first;
 });
 const f=await installedControllerFixture();
 try{expect(attempts).toBe(1);expect(f.qualificationCalls).toBe(1);}
 finally{spy.mockRestore();await f.close();}
});
it('rejects copied construction tickets and cross-slot components without replacing the actual issuer',async()=>{
 const registered=vi.spyOn(capacity,'registerInstalledCapacityIssuer'),f=await installedControllerFixture();
 try{
  const call=registered.mock.calls.find(c=>c[1]==='execution')!;expect(call).toBeDefined();
  expect(()=>capacity.registerInstalledCapacityIssuer(call[0],'execution',call[2],undefined,{...call[4]})).toThrow('installed_capacity_construction');
  expect(()=>capacity.registerInstalledCapacityIssuer(call[0],'transcripts',call[2],undefined,call[4])).toThrow('installed_capacity_construction');
 }finally{registered.mockRestore();await f.close();}
});
