import '../../support/installed-maintenance-probe-fixture.js';
import {it,expect} from 'vitest';
import {installedMaintenanceProbeFixture} from '../../support/installed-maintenance-probe-fixture.js';
import {readMaintenanceExecution} from '../../../src/runtime/verification/maintenance-execution.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
// Actual normal root/initializer/qualification transaction produce the one probe.
// Scripted OS leaves are not native eligibility; this whole uses real dev Docker.
it.skipIf(!socket||!image).each(['terminal','prepared','created','missing-record'] as const)('classifies original single probe facts without issuing a new probe: %s',async mode=>{
 const fixture=await installedMaintenanceProbeFixture({mode,socketPath:socket!,imageId:image!});
 const {db,engine,budget,expected,allocation,id}=fixture;
 let maintenance=fixture.maintenance;
 try{
 if(mode==='missing-record'){if(!id)throw Error('fixture container missing');await expect(maintenance.inspectExecution(expected)).rejects.toThrow('maintenance_probe_unknown');await expect(maintenance.cleanupExecution(expected)).rejects.toThrow('maintenance_probe_unknown');expect(await engine.isContainerAbsent(id)).toBe(false);expect(budget.getState(allocation)).toBe('reserved');return;}
 const before=db.prepare('SELECT COUNT(*) n FROM execution_attempts').get();if(mode==='terminal')maintenance.assertQuiescent(await maintenance.inspectExecution(expected),expected);await maintenance.cleanupExecution(expected);if(id)expect(await engine.isContainerAbsent(id)).toBe(true);expect(budget.getState(allocation)).toBe('released');db.prepare('DELETE FROM verification_engine_qualification').run();maintenance.assertQuiescent(await maintenance.inspectExecution(expected),expected);expect(readMaintenanceExecution(maintenance,db).inventory().expected).toEqual([expected]);expect(db.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual(before);

 }finally{await fixture.close();}
});
