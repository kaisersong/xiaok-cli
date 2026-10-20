import '../../support/installed-maintenance-fixture.js';
import {it,expect} from 'vitest';
import {installedMaintenanceFixture} from '../../support/installed-maintenance-fixture.js';
const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it.skipIf(!socket||!image)('cleans original real material copy after existing dev execution with the maintenance receipt family',async()=>{
 const fixture=await installedMaintenanceFixture({socketPath:socket!,imageId:image!,kind:'staging'}),db=fixture.database,execution=fixture.execution,staging=fixture.staging,expected=fixture.expected,resource=fixture.resourceId;
 let failure:{error:unknown}|undefined;
 try{await staging.cleanupResource(resource);expect(db.prepare('SELECT state FROM broker_staging_intents').get()).toEqual({state:'deleted'});expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:2});await execution.cleanupExecution(expected);expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:0});
 }catch(error){failure={error};throw error;}
 finally{await fixture.close(failure);}
});
