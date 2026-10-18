import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as installedCapacity from '../../../src/runtime/verification/installed-shared-capacity.js';
import {createHash} from 'node:crypto';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
it('persists one exact producer issuer for every real installed allocation in the original transaction',async()=>{
 const f=await verifiedOperationFixture('dispatch');
 try{
  const allocations=f.database.prepare('SELECT resource_id,tuple_json,tuple_hash FROM verification_blob_reservations ORDER BY resource_id').all() as {resource_id:string;tuple_json:string;tuple_hash:string}[];
  const mappings=f.database.prepare('SELECT resource_id,allocation_hash,record_json,record_hash FROM shared_blob_issuers ORDER BY resource_id').all() as {resource_id:string;allocation_hash:string;record_json:string;record_hash:string}[];
  expect(mappings).toHaveLength(allocations.length);expect(mappings.length).toBeGreaterThanOrEqual(4);
  for(const [index,mapping] of mappings.entries()){
   const allocation=allocations[index]!,p=JSON.parse(allocation.tuple_json),record=JSON.parse(mapping.record_json);
   expect(mapping.resource_id).toBe(allocation.resource_id);expect(mapping.allocation_hash).toBe(allocation.tuple_hash);
   expect(record).toMatchObject({resourceId:p.resourceId,allocationHash:allocation.tuple_hash,ownerKey:p.ownerKey,scopeDigest:p.scopeDigest,bytes:p.bytes});
   expect(mapping.record_json).toBe(json(record));expect(mapping.record_hash).toBe(createHash('sha256').update(mapping.record_json).digest('hex'));
   expect(record.producerLineageHash).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(new Set(mappings.map(m=>JSON.parse(m.record_json).issuerKind))).toEqual(new Set(['material','raw','run','transcript']));
 }finally{await f.close();}
});

it('does not reuse an existing charged allocation after its durable issuer mapping changes',async()=>{
 const spy=vi.spyOn(installedCapacity,'createInstalledSharedCapacity'),f=await verifiedOperationFixture('dispatch');
 const budget=(spy.mock.results.at(-1)!.value as ReturnType<typeof installedCapacity.createInstalledSharedCapacity>).budget;
 let saved:{resource_id:string;record_hash:string}|undefined;
 try{
  const row=f.database.prepare("SELECT tuple_json FROM verification_blob_reservations WHERE state='reserved' ORDER BY resource_id LIMIT 1").get() as {tuple_json:string};const p=JSON.parse(row.tuple_json);
  saved=f.database.prepare('SELECT resource_id,record_hash FROM shared_blob_issuers WHERE resource_id=?').get(p.resourceId) as typeof saved;
  const before=f.database.prepare('SELECT * FROM shared_capacity_reservations ORDER BY operation_id').all();
  f.database.prepare("UPDATE shared_blob_issuers SET record_hash=? WHERE resource_id=?").run('0'.repeat(64),p.resourceId);
  expect(()=>budget.reserve(p)).toThrow('blob_issuer_changed');
  expect(f.database.prepare('SELECT * FROM shared_capacity_reservations ORDER BY operation_id').all()).toEqual(before);
 }finally{if(saved)f.database.prepare('UPDATE shared_blob_issuers SET record_hash=? WHERE resource_id=?').run(saved.record_hash,saved.resource_id);spy.mockRestore();await f.close();}
});

it('rolls back both the real material allocation and its source row when a trigger corrupts the new issuer record',async()=>{
 const f=await installedControllerFixture(),signal=new AbortController().signal,invocation={sessionIdentity:'issuer-session',compoundOperationId:'issuer-operation',validationInvocationId:'issuer-validation'},sha=(v:unknown)=>createHash('sha256').update(json(v)).digest('hex');
 try{
  const recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:createHash('sha256').update('result').digest('hex'),structure:'bytes'}]};
  const c=await f.invoke('completion.prepare-owner',{enrollment:{ownerKind:'task',ownerId:'issuer-task',invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash:sha(recipe),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner'}}},f.peer,signal) as {challengeId:string};
  await f.invoke('completion.authorize-owner',{challengeId:c.challengeId},f.peer,signal);
  const review=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal),grant=await f.material.authorize(review.challengeId,f.peer,signal);
  const tables=['shared_blob_issuers','shared_blob_bindings','verification_blob_reservations','shared_capacity_reservations','broker_staging_intents'];
  const beforeStage=tables.map(table=>f.database.prepare('SELECT * FROM '+table).all());
  f.database.exec("CREATE TRIGGER corrupt_issuer AFTER INSERT ON shared_blob_issuers BEGIN UPDATE shared_blob_issuers SET record_hash='corrupt' WHERE resource_id=new.resource_id; END");
  await expect(f.material.stage({grantHandle:grant,invocation},f.peer,signal)).rejects.toThrow('blob_issuer_changed');
  for(const [index,table] of tables.entries())expect(f.database.prepare('SELECT * FROM '+table).all()).toEqual(beforeStage[index]);
  expect(f.database.inTransaction).toBe(false);
 }finally{f.database.exec('DROP TRIGGER IF EXISTS corrupt_issuer');await f.close();}
});
