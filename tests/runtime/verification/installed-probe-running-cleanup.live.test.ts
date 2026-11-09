import '../../support/installed-maintenance-probe-fixture.js';
import {it,expect} from 'vitest';
import {installedProbeRunningCleanupFixture} from '../../support/installed-maintenance-probe-fixture.js';

const socket=process.env.SOL_PI_DOCKER_PROBE_SOCKET,image=process.env.SOL_PI_DOCKER_PROBE_IMAGE;
it('rejects source-only running cleanup before taking a fixture root',async()=>{
 const imageId='sha256:'+'a'.repeat(64);
 await expect(Reflect.apply(installedProbeRunningCleanupFixture,undefined,[{
  socketPath:'/not-opened-running-cleanup.sock',imageId,sourceOnly:true,
 }])).rejects.toThrow('running_cleanup_requires_real_transport');
 // The original implementation checks previous-owner occupancy before endpoint
 // validation. Reaching this rejection proves the first call held no leaf/root.
 await expect(installedProbeRunningCleanupFixture({socketPath:'',imageId})).rejects.toThrow('probe_fixture_explicit_endpoint');
});
// Real dedicated devDocker only. The existing scripted OS leaf grants no native
// qualification. A missed running window is a saved NOT_PROVEN failure, not skip.
it.skipIf(!socket||!image)('drains the original running qualification probe through its normal owner',async()=>{
 if(!socket||!image)throw Error('running_cleanup_explicit_endpoint');
 const audit=await installedProbeRunningCleanupFixture({socketPath:socket,imageId:image});
 expect(audit.status,JSON.stringify({auditPath:audit.auditPath,status:audit.status,errors:audit.errors})).toBe('PASS');
 expect(audit.containerIds).toHaveLength(1);
 expect(audit.errors).toEqual([]);
 expect(audit.facts).toMatchObject({cutUsed:true,requestObserved:true,ackObserved:true,released:true,deleted:true,
  terminalCommitted:true,drainObserved:true,databaseClosed:true,startupRejectedWithCut:true,databaseOpen:false,unresolved:false,
  counters:{create:1,start:1,wait:2,logs:0,remove:1,persist:2,maintenanceCreate:0,maintenanceStart:0},forbiddenEffects:[]});
 expect(audit.events.filter(item=>item.method==='wait'&&item.stage==='cut')).toHaveLength(1);
 expect(audit.events.filter(item=>item.method==='kill'&&item.stage==='end')).toHaveLength(1);
 expect(audit.events.filter(item=>item.method==='wait'&&item.stage==='end')).toHaveLength(1);
 const kill=audit.events.find(item=>item.method==='kill'&&item.stage==='begin');
 expect(audit.events.find(item=>item.sequence===(kill?.sequence??0)-1)).toMatchObject({
  method:'inspect',stage:'end',containerId:audit.containerIds[0],
  value:{Id:audit.containerIds[0],State:{Running:true,Status:'running',Pid:expect.any(Number)}},
 });
 expect(audit.events).toContainEqual(expect.objectContaining({method:'inspect',stage:'end',
  value:expect.objectContaining({State:expect.objectContaining({Running:false,Pid:0,Status:'exited'})}),
 }));
 expect(audit.events.filter(item=>item.containerId!==undefined).every(item=>item.containerId===audit.containerIds[0])).toBe(true);
});
