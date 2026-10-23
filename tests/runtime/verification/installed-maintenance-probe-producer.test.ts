import '../../support/installed-maintenance-probe-fixture.js';
import {it,expect} from 'vitest';
import {realpathSync,lstatSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {installedMaintenanceProbeFixture} from '../../support/installed-maintenance-probe-fixture.js';
import {assertInstalledMacEngineHandle} from '../../../src/runtime/verification/installed-engine.js';
import {assertInstalledEngineQualificationIdentity} from '../../../src/runtime/verification/installed-engine-qualification.js';
import {readBlobCapacityIssuer} from '../../../src/runtime/verification/blob-capacity-issuer.js';
import {readMaintenanceExecution} from '../../../src/runtime/verification/maintenance-execution.js';
import {persistInstalledMaintenanceRequest} from '../../../src/runtime/verification/installed-maintenance-handoff.js';

// Node-only stateful transport: never a dev/native/OS qualification. All private
// producer transactions, engine handles, capacity guards/issuers and roots real.
// OS/lifetime/broker identity is the explicit scoped test leaf, not native proof.
const image='sha256:'+'d'.repeat(64);
it.each(['prepared','created','terminal','missing-record'] as const)('hands off exactly the actual original probe before maintenance cleanup: %s',async mode=>{
 const f=await installedMaintenanceProbeFixture({mode,imageId:image,sourceOnly:true});
 try{
  expect(f.counters.initializer).toBe(1);expect(f.counters.qualificationFactory).toBe(1);expect(f.counters.transaction).toBe(1);
  expect(f.original.requestObserved).toBe(true);expect(f.original.state).toBe(mode==='prepared'?'prepared':mode==='created'?'created':'terminal');
  expect(f.counters.create).toBe(mode==='prepared'?0:1);expect(f.counters.start).toBe(mode==='prepared'||mode==='created'?0:1);expect(f.counters.wait).toBe(mode==='prepared'||mode==='created'?0:1);
  expect(f.counters.beginDispatch).toBe(mode==='prepared'?0:1);expect(f.counters.bindContainer).toBe(mode==='prepared'?0:1);
  // The original qualification cut precedes successful-stack metadata startup.
  expect(f.counters.metadataGuards).toBe(0);expect(f.counters.maintenanceMetadataGuards).toBe(0);expect(f.counters.migrationGuards).toBe(1);
  expect(f.counters.engineIdDriftRejections).toBe(1);
  expect(f.original.record.deleted).toBe(false);expect(f.budget.getState(f.allocation)).toBe('reserved');
  expect(f.db.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual({n:1});
  expect(()=>assertInstalledMacEngineHandle({...f.original.engineHandle})).toThrow('installed_engine_handle');
  expect(()=>assertInstalledEngineQualificationIdentity({...f.original.qualification},f.original.engineHandle,f.db)).toThrow('qualification_identity');
  if(mode!=='missing-record'){
   expect(readBlobCapacityIssuer(f.db,f.allocation).issuerKind).toBe('qualification-probe');
   expect(readBlobCapacityIssuer(f.db,f.allocation).producerResourceId).toBe(f.expected.executionIdentity);
   expect(()=>readBlobCapacityIssuer(f.db,{...f.allocation,bytes:f.allocation.bytes+1})).toThrow('blob_issuer_missing');
  }
  expect(()=>f.replayOriginalRequest()).toThrow('maintenance_handoff_command');
  expect(()=>persistInstalledMaintenanceRequest({...f.original.record})).toThrow('maintenance_handoff_command');
  const created=f.counters.create,started=f.counters.start;
  if(mode==='missing-record'){
   await expect(f.maintenance.inspectExecution(f.expected)).rejects.toThrow('maintenance_probe_unknown');
   await expect(f.maintenance.cleanupExecution(f.expected)).rejects.toThrow('maintenance_probe_unknown');
   if(!f.id)throw Error('source fixture missing original container');expect(await f.engine.isContainerAbsent(f.id)).toBe(false);expect(f.budget.getState(f.allocation)).toBe('reserved');
   expect(f.db.prepare("SELECT outcome FROM verification_maintenance_handoff_items").all()).toEqual([{outcome:'requested'}]);
  }else{
   await f.maintenance.cleanupExecution(f.expected);
   if(f.id)expect(await f.engine.isContainerAbsent(f.id)).toBe(true);
   expect(f.budget.getState(f.allocation)).toBe('released');
   expect(f.db.prepare('SELECT outcome FROM verification_maintenance_handoff_items').all()).toEqual([{outcome:'completed'}]);
   f.db.prepare('DELETE FROM verification_engine_qualification').run();
   f.maintenance.assertQuiescent(await f.maintenance.inspectExecution(f.expected),f.expected);
   expect(readMaintenanceExecution(f.maintenance,f.db).inventory().expected).toEqual([f.expected]);
  }
  expect(f.forbiddenEffects).toEqual([]);
  expect(f.counters.create).toBe(created);expect(f.counters.start).toBe(started);expect(f.counters.maintenanceCreate).toBe(0);expect(f.counters.maintenanceStart).toBe(0);
  expect(f.db.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual({n:1});
 }finally{await f.close();}
});
it('projects only the two exact DB string identities while retaining physical native paths and negative aliases',async()=>{
 const f=await installedMaintenanceProbeFixture({mode:'prepared',imageId:image,sourceOnly:true});
 try{
  const {physicalDB,canonicalDB,physicalState}=f.pathIdentity;
  expect(f.db.name).toBe(physicalDB);
  const namespaces=f.db.pragma('database_list');if(!Array.isArray(namespaces))throw Error('probe_fixture_namespace_array');
  expect(namespaces.length===1||namespaces.length===2).toBe(true);
  expect(namespaces[0]).toEqual({seq:0,name:'main',file:physicalDB});
  if(namespaces.length===2){
   expect(namespaces[1]).toEqual({seq:1,name:'temp',file:''});
   expect(f.db.prepare('SELECT 1 FROM temp.sqlite_schema LIMIT 1').get()).toBeUndefined();
  }
  expect(f.db.pragma('database_list')).toEqual(namespaces);
  expect(realpathSync(physicalDB)).toBe(canonicalDB);expect(realpathSync(canonicalDB)).toBe(canonicalDB);
  expect(realpathSync(physicalState)).toBe(physicalState);expect(lstatSync(physicalDB).isFile()).toBe(true);
  expect(realpathSync(Buffer.from(physicalDB))).toBe(physicalDB);
  expect(realpathSync(physicalState+'/../state/authority.sqlite')).toBe(physicalDB);
  expect(()=>realpathSync(canonicalDB+'/../authority.sqlite')).toThrow('probe_fixture_fs_scope');
  expect(()=>realpathSync(Buffer.from(canonicalDB))).toThrow('probe_fixture_nonexact_db_alias');
  const second=join(f.root,'second.sqlite');writeFileSync(second,'second independent file');expect(realpathSync(second)).toBe(second);
  expect(()=>realpathSync(canonicalDB+'-not-the-db')).toThrow();
  await f.maintenance.cleanupExecution(f.expected);
 }finally{await f.close();}
});
