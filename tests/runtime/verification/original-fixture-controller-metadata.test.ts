import '../../support/installed-controller-fixture.js';
import * as sharedCapacityModule from '../../../src/runtime/verification/installed-shared-capacity.js';
import * as metadataSourceModule from '../../../src/runtime/verification/installed-metadata-source.js';
// Unit-only additional controls outside original351; no genuine installed SDK qualification.
import {expect,it,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import {VERIFICATION_BUDGET} from '../../../src/runtime/verification/protocol.js';

it('grows the original startup metadata allocation through the same real capacity ledger in both partitions',async()=>{
  const f=await installedControllerFixture();
  try{
    const applied=f.reserveControllerMetadata(32*1024**2);
    expect(applied.state).toBe('confirmed');
    expect(applied.usableMaximumPageCount*applied.pageSize).toBeGreaterThanOrEqual(32*1024**2);
    expect(f.database.pragma('max_page_count',{simple:true})).toBe(applied.usableMaximumPageCount);
    const rows=f.database.prepare(`SELECT partition_name, SUM(bytes) bytes
      FROM shared_capacity_reservations
      WHERE producer_key='installed-controller-metadata' AND state<>'released'
      GROUP BY partition_name ORDER BY partition_name`).all();
    expect(rows).toEqual([
      {partition_name:'control',bytes:applied.chargedMaximumPageCount*applied.pageSize},
      {partition_name:'rollback',bytes:applied.chargedMaximumPageCount*applied.pageSize},
    ]);
    const saved=f.database.prepare('SELECT record_json FROM controller_metadata_resources WHERE resource_id=?').get(applied.resourceId) as {record_json:string};
    expect(JSON.parse(saved.record_json)).toEqual(applied);
  }finally{await f.close();}
});

it('keeps the original global cap and rejects an impossible fixture minimum without changing the ledger or page cap',async()=>{
  const f=await installedControllerFixture();
  const snapshot=()=>({cap:f.database.pragma('max_page_count',{simple:true}),
    rows:f.database.prepare('SELECT * FROM shared_capacity_reservations ORDER BY operation_id').all(),
    intents:f.database.prepare('SELECT * FROM controller_metadata_intents ORDER BY request_id').all()});
  try{
    const before=snapshot();
    expect(()=>f.reserveControllerMetadata(VERIFICATION_BUDGET.controlDatabaseBytes)).toThrow('fixture_metadata_minimum');
    expect(snapshot()).toEqual(before);
  }finally{await f.close();}
});

it('borrows outer observers without restoring their identity/history and selects each original startup result by its own window',async()=>{
  let restoreOuterShared:(()=>void)|undefined,restoreOuterSource:(()=>void)|undefined;
  let first:Awaited<ReturnType<typeof installedControllerFixture>>|undefined;
  let second:Awaited<ReturnType<typeof installedControllerFixture>>|undefined;
  try{
    const outerShared=vi.spyOn(sharedCapacityModule,'createInstalledSharedCapacity');
    restoreOuterShared=()=>outerShared.mockRestore();
    const outerSource=vi.spyOn(metadataSourceModule,'createInstalledControllerMetadataSource');
    restoreOuterSource=()=>outerSource.mockRestore();
    const sharedStart=outerShared.mock.calls.length,sourceStart=outerSource.mock.calls.length;
    first=await installedControllerFixture();
    expect(sharedCapacityModule.createInstalledSharedCapacity).toBe(outerShared);
    expect(metadataSourceModule.createInstalledControllerMetadataSource).toBe(outerSource);
    expect(outerShared.mock.calls.length).toBe(sharedStart+1);
    expect(outerSource.mock.calls.length).toBe(sourceStart+1);
    const firstSharedResult=outerShared.mock.results[sharedStart],firstSourceResult=outerSource.mock.results[sourceStart];
    expect(firstSharedResult?.type).toBe('return');
    if(!firstSharedResult||firstSharedResult.type!=='return')throw Error('original shared result missing');
    sharedCapacityModule.assertInstalledSharedCapacity(firstSharedResult.value,first.lifetime);
    expect(outerShared.mock.calls[sharedStart]?.length).toBe(1);
    expect(outerSource.mock.calls[sourceStart]?.length).toBe(1);
    expect(outerSource.mock.calls[sourceStart]?.[0]).toBe(first.lifetime);
    const firstAllocation=first.reserveControllerMetadata(32*1024**2);
    second=await installedControllerFixture();
    expect(sharedCapacityModule.createInstalledSharedCapacity).toBe(outerShared);
    expect(metadataSourceModule.createInstalledControllerMetadataSource).toBe(outerSource);
    expect(outerShared.mock.calls.length).toBe(sharedStart+2);
    expect(outerSource.mock.calls.length).toBe(sourceStart+2);
    const repeatedSharedResult=outerShared.mock.results[sharedStart],repeatedSourceResult=outerSource.mock.results[sourceStart];
    expect(repeatedSharedResult?.type).toBe('return');
    expect(repeatedSharedResult?.value).toBe(firstSharedResult.value);
    expect(firstSourceResult?.type).toBe('return');
    expect(repeatedSourceResult?.type).toBe('return');
    expect(repeatedSourceResult?.value).toBe(firstSourceResult?.value);
    expect(outerShared.mock.results.length).toBe(sharedStart+2);
    expect(outerSource.mock.results.length).toBe(sourceStart+2);
    const secondSharedResult=outerShared.mock.results[sharedStart+1];
    if(!secondSharedResult||secondSharedResult.type!=='return')throw Error('second original shared result missing');
    sharedCapacityModule.assertInstalledSharedCapacity(secondSharedResult.value,second.lifetime);
    expect(secondSharedResult.value).not.toBe(firstSharedResult.value);
    expect(outerShared.mock.calls[sharedStart+1]?.length).toBe(1);
    expect(outerSource.mock.calls[sourceStart+1]?.length).toBe(1);
    expect(outerSource.mock.calls[sourceStart+1]?.[0]).toBe(second.lifetime);
    const secondAllocation=second.reserveControllerMetadata(32*1024**2);
    expect(secondAllocation.state).toBe('confirmed');
    expect(secondAllocation.resourceId).not.toBe(firstAllocation.resourceId);
    expect(second.database.pragma('max_page_count',{simple:true})).toBe(secondAllocation.usableMaximumPageCount);
    expect(outerShared.mock.calls.length).toBe(sharedStart+2);
    expect(outerSource.mock.calls.length).toBe(sourceStart+2);
    expect(sharedCapacityModule.createInstalledSharedCapacity).toBe(outerShared);
  }finally{
    try{await second?.close();}
    finally{try{await first?.close();}finally{try{restoreOuterSource?.();}finally{restoreOuterShared?.();}}}
  }
});
