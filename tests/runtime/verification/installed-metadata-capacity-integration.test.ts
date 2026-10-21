import {installedControllerFixture,installedControllerStartupFixture} from '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import * as sharedModule from '../../../src/runtime/verification/installed-shared-capacity.js';
import * as metadataModule from '../../../src/runtime/verification/installed-metadata-capacity.js';
import * as metadataProtocol from '../../../src/runtime/verification/metadata-capacity-protocol.js';
import * as metadataDispatch from '../../../src/runtime/verification/capacity-ledger-command-dispatch.js';
import * as publicModule from '../../../src/runtime/verification/controller-public-daemon.js';
import {isInstalledControllerShutdownUnresolved} from '../../../src/runtime/verification/installed-controller.js';
import {parseMetadataCapacityAllocation} from '../../../src/runtime/verification/metadata-capacity-protocol.js';
import {createInstalledMetadataCapacity} from '../../../src/runtime/verification/installed-metadata-capacity.js';
import {createInstalledControllerMetadataSource,readInstalledMetadataSource} from '../../../src/runtime/verification/installed-metadata-source.js';
/** Observe the original zero-argument start's object; never replace its issuer. */
async function fixture(existingRoot?:string){
 const spy=vi.spyOn(sharedModule,'createInstalledSharedCapacity');
 try{const actual=await installedControllerFixture(existingRoot?{existingRoot,recoveryOnly:true}:{}),shared=spy.mock.results.at(-1)!.value as ReturnType<typeof sharedModule.createInstalledSharedCapacity>;return {...actual,shared};}finally{spy.mockRestore();}
}
async function seedSessions(f:Awaited<ReturnType<typeof fixture>>){
 const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'r.txt',sha256:'a'.repeat(64),structure:'utf8' as const}]},registration={migrationEpoch:1,obligations:[{obligation:{obligationId:'o',predicateId:'p',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:createHash('sha256').update(json(recipe)).digest('hex'),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner' as const}};
 const enrollment={ownerKind:'task' as const,ownerId:'metadata-owner',invocations:Array.from({length:20},(_,n)=>({sessionIdentity:'session-'+n,compoundOperationId:'op',validationInvocationId:'v'}))};
 const challenge=f.composition.privateHost.enrollment.prepare({enrollment,registration},f.peer);await f.composition.privateHost.enrollment.authorize(challenge.challengeId,f.peer,new AbortController().signal);
}
function capacityRows(f:Pick<Awaited<ReturnType<typeof fixture>>,'database'>){return Object.fromEntries(['shared_capacity_reservations','shared_capacity_session_attributions','controller_metadata_resources','controller_metadata_intents'].map(table=>[table,f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}
function bootState(f:Awaited<ReturnType<typeof fixture>>,resourceId:string){
 const row=f.database.prepare('SELECT revision,record_json FROM controller_metadata_resources WHERE resource_id=?').get(resourceId) as {revision:number;record_json:string};expect(row.revision).toBeGreaterThan(0);
 const allocation=parseMetadataCapacityAllocation(JSON.parse(row.record_json));expect(allocation.state).toBe('confirmed');expect(allocation.resourceRevision).toBe(row.revision);expect(allocation.writerGeneration).toBe(f.lifetime.serviceEpoch);const rows=capacityRows(f),counts={reservations:rows.shared_capacity_reservations.length,intents:rows.controller_metadata_intents.length,resources:rows.controller_metadata_resources.length,attributions:rows.shared_capacity_session_attributions.length},partitions=f.database.prepare('SELECT partition_name,COUNT(*) n FROM shared_capacity_reservations GROUP BY partition_name ORDER BY partition_name').all() as Array<{partition_name:string;n:number}>;expect(counts.reservations).toBe(2);expect(counts.resources).toBe(1);return {revision:row.revision,allocation,rows,counts,partitions};
}
// Postboot growth uses the real confirmed baseline; this does not cover zero-resource startup allocation (R815-G1 OPEN).
it('uses the original shared ledger for an atomic controller DB and rollback batch, with exact intent replay',async()=>{
 const f=await fixture(),capacity=f.shared.capacity;try{
  const source=createInstalledControllerMetadataSource(f.lifetime),facts=readInstalledMetadataSource(source,f.database,'authority'),boot=bootState(f,facts.resourceId);
  const request={requestId:'request',resourceId:facts.resourceId,expectedRevision:boot.revision,minimumPageCount:boot.allocation.chargedMaximumPageCount+1};
  const result=capacity.prepareControllerMetadata(source,request);expect(result.state).toBe('prepared');expect(result.resourceRevision).toBe(boot.revision+1);expect(result.usableMaximumPageCount).toBeGreaterThanOrEqual(request.minimumPageCount);expect(capacity.prepareControllerMetadata(source,request)).toEqual(result);
  expect(f.database.prepare("SELECT partition_name,COUNT(*) n FROM shared_capacity_reservations GROUP BY partition_name ORDER BY partition_name").all()).toEqual(boot.partitions.map(row=>({...row,n:row.n+1})));expect(()=>capacity.prepareControllerMetadata({},request)).toThrow();expect(()=>capacity.prepareControllerMetadata(source,{...request,requestId:'other'})).toThrow('metadata_capacity_revision');
 }finally{await f.close();}
});
// Exercise a real postboot growth rollback and preserve boot rows; cold-initial allocation rollback remains R815-G1 OPEN.
it('rolls back original shared allocations when metadata intent commit fails and applies only the actual connection cap',async()=>{
 const f=await fixture(),capacity=f.shared.capacity;try{
  const source=createInstalledControllerMetadataSource(f.lifetime),facts=readInstalledMetadataSource(source,f.database,'authority'),boot=bootState(f,facts.resourceId),request={requestId:'request',resourceId:facts.resourceId,expectedRevision:boot.revision,minimumPageCount:boot.allocation.chargedMaximumPageCount+1};let failuresReached=0;
  f.database.function('metadata_failure_reached',()=>{failuresReached++;return 0;});f.database.exec("CREATE TRIGGER reject_metadata BEFORE INSERT ON controller_metadata_intents BEGIN SELECT metadata_failure_reached();SELECT RAISE(ABORT,'metadata fail'); END");
  expect(()=>capacity.prepareControllerMetadata(source,request)).toThrow('metadata fail');expect(failuresReached).toBe(1);expect(capacityRows(f)).toEqual(boot.rows);expect(f.database.pragma('max_page_count',{simple:true})).toBe(boot.allocation.usableMaximumPageCount);
  f.database.exec('DROP TRIGGER reject_metadata');const prepared=capacity.prepareControllerMetadata(source,request);expect(prepared.resourceRevision).toBe(boot.revision+1);expect(()=>capacity.applyControllerMetadata(source,{requestId:request.requestId,resourceId:request.resourceId,intentId:prepared.intentId,allocationDigest:'f'.repeat(64)})).toThrow();const confirmed=capacity.applyControllerMetadata(source,{requestId:request.requestId,resourceId:request.resourceId,intentId:prepared.intentId,allocationDigest:prepared.allocationDigest});expect(confirmed.state).toBe('confirmed');expect(f.database.pragma('max_page_count',{simple:true})).toBe(confirmed.usableMaximumPageCount);expect(capacity.prepareControllerMetadata(source,request)).toEqual(confirmed);expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:boot.counts.reservations+2});
 }finally{await f.close();}
});
it('initializes the actual installed shared owner idempotently and recovers an old writer preparation without refund',async()=>{
 let f=await fixture(),metadata=createInstalledMetadataCapacity({lifetime:f.lifetime,sharedCapacity:f.shared});
 try{const first=metadata.initializeController();expect(first.state).toBe('confirmed');expect(metadata.initializeController()).toEqual(first);expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:2});
  const root=f.root;metadata.close();await f.close(true);f=await fixture(root);
  const source=createInstalledControllerMetadataSource(f.lifetime),facts=readInstalledMetadataSource(source,f.database,'authority');const reopened=bootState(f,facts.resourceId);expect(reopened.revision).toBeGreaterThan(first.resourceRevision);const held=f.shared.capacity.prepareControllerMetadata(source,{requestId:'unfinished',resourceId:facts.resourceId,expectedRevision:reopened.revision,minimumPageCount:32});expect(held.state).toBe('prepared');expect(held.writerGeneration).toBe(f.lifetime.serviceEpoch);
  await f.close(true);f=await fixture(root);metadata=createInstalledMetadataCapacity({lifetime:f.lifetime,sharedCapacity:f.shared});const recovered=metadata.initializeController();expect(recovered.state).toBe('confirmed');expect(recovered.resourceRevision).toBeGreaterThan(held.resourceRevision);expect(recovered.writerGeneration).toBe(f.lifetime.serviceEpoch);expect(f.database.prepare("SELECT COUNT(*) n FROM shared_capacity_reservations WHERE state='released'").get()).toEqual({n:0});expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:2});
 }finally{metadata.close();await f.close();}
});
it('reserves actual intent and ledger growth before applying the cap at a physical block boundary',async()=>{
 const f=await fixture(),capacity=f.shared.capacity;
 try{await seedSessions(f);const source=createInstalledControllerMetadataSource(f.lifetime),initialFacts=readInstalledMetadataSource(source,f.database,'authority'),boot=bootState(f,initialFacts.resourceId);expect(boot.allocation.usableMaximumPageCount).toBe(3840);const starts:Array<{reservations:number;intents:number;resources:number;attributions:number}>=[];f.database.function('record_metadata_growth',(reservations:number,intents:number,resources:number,attributions:number)=>{starts.push({reservations,intents,resources,attributions});return 0;});f.database.exec('CREATE TRIGGER observe_metadata_growth BEFORE INSERT ON shared_capacity_reservations BEGIN SELECT record_metadata_growth((SELECT COUNT(*) FROM shared_capacity_reservations),(SELECT COUNT(*) FROM controller_metadata_intents),(SELECT COUNT(*) FROM controller_metadata_resources),(SELECT COUNT(*) FROM shared_capacity_session_attributions)); END');f.database.exec('CREATE TABLE boundary_padding(value BLOB)');const insert=f.database.prepare('INSERT INTO boundary_padding VALUES(zeroblob(4000))');f.database.transaction(()=>{while((f.database.pragma('page_count',{simple:true}) as number)<3840)insert.run();})();const facts=readInstalledMetadataSource(source,f.database,'authority');expect(facts.pageCount).toBe(3840);const prepared=capacity.prepareControllerMetadata(source,{requestId:'boundary',resourceId:facts.resourceId,expectedRevision:boot.revision,minimumPageCount:facts.pageCount});expect(prepared.resourceRevision).toBe(boot.revision+1);expect(facts.beneficiaries).toHaveLength(20);expect(starts).toEqual([{reservations:boot.counts.reservations,intents:boot.counts.intents,resources:boot.counts.resources,attributions:boot.counts.attributions+facts.beneficiaries.length*2},{reservations:boot.counts.reservations+1,intents:boot.counts.intents,resources:boot.counts.resources,attributions:boot.counts.attributions+facts.beneficiaries.length*3}]);expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:boot.counts.reservations+2});expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_session_attributions').get()).toEqual({n:boot.counts.attributions+facts.beneficiaries.length*4});expect(()=>capacity.applyControllerMetadata(source,{requestId:'boundary',resourceId:facts.resourceId,intentId:prepared.intentId,allocationDigest:prepared.allocationDigest})).not.toThrow();expect(f.database.pragma('page_count',{simple:true})).toBeLessThanOrEqual(prepared.usableMaximumPageCount);}finally{await f.close();}
});

it.each(['usable','legacy-charged','failed-growth'] as const)('handles actual confirmed cap growth with no uncharged space: %s',async mode=>{
 const f=await fixture(),capacity=f.shared.capacity;
 try{await seedSessions(f);const source=createInstalledControllerMetadataSource(f.lifetime),facts=readInstalledMetadataSource(source,f.database,'authority'),boot=bootState(f,facts.resourceId);const first=capacity.prepareControllerMetadata(source,{requestId:'initial',resourceId:facts.resourceId,expectedRevision:boot.revision,minimumPageCount:facts.pageCount});expect(first.resourceRevision).toBe(boot.revision+1);expect(first.chargedMaximumPageCount-first.usableMaximumPageCount).toBe(1024**2/first.pageSize);capacity.applyControllerMetadata(source,{requestId:'initial',resourceId:facts.resourceId,intentId:first.intentId,allocationDigest:first.allocationDigest});const fillPages=mode==='legacy-charged'?first.chargedMaximumPageCount:first.usableMaximumPageCount;if(mode==='legacy-charged')f.database.pragma('max_page_count='+fillPages);let failedGrowthReached=0;f.database.function('failed_growth_reached',()=>{failedGrowthReached++;return 0;});if(mode==='failed-growth')f.database.exec("CREATE TRIGGER reject_growth BEFORE INSERT ON controller_metadata_intents WHEN NEW.request_id='growth' BEGIN SELECT failed_growth_reached();SELECT RAISE(ABORT,'rejected growth'); END");f.database.exec('CREATE TABLE confirmed_padding(value BLOB)');const insert=f.database.prepare('INSERT INTO confirmed_padding VALUES(zeroblob(4000))');f.database.transaction(()=>{while((f.database.pragma('page_count',{simple:true}) as number)<fillPages)insert.run();})();expect(f.database.pragma('page_count',{simple:true})).toBe(fillPages);const beforeGrowth=capacityRows(f);const grow=()=>capacity.prepareControllerMetadata(source,{requestId:'growth',resourceId:facts.resourceId,expectedRevision:first.resourceRevision,minimumPageCount:fillPages+1});if(mode==='usable'){const grown=grow();expect(grown.resourceRevision).toBe(first.resourceRevision+1);expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:boot.counts.reservations+2});expect(grown.usableMaximumPageCount).toBeGreaterThan(fillPages);expect(f.database.pragma('max_page_count',{simple:true})).toBe(grown.usableMaximumPageCount);}else{expect(grow).toThrow(mode==='legacy-charged'?'metadata_capacity_legacy_headroom':'rejected growth');expect(failedGrowthReached).toBe(mode==='failed-growth'?1:0);expect(capacityRows(f)).toEqual(beforeGrowth);expect(f.database.pragma('max_page_count',{simple:true})).toBe(fillPages);expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:beforeGrowth.shared_capacity_reservations.length});expect(f.database.prepare("SELECT COUNT(*) n FROM controller_metadata_intents WHERE request_id='growth'").get()).toEqual({n:0});expect(f.database.prepare('SELECT COUNT(*) n FROM confirmed_padding').get()).toBeDefined();}}finally{await f.close();}
});


it('inspects and consumes the original fixed metadata command inside the same real SQLite transaction as its writes',async()=>{
 const f=await fixture(),dispatch=await import('../../../src/runtime/verification/capacity-ledger-command-dispatch.js');
 const trace:Array<{step:string;transaction:boolean}>=[],inspect=dispatch.inspectCapacityMetadataCommand,consume=dispatch.executeCapacityMetadataCommand;
 let inspected:Parameters<typeof inspect>|undefined;
 const a=vi.spyOn(dispatch,'inspectCapacityMetadataCommand').mockImplementation((...args)=>{inspected=args;trace.push({step:'inspect',transaction:f.database.inTransaction});return inspect(...args);});
 const b=vi.spyOn(dispatch,'executeCapacityMetadataCommand').mockImplementation((...args)=>{trace.push({step:'consume',transaction:f.database.inTransaction});return consume(...args);});
 try{
  f.database.function('metadata_tx_trace',(step:string)=>{trace.push({step,transaction:f.database.inTransaction});return 0;});
  f.database.exec("CREATE TRIGGER trace_metadata_allocation BEFORE INSERT ON shared_capacity_reservations BEGIN SELECT metadata_tx_trace('allocation'); END;CREATE TRIGGER trace_metadata_intent BEFORE INSERT ON controller_metadata_intents BEGIN SELECT metadata_tx_trace('intent'); END");
  const source=createInstalledControllerMetadataSource(f.lifetime),facts=readInstalledMetadataSource(source,f.database,'authority');
  const resource=f.database.prepare('SELECT revision,record_json FROM controller_metadata_resources WHERE resource_id=?').get(facts.resourceId) as {revision:number;record_json:string};
  const confirmed=JSON.parse(resource.record_json) as {state:string;chargedMaximumPageCount:number};
  expect(resource.revision).toBeGreaterThan(0);expect(confirmed.state).toBe('confirmed');
  const originalReservations=f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get() as {n:number};expect(originalReservations).toEqual({n:2});
  const request={requestId:'transaction-order',resourceId:facts.resourceId,expectedRevision:resource.revision,minimumPageCount:confirmed.chargedMaximumPageCount+1};
  expect(()=>f.shared.capacity.prepareControllerMetadata(source,{...request,expectedRevision:0})).toThrow('metadata_capacity_revision');
  expect(trace).toEqual([]);expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual(originalReservations);
  f.shared.capacity.prepareControllerMetadata(source,request);
  expect(trace.map(t=>t.step)).toEqual(['inspect','allocation','allocation','consume','intent']);expect(trace.every(t=>t.transaction)).toBe(true);expect(f.database.inTransaction).toBe(false);
  const [command,ledger]=inspected!,actual=ledger as {reserveMetadataCommand(command:object):unknown};
  expect(()=>actual.reserveMetadataCommand({...command})).toThrow('capacity_metadata_command_brand');
  expect(()=>actual.reserveMetadataCommand(command)).toThrow('capacity_metadata_command_consumed');
  expect(()=>f.database.transaction(()=>actual.reserveMetadataCommand({})).immediate()).toThrow('shared_capacity_reentrant_transaction');
  expect(f.database.prepare('SELECT COUNT(*) n FROM shared_capacity_reservations').get()).toEqual({n:originalReservations.n+2});expect(f.database.inTransaction).toBe(false);
 }finally{a.mockRestore();b.mockRestore();await f.close();}
});

it.each(['confirmed','intent-failure'] as const)('cold initial metadata allocation precedes public readiness through the same original startup: %s',async mode=>{
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const sharedSpy=vi.spyOn(sharedModule,'createInstalledSharedCapacity');
 let f:Awaited<ReturnType<typeof installedControllerStartupFixture>>|undefined;
 const observers:Array<{mockRestore():void}>=[];
 const transactionEntries:boolean[]=[],failureSnapshots:Array<{reservations:number;resources:number;intents:number;publicCalls:number}>=[];
 let qualificationCalls=0,publicCalls=0,failuresReached=0;
 let primary:{error:unknown}|undefined,originalSqlFailure:{error:unknown}|undefined;
 let expectedStartupFailure:unknown,knownClosed=false;
 try{
  f=await installedControllerStartupFixture({onQualified(){qualificationCalls++;enter();return gate;}});
  const actual=f,startupCandidate=actual.startupPromise;
  if(!startupCandidate)throw Error('cold_fixture_startup_promise_missing');
  const startup=startupCandidate;
  await Promise.race([entered,startup.then(()=>{throw Error('cold_fixture_qualification_gate_not_reached');})]);
  expect(qualificationCalls).toBe(1);expect(sharedSpy).toHaveBeenCalledTimes(1);
  const sharedResult=sharedSpy.mock.results[0];
  if(sharedResult?.type!=='return'||!sharedResult.value)throw Error('cold_fixture_actual_shared_owner_missing');
  const shared=sharedResult.value as ReturnType<typeof sharedModule.createInstalledSharedCapacity>;
  const zero=capacityRows(actual);expect(Object.values(zero).map(rows=>rows.length)).toEqual([0,0,0,0]);
  const requests:Array<ReturnType<typeof metadataProtocol.parseMetadataCapacityPrepare>>=[];
  const parse=metadataProtocol.parseMetadataCapacityPrepare;
  observers.push(vi.spyOn(metadataProtocol,'parseMetadataCapacityPrepare').mockImplementation(raw=>{const request=parse(raw);requests.push(request);return request;}));
  const schema=()=>actual.database.prepare('SELECT type,name,tbl_name,sql FROM main.sqlite_master ORDER BY type,name').all();
  let before:{rows:ReturnType<typeof capacityRows>;cap:unknown;pages:unknown;schema:unknown}|undefined;
  const createMetadata=metadataModule.createInstalledMetadataCapacity;
  observers.push(vi.spyOn(metadataModule,'createInstalledMetadataCapacity').mockImplementation(input=>{
   const owner=createMetadata(input);expect(input.lifetime).toBe(actual.lifetime);expect(input.sharedCapacity).toBe(shared);
   expect(before).toBeUndefined();before={rows:capacityRows(actual),cap:actual.database.pragma('max_page_count',{simple:true}),pages:actual.database.pragma('page_count',{simple:true}),schema:schema()};
   expect(before.rows).toEqual(zero);return owner;
  }));
  const execute=metadataDispatch.executeCapacityMetadataCommand;
  observers.push(vi.spyOn(metadataDispatch,'executeCapacityMetadataCommand').mockImplementation((...args)=>{
   transactionEntries.push(actual.database.inTransaction);
   try{return execute(...args);}catch(error){originalSqlFailure={error};throw error;}
  }));
  const startPublic=publicModule.startPublicController;
  observers.push(vi.spyOn(publicModule,'startPublicController').mockImplementation(input=>{
   publicCalls++;expect(mode).toBe('confirmed');expect(requests).toHaveLength(1);expect(requests[0]!.expectedRevision).toBe(0);
   const row=actual.database.prepare('SELECT revision,record_json FROM controller_metadata_resources').get() as {revision:number;record_json:string};
   const allocation=parseMetadataCapacityAllocation(JSON.parse(row.record_json));
   expect(row.revision).toBe(1);expect(allocation.state).toBe('confirmed');expect(allocation.resourceRevision).toBe(1);expect(allocation.writerGeneration).toBe(actual.lifetime.serviceEpoch);
   expect(actual.database.pragma('max_page_count',{simple:true})).toBe(allocation.usableMaximumPageCount);
   expect(capacityRows(actual).shared_capacity_reservations).toHaveLength(2);expect(capacityRows(actual).controller_metadata_intents).toHaveLength(1);
   return startPublic(input);
  }));
  if(mode==='intent-failure'){
   actual.database.function('metadata_failure_reached',(reservations:number,resources:number,intents:number)=>{
    failuresReached++;failureSnapshots.push({reservations,resources,intents,publicCalls});return 0;
   });
   // The original SQL fault follows the original allocation/resource writes.
   actual.database.exec("CREATE TRIGGER reject_metadata BEFORE INSERT ON controller_metadata_intents BEGIN SELECT metadata_failure_reached((SELECT COUNT(*) FROM shared_capacity_reservations),(SELECT COUNT(*) FROM controller_metadata_resources),(SELECT COUNT(*) FROM controller_metadata_intents));SELECT RAISE(ABORT,'metadata fail'); END");
  }
  release();
  if(mode==='confirmed'){
   const installed=await startup;expect(publicCalls).toBe(1);expect(before).toBeDefined();
   expect(sharedSpy).toHaveBeenCalledTimes(1);expect(originalSqlFailure).toBeUndefined();
   expect(actual.startupPromise).toBe(startup);await actual.close(true);expect(actual.database.open).toBe(false);knownClosed=true;
   // close() joined that exact result, not a second start or replacement owner.
   expect(await startup).toBe(installed);
  }else{
   let rejected:{error:unknown}|undefined;try{await startup;}catch(error){rejected={error};}
   expect(failuresReached).toBe(1);expect(requests).toHaveLength(1);expect(requests[0]!.expectedRevision).toBe(0);
   expect(transactionEntries).toEqual([true]);expect(failureSnapshots).toEqual([{reservations:2,resources:1,intents:0,publicCalls:0}]);
   expect(rejected).toBeDefined();expect(originalSqlFailure).toBeDefined();expect(rejected!.error).toBe(originalSqlFailure!.error);
   expect(rejected!.error).toMatchObject({message:'metadata fail'});expect(isInstalledControllerShutdownUnresolved(rejected!.error)).toBe(false);expect(publicCalls).toBe(0);
   if(!before)throw Error('cold_fixture_initialization_not_observed');
   // Read the actual connection cap before closing; a reopened connection has
   // its own max_page_count and must not stand in for this rollback proof.
   expect(actual.database.open).toBe(true);expect(capacityRows(actual)).toEqual(before.rows);expect(actual.database.inTransaction).toBe(false);
   expect(actual.database.pragma('max_page_count',{simple:true})).toBe(before.cap);expect(actual.database.pragma('page_count',{simple:true})).toBe(before.pages);expect(schema()).toEqual(before.schema);
   expectedStartupFailure=rejected!.error;
   await expect(actual.close(true)).rejects.toBe(expectedStartupFailure);expect(actual.database.open).toBe(false);knownClosed=true;
   const NativeDatabase=createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
   const reopened=new NativeDatabase(join(actual.state,'authority.sqlite'),{readonly:true,fileMustExist:true});
   try{expect(reopened.readonly).toBe(true);expect(capacityRows({database:reopened})).toEqual(before.rows);expect(reopened.prepare('SELECT type,name,tbl_name,sql FROM main.sqlite_master ORDER BY type,name').all()).toEqual(before.schema);expect(reopened.pragma('page_count',{simple:true})).toBe(before.pages);}
   finally{reopened.close();}
  }
 }catch(error){primary={error};throw error;}
 finally{
  release();const errors:unknown[]=[];
  if(f)try{await f.close(true);knownClosed=!f.database.open;}catch(error){
   if(error===expectedStartupFailure&&!f.database.open&&!isInstalledControllerShutdownUnresolved(error))knownClosed=true;else errors.push(error);
  }
  for(const observer of observers.reverse())observer.mockRestore();sharedSpy.mockRestore();
  if(f&&knownClosed&&!errors.length)rmSync(f.root,{recursive:true,force:true});
  if(errors.length)throw new AggregateError([...(primary?[primary.error]:[]),...errors],'cold_fixture_cleanup_unknown',{cause:primary?.error});
 }
});
