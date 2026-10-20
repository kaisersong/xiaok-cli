import '../../support/installed-maintenance-fixture.js';
import {it,expect,vi} from 'vitest';
import {readMaintenanceExecution} from '../../../src/runtime/verification/maintenance-execution.js';
import {installedMaintenanceFixture} from '../../support/installed-maintenance-fixture.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image).each(['normal','engine-drift'] as const)('inspects original dev resources after runner close and refunds only actual cleanup: %s',async mode=>{
 const fixture=await installedMaintenanceFixture({socketPath:socket!,imageId:image!,kind:'execution'});
 let maintenance=fixture.execution,db=fixture.database,failure:{error:unknown}|undefined;
 const {invocation,scopeDigest,command,plan,expected}=fixture;
 try{
  const {DockerEngineTransport}=await vi.importActual<typeof import('../../../src/runtime/isolated-execution/docker-engine-transport.js')>('../../../src/runtime/isolated-execution/docker-engine-transport.js');
  let drift=false,driftTriggered=false;
  const originalRemove=DockerEngineTransport.prototype.removeVolume;
  const spy=mode==='engine-drift'?vi.spyOn(DockerEngineTransport.prototype,'removeVolume').mockImplementation(async function(this:import('../../../src/runtime/isolated-execution/docker-engine-transport.js').DockerEngineTransport,volume){await originalRemove.call(this,volume);if(!driftTriggered){driftTriggered=true;drift=true;fixture.setDrift(drift);}}):undefined;
  const receipt=await maintenance.inspectExecution(expected);maintenance.assertQuiescent(receipt,expected);expect(()=>maintenance!.assertQuiescent({...receipt},expected)).toThrow('maintenance_quiescence_receipt');expect(()=>readMaintenanceExecution(maintenance!,db).raw.reserveExecution({...invocation,ownerKey:'owner',scopeDigest,command,materializedInput:plan})).toThrow('maintenance_execution_no_admission');expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:2});if(mode==='engine-drift'){try{await expect(maintenance.cleanupExecution(expected)).rejects.toThrow('actual attachment changed');expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:2});await fixture.finishAfterDrift();}finally{spy?.mockRestore();drift=false;fixture.setDrift(false);}await maintenance.close();await fixture.restartAfterDrift();maintenance=fixture.execution;db=fixture.database;}const final=await maintenance.cleanupExecution(expected);maintenance.assertQuiescent(final,expected);expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:0});await fixture.finish();await maintenance.close();expect(()=>maintenance!.assertQuiescent(final,expected)).toThrow('maintenance_execution_closed');
 }catch(error){failure={error};throw error;}
 finally{vi.restoreAllMocks();await fixture.close(failure);}
});
