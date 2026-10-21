import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as capacity from '../../../src/runtime/verification/installed-shared-capacity.js';
import {createInstalledMaintenanceExecution,readMaintenanceExecution} from '../../../src/runtime/verification/maintenance-execution.js';
import {createInstalledMaintenanceStaging} from '../../../src/runtime/verification/maintenance-staging.js';
import {claimInstalledCapacityStackConstruction} from '../../../src/runtime/verification/installed-controller.js';

it('rejects copied and normal-kind tickets before touching any maintenance attachment',async()=>{
 const registered=vi.spyOn(capacity,'registerInstalledCapacityIssuer'),f=await installedControllerFixture();let reads=0;
 try{
  const original=registered.mock.calls.find(call=>call[1]==='execution');if(!original||!original[4])throw Error('actual normal construction missing');const owner=original[0],ticket=original[4];
  for(const construction of [{...ticket},ticket]){
   const input={lifetime:f.lifetime,sharedCapacity:owner,construction,get attachment(){reads++;throw Error('must not read attachment');}};
   // Deliberately malformed input crossing the runtime boundary; no assertion cast.
   expect(()=>Reflect.apply(createInstalledMaintenanceExecution,undefined,[input])).toThrow('installed_capacity_construction');
   expect(()=>Reflect.apply(createInstalledMaintenanceStaging,undefined,[input])).toThrow('installed_capacity_construction');
  }
  expect(reads).toBe(0);
  expect(()=>readMaintenanceExecution({...f.raw},f.database)).toThrow('maintenance_execution_identity');
  expect(()=>claimInstalledCapacityStackConstruction(f.operationInput.assembly,owner)).toThrow('installed_capacity_construction');
 }finally{registered.mockRestore();await f.close();}
});
