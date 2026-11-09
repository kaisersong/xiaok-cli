import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {rmSync,statSync,readFileSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {compileBrokerCustody,createOriginalBrokerRoom} from '../../support/broker-room-source-fixture.js';
import {startProfileSourceCapture,readProfileSqliteLosslessRows,type ProfileCaptureSource} from '../../../src/runtime/verification/profile-source-capture.js';
const environment=await vi.hoisted(async()=>{
 const {mkdtempSync,realpathSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-broker-room-'))),originalConfig=process.env.XIAOK_CONFIG_DIR;
 process.env.XIAOK_CONFIG_DIR=join(root,'config');return {root,originalConfig};
});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
const {root}=environment;
let helpers:ReturnType<typeof compileBrokerCustody>;
beforeAll(()=>{helpers=compileBrokerCustody(root);},40000);
afterAll(()=>{if(environment.originalConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=environment.originalConfig;rmSync(root,{recursive:true,force:true});});
async function reader(){return (await import('../../../src/runtime/verification/captured-sqlite-broker-room.js')).iterateCapturedSQLiteBrokerRoomSources;}
function change(file:string,fn:(db:Database.Database)=>void){const db=new Database(file);try{fn(db);}finally{db.close();}}
async function held(files:string[],run:(owner:Awaited<ReturnType<typeof startProfileSourceCapture>>,token:object)=>unknown|Promise<unknown>){
 const sources=files.map((file,index)=>{const directory=statSync(dirname(file),{bigint:true}),db=statSync(file,{bigint:true});return {sourceId:'broker-'+index,kind:'sqlite-db',snapshotFormat:'broker-room-sqlite-v1',directory:{canonicalPath:dirname(file),device:String(directory.dev),inode:String(directory.ino)},database:{basename:basename(file),device:String(db.dev),inode:String(db.ino)}};}) as unknown as ProfileCaptureSource[];
 const owner=await startProfileSourceCapture({uid:process.getuid!(),...helpers,sources,signal:new AbortController().signal});
 try{return await run(owner,await owner.capture());}finally{await owner.close();}
}
it.each([8,9] as const)('captures actual combined Broker v%s and every original table row',async version=>{
 const file=createOriginalBrokerRoom(root,version);
 await held([file],async(owner,token)=>{
  const read=await reader(),events=[...read(owner,token)],rows=events.filter((e:any)=>e.kind==='row'),end=events.at(-1);
  expect(end.kind).toBe('complete');expect([...read(owner,token)]).toEqual(events);
  change(file,db=>{
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[];
   expect(tables).toHaveLength(version===8?22:25);
   for(const {name}of tables){
    const original=db.prepare('SELECT rowid AS original_rowid,* FROM "'+name+'" ORDER BY rowid').safeIntegers(true).all() as Record<string,unknown>[];
    expect(rows.filter((e:any)=>e.table===name).map((e:any)=>({rowid:e.rowid,record:e.record}))).toEqual(original.map(({original_rowid,...record})=>({rowid:String(original_rowid),record:Object.fromEntries(Object.entries(record).map(([key,value])=>{
     if(value===null)return [key,{type:'null'}];if(typeof value==='string')return [key,{type:'text',value}];if(typeof value==='bigint')return [key,{type:'integer',value:String(value)}];if(Buffer.isBuffer(value))return [key,{type:'blob',value:value.toString('base64')}];const bytes=Buffer.alloc(8);bytes.writeDoubleBE(value as number);return [key,{type:'real',value:bytes.toString('hex')}];
    }))})));
   }
  });
  expect(rows.some((e:any)=>e.table==='events')).toBe(true);
  if(version===9){expect(rows.filter((e:any)=>e.table==='room_admission_receipts')).toHaveLength(2);expect(rows.filter((e:any)=>e.table==='room_admission_heads')).toHaveLength(1);}
 });
});
it.each(['extra-table','missing-table','extra-column','trigger','schema-version'] as const)('rejects %s without changing the original DB',async fault=>{
 const file=createOriginalBrokerRoom(root,9);change(file,db=>{
  if(fault==='extra-table')db.exec('CREATE TABLE hidden_authority(x)');
  if(fault==='missing-table')db.exec('DROP TABLE participant_roles');
  if(fault==='extra-column')db.exec('ALTER TABLE rooms ADD COLUMN hidden');
  if(fault==='trigger')db.exec('DROP TRIGGER room_admission_receipts_update');
  if(fault==='schema-version')db.exec('INSERT INTO room_schema_version VALUES(10)');
 });const before=readFileSync(file);
 await held([file],async(owner,token)=>{const read=await reader(),kinds:string[]=[];expect(()=>{for(const e of read(owner,token))kinds.push(e.kind);}).toThrow();expect(kinds).not.toContain('complete');});expect(readFileSync(file)).toEqual(before);
});
it('does not conflate same IDs across two physical Broker databases',async()=>{
 await held([createOriginalBrokerRoom(root,9),createOriginalBrokerRoom(root,9)],async(owner,token)=>{
  const events=[...(await reader())(owner,token)];expect(events.filter((e:any)=>e.kind==='source-end')).toHaveLength(2);
  const rows=events.filter((e:any)=>e.kind==='row'&&e.table==='rooms');expect(rows).toHaveLength(2);expect(rows[0].sourceId).not.toBe(rows[1].sourceId);
 });
});
it('rejects foreign capture identities, closes early iterators and refuses cross-format queries',async()=>{
 await held([createOriginalBrokerRoom(root,9)],async(owner,token)=>{
  const read=await reader();expect(()=>[...read({...owner},token)]).toThrow();expect(()=>[...read(owner,{...token})]).toThrow();
  const iterator=read(owner,token);iterator.next();iterator.next();iterator.return();expect([...read(owner,token)].at(-1).kind).toBe('complete');
  expect(()=>[...readProfileSqliteLosslessRows(owner,token,'broker-0','state_entities')]).toThrow('query_format');
  await owner.close();expect(()=>[...read(owner,token)]).toThrow();
 });
});
it.each(['UTF-8','UTF-16le','UTF-16be'])('preserves %s original TEXT/BLOB/INTEGER/REAL cells without JSON interpretation',async encoding=>{
 const file=createOriginalBrokerRoom(root,9,encoding),raw='{uninterpreted\u0000尾🎈';
 change(file,db=>{
  db.prepare('UPDATE events SET payload_json=?').run(raw);
  db.prepare('UPDATE participant_cursors SET cursor_event_id=?').run(9007199254740993n);
  db.exec('INSERT INTO room_sequences(room_id,last_sequence) VALUES(\'real\',1.25)');
  db.prepare('UPDATE participant_cursors SET updated_at=?').run(Buffer.from('same-text'));
 });
 await held([file],async(owner,token)=>{
  const rows=[...(await reader())(owner,token)].filter(e=>e.kind==='row');
  expect(rows.find(e=>e.table==='events')!.record.payload_json).toEqual({type:'text',value:raw});
  const cursor=rows.find(e=>e.table==='participant_cursors')!;
  expect(cursor.record.cursor_event_id).toEqual({type:'integer',value:'9007199254740993'});
  expect(cursor.record.updated_at).toEqual({type:'blob',value:Buffer.from('same-text').toString('base64')});
  const bytes=Buffer.alloc(8);bytes.writeDoubleBE(1.25);expect(rows.find(e=>e.table==='room_sequences')!.record.last_sequence).toEqual({type:'real',value:bytes.toString('hex')});
 });
});
it('reads actual RoomStore WAL commits while its original writer stays open',async()=>{
 const file=createOriginalBrokerRoom(root,9),{createRoomStore}=await import(/* @vite-ignore */pathToFileURL(resolve('../intent-broker/src/room/store.js')).href);
 const store=createRoomStore({dbPath:file});
 try{
  expect(store.db.prepare('PRAGMA journal_mode=WAL').get().journal_mode).toBe('wal');
  store.insertRoom({roomId:'latest',title:'WAL latest',description:'',status:'active',origin:'user_created',createdBy:{kind:'user',userId:'user'},revision:1,discussionEpoch:0,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  const before=readFileSync(file+'-wal');expect(before.length).toBeGreaterThan(0);
  await held([file],async(owner,token)=>{const rows=[...(await reader())(owner,token)].filter(e=>e.kind==='row'&&e.table==='rooms');expect(rows.some(e=>e.record.room_id?.type==='text'&&e.record.room_id.value==='latest')).toBe(true);});
  expect(readFileSync(file+'-wal')).toEqual(before);expect(store.db.prepare('SELECT title FROM rooms WHERE room_id=?').get('latest').title).toBe('WAL latest');
 }finally{store.close();}
});
it('rejects caller SQL and keeps the schema/query manifests deeply immutable',async()=>{
 const manifest=await import('../../../src/runtime/verification/broker-room-source-schema.js');
 expect(Object.isFrozen(manifest.BROKER_ROOM_LAYOUTS)).toBe(true);expect(Object.isFrozen(manifest.BROKER_ROOM_LAYOUTS[0].schema[0])).toBe(true);
 expect(Object.isFrozen(manifest.BROKER_ROOM_COLUMNS.rooms![0])).toBe(true);expect(Object.isFrozen(manifest.BROKER_ROOM_QUERIES['brokerRoom:rooms'].columns)).toBe(true);
 await held([createOriginalBrokerRoom(root,9)],(owner,token)=>expect(()=>[...readProfileSqliteLosslessRows(owner,token,'broker-0','brokerRoom:rooms;DROP TABLE events' as never)]).toThrow('source_sqlite_query'));
});
it('binds the complete event stream and source identity into its framed digest',async()=>{
 const {canonicalVerificationJson}=await import('../../../src/runtime/verification/protocol.js');
 await held([createOriginalBrokerRoom(root,8),createOriginalBrokerRoom(root,9)],async(owner,token)=>{
  const events=[...(await reader())(owner,token)],hash=createHash('sha256').update('xiaok-broker-room-declarations-v1\0');
  for(const event of events.slice(0,-1)){const bytes=Buffer.from(canonicalVerificationJson(event));hash.update(String(bytes.length)+':').update(bytes);}
  expect(events.at(-1)!.digest).toBe(hash.digest('hex'));expect(events.at(-1)!.sources.map(s=>s.sourceId)).toEqual(['broker-0','broker-1']);
 });
});
it('carries the explicit private registry format through actual review and capture without certifying discovery',async()=>{
 const file=createOriginalBrokerRoom(root,9),{registerOrdinaryProfileSource,readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');
 const {readProfileSourceCapture}=await import('../../../src/runtime/verification/profile-source-capture.js'),{parseProfileSourceReview}=await import('../../../src/runtime/verification/profile-source-review.js'),{canonicalVerificationJson}=await import('../../../src/runtime/verification/protocol.js');
 registerOrdinaryProfileSource({kind:'sqlite-db',directory:dirname(file),databaseBasename:basename(file),snapshotFormat:'broker-room-sqlite-v1'});
 const registry=readOrdinaryProfileSources()!,source=registry.sources.find(s=>s.directory.canonicalPath===dirname(file))!;
 if(source.kind!=='sqlite-db'||source.snapshotFormat!=='broker-room-sqlite-v1'||!source.database)throw Error('broker_registry_fixture');
 const descriptor:ProfileCaptureSource={sourceId:source.sourceId,kind:'sqlite-db',snapshotFormat:source.snapshotFormat,directory:source.directory,database:source.database};
 const owner=await startProfileSourceCapture({uid:process.getuid!(),...helpers,sources:[descriptor],signal:new AbortController().signal});
 try{
  const token=await owner.capture(),facts=readProfileSourceCapture(owner,token),sourceSet={schemaVersion:1,authorityId:'authority',profileId:'profile',uid:process.getuid!(),accountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',inventoryGeneration:registry.generation,sources:[{...descriptor,namespaceId:source.namespaceId,reviewedSnapshotSha256:facts.sources[0]!.snapshotHash}]};
  const review=parseProfileSourceReview({version:1,purpose:'profile-source-custody',authorityId:'authority',challengeId:'challenge',principal:{uid:process.getuid!(),accountGeneration:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',auditSessionId:2},requestSource:'user',sourceSet,inventoryHash:createHash('sha256').update(canonicalVerificationJson(sourceSet)).digest('hex'),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}});
  expect(review.sourceSet.sources[0]!.snapshotFormat).toBe('broker-room-sqlite-v1');expect([...(await reader())(owner,token)].at(-1)!.kind).toBe('complete');expect(registry.legacyInventoryRequired).toBe(true);
 }finally{await owner.close();}
});
it('maps every original Broker cell as an explicit unresolved semantic slot',async()=>{
 const {iterateCapturedProfileDeclarations}=await import('../../../src/runtime/verification/captured-profile-mapper.js');
 await held([createOriginalBrokerRoom(root,9)],async(owner,token)=>{
  const events=[];for await(const event of iterateCapturedProfileDeclarations(owner,token))events.push(event);
  const complete=events.at(-1)!;expect(complete.kind).toBe('complete');
  if(complete.kind!=='complete')throw Error('mapper_fixture');expect(complete.sources.map(s=>s.family)).toEqual(['broker']);
  const facts=events.filter(e=>e.kind==='family-fact'&&(e.fact as any).kind==='row'),expected=facts.reduce((n,e)=>n+Object.values((e as any).fact.record).filter((cell:any)=>cell.type!=='null').length,0);
  expect(complete.gapCount).toBe(expected);expect(complete.verifiedInputSlots).toBe(expected+complete.sources.length);
  expect(complete.relationCount).toBe(complete.sources.length);
  expect(events.some(e=>e.kind==='gap'&&e.origin.path.endsWith('.data_json'))).toBe(true);
 });
});
it('rejects actual mapper output that silently drops an original nonnull Broker cell',async()=>{
 const {iterateCapturedProfileDeclarations}=await import('../../../src/runtime/verification/captured-profile-mapper.js'),{CapturedProfileRelations}=await import('../../../src/runtime/verification/captured-profile-relations.js');
 const original=CapturedProfileRelations.prototype.complex;let dropped=false;
 await held([createOriginalBrokerRoom(root,9)],async(owner,token)=>{
  const spy=vi.spyOn(CapturedProfileRelations.prototype,'complex').mockImplementation(function(value,origin){if(!dropped&&origin.path.endsWith('.title')){dropped=true;return;}return original.call(this,value,origin);});
  try{await expect((async()=>{for await(const _event of iterateCapturedProfileDeclarations(owner,token)){/* Consume the actual production mapper. */}})()).rejects.toThrow('captured_profile_unprojected_slot');expect(dropped).toBe(true);}finally{spy.mockRestore();}
 });
});
