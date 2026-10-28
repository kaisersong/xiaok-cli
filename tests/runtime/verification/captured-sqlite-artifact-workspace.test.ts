import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import Database from 'better-sqlite3';
const discovery=vi.hoisted(()=>({home:'',route:'ordinary',failSync:false}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:discovery.home})};});
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return {...actual,fsyncSync:(fd:number)=>{if(discovery.failSync&&actual.fstatSync(fd).isDirectory())throw Error('registry_fsync_fixture');return actual.fsyncSync(fd);}};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:discovery.route})}));
import {ArtifactWorkspaceStore} from '../../../desktop/electron/artifact-workspace-store.js';
import {startProfileSourceCapture,readProfileSourceCapture,readProfileSqliteSchema,type ProfileCaptureSource} from '../../../src/runtime/verification/profile-source-capture.js';

const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-workspace-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
beforeAll(()=>{
 discovery.home=join(root,'account');setProfileTestHome(discovery.home);mkdirSync(discovery.home);
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');
 execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);
},40000);
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function change(path:string,run:(db:Database.Database)=>void){const db=new Database(path);try{run(db);}finally{db.close();}}
function fixture(full=true,encoding?:'UTF-16le'|'UTF-16be'){
 const path=join(mkdtempSync(join(root,'store-')),'arbitrary-workspace.sqlite');let ordinal=0;
 if(encoding)change(path,db=>{db.pragma("encoding='"+encoding+"'");db.exec('CREATE TABLE encoding_seed(x); DROP TABLE encoding_seed');});
 const store=new ArtifactWorkspaceStore({dbPath:path,now:()=>1700000000000,createId:prefix=>`${prefix}-${++ordinal}`});
 try{
  if(!full)return path;
  const workspace=store.getOrCreateWorkspace({conversationId:'conversation',workspaceRootId:'root'});
  const node=store.createNode({workspaceId:workspace.id,expectedStructureRevision:0,node:{kind:'note',owner:'user',noteText:'history',x:0,y:0,width:1,height:1,zIndex:1.5}}).node;
  const placeholder=store.createNode({workspaceId:workspace.id,expectedStructureRevision:1,node:{kind:'placeholder',placeholderKind:'html',owner:'user',x:0,y:0,width:1,height:1,zIndex:0}}).node;
  store.tombstoneNode({workspaceId:workspace.id,nodeId:node.id,expectedStructureRevision:2});
  store.createRelation({workspaceId:workspace.id,fromNodeId:node.id,toNodeId:placeholder.id,kind:'references',createdBy:'user',order:2.5,expectedStructureRevision:3});
  const base=store.createLineageWithVersion({workspaceId:workspace.id,sourceLocatorHash:'a'.repeat(64),version:{fileRef:'versions/base.md',storageKind:'single_file',sourceKind:'materialized_base',kind:'markdown',checksum:'b'.repeat(64),byteSize:2.5}});
  store.appendVersion({lineageId:base.lineage.id,parentVersionId:base.version.id,version:{fileRef:'versions/new.md',storageKind:'single_file',sourceKind:'workspace_generation',kind:'markdown',checksum:'c'.repeat(64),producingTaskId:'task',sourceArtifactId:'artifact'}});
  const request=store.createGenerationRequest({workspaceId:workspace.id,placeholderNodeId:placeholder.id});
  const lease=store.bindGenerationLease({generationRequestId:request.id,workspaceId:workspace.id,nodeId:placeholder.id,allowedAction:'fulfill_placeholder',requestedKind:'html',producingTaskId:'task',expiresAt:'2099-01-01T00:00:00.000Z'});
  store.cancelLease(lease.id);store.updateGenerationState(request.id,'cancelled');
  store.commitQuarantineArtifact({generationRequestId:request.id,producedArtifactId:'artifact',projectionKind:'task_event',staging:{source:'generation',producingTaskId:'task',availability:'unavailable',owner:'system_staging',quarantineReason:'invalid_artifact_ref',keep:false,expiresAt:'2000-01-01T00:00:00.000Z'}});
  store.recordProjectionReceipt({generationRequestId:'unresolved-history',producedArtifactId:'old-artifact',projectionKind:'startup_reconcile'});
  store.openViewSession({workspaceId:workspace.id,viewKey:'primary'});store.closeViewSession({workspaceId:workspace.id,viewKey:'primary'});
  store.saveView({workspaceId:workspace.id,viewKey:'primary',viewport:{x:Infinity,y:-Infinity,zoom:1}});
  store.saveTaskCursor('fraction',2.5);store.saveTaskCursor('large',2**60);
  store.recordEvent({workspaceId:workspace.id,conversationId:'conversation',eventName:'workspace_opened',metadata:{nested:{values:[1,true]}} as never});
  store.recordAudit({actorId:'actor',actorKind:'user',workspaceId:workspace.id,nodeId:node.id,versionId:base.version.id,action:'test',result:'success',expectedRevision:0.5,actualRevision:1.5});
  return path;
 }finally{store.close();}
}
async function held(paths:string[],run:(owner:Awaited<ReturnType<typeof startProfileSourceCapture>>,token:object)=>void|Promise<void>,sourceIds?:string[]){
 const sources=paths.map((path,index)=>{const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});return {sourceId:sourceIds?.[index]??'source-'+index,kind:'sqlite-db',snapshotFormat:'artifact-workspace-sqlite-v1',directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}};}) as ProfileCaptureSource[];
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});
 try{const token=await owner.capture();await run(owner,token);}finally{await owner.close();}
}
it('seeds all sixteen tables only through the original ArtifactWorkspaceStore',()=>{
 const path=fixture();change(path,db=>{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];expect(tables).toHaveLength(16);for(const {name} of tables)expect((db.prepare('SELECT count(*) AS n FROM "'+name+'"').get() as {n:number}).n,name).toBeGreaterThan(0);});
});
it('matches every schema item and physical column against the actual original constructor',async()=>{
 const {ARTIFACT_WORKSPACE_SOURCE_SCHEMA:expected,ARTIFACT_WORKSPACE_QUERIES:queries}=await import('../../../src/runtime/verification/artifact-workspace-source-schema.js');const path=fixture();
 change(path,db=>{const actual=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all() as {sql:string|null}[];expect(actual.map(row=>({...row,sql:row.sql?.replace(/\s+/g,' ').trim()??null}))).toEqual(expected);
  for(const query of Object.values(queries))expect((db.prepare('PRAGMA table_xinfo("'+query.table+'")').all() as {name:string}[]).map(row=>row.name)).toEqual(query.columns);
 });
});
it('streams every table from original producers with exact stored scalars and declared historical references',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');
 const path=fixture();await held([path],(owner,token)=>{
  const events=[...read(owner,token)],rows=events.filter(e=>e.kind==='row'),end=events.find(e=>e.kind==='source-end')!;
  expect(Object.keys(end.counts)).toHaveLength(16);expect(Object.values(end.counts).every(n=>n>0)).toBe(true);
  const row=(table:string)=>rows.filter(r=>r.table===table);
  expect(row('artifact_workspace_nodes').some(r=>r.record.tombstoned_at?.type==='text')).toBe(true);
  expect(row('artifact_workspace_nodes')[0]!.record.z_index).toEqual({type:'real',value:'3ff8000000000000'});
  expect(row('artifact_workspace_task_cursors').map(r=>r.record.event_index)).toEqual([{type:'real',value:'4004000000000000'},{type:'integer',value:'1152921504606846976'}]);
  expect(row('artifact_workspace_views')[0]!.record.viewport_x).toEqual({type:'real',value:'7ff0000000000000'});
  expect(row('artifact_workspace_views')[0]!.record.viewport_y).toEqual({type:'real',value:'fff0000000000000'});
  expect(row('artifact_workspace_events').at(-1)!.parsedMetadata).toEqual({classification:'uninterpreted-json',raw:'{"nested":{"values":[1,true]}}'});
  expect(row('artifact_workspace_projection_receipts').some(r=>r.references.some(ref=>ref.domain==='generation-request'&&ref.value.type==='text'&&ref.value.value==='unresolved-history'))).toBe(true);
  expect(events.at(-1)!.kind).toBe('complete');expect([...read(owner,token)]).toEqual(events);
  expect(Object.isFrozen(rows[0]!.record)).toBe(true);expect(events.at(-1)).not.toHaveProperty('sessionIdentities');
  change(path,db=>{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];for(const {name} of tables){const count=db.prepare('SELECT count(*) AS n FROM "'+name+'"').get() as {n:number};expect(Object.entries(end.counts).find(([key])=>key===name)?.[1]).toBe(count.n);}});
 });
});
it('retains distinct same-ID physical stores and schema-only empty stores',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');
 await held([fixture(),fixture(),fixture(false)],(owner,token)=>{
  const events=[...read(owner,token)];expect(events.filter(e=>e.kind==='source-start')).toHaveLength(3);
  expect(events.filter(e=>e.kind==='row'&&e.table==='artifact_workspaces')).toHaveLength(2);
  const ends=events.filter(e=>e.kind==='source-end');expect(ends[2]!.counts.artifact_workspace_meta).toBe(1);expect(ends[2]!.counts.artifact_workspaces).toBe(0);
 });
});
it.each(['unknown-table','extra-index','extra-column','missing-meta','foreign-key','bad-json','duplicate-json','invalid-utf8'] as const)('refuses incomplete or corrupt declaration: %s',async mode=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture();
 change(path,db=>{
  if(mode==='unknown-table')db.exec('CREATE TABLE hidden(id TEXT)');
  else if(mode==='extra-index')db.exec('CREATE INDEX hidden ON artifact_workspace_nodes(title)');
  else if(mode==='extra-column')db.exec('ALTER TABLE artifact_workspace_nodes ADD COLUMN hidden TEXT');
  else if(mode==='missing-meta')db.exec('DELETE FROM artifact_workspace_meta');
  else if(mode==='foreign-key'){db.pragma('foreign_keys=OFF');db.exec("UPDATE artifact_workspace_nodes SET workspace_id='missing'");}
  else if(mode==='invalid-utf8')db.exec("UPDATE artifact_workspace_nodes SET note_text=CAST(x'80' AS TEXT)");
  else db.prepare('UPDATE artifact_workspace_events SET metadata_json=?').run(mode==='bad-json'?'{':'{"same":1,"same":2}');
 });
 await held([path],(owner,token)=>{const seen:unknown[]=[];expect(()=>{for(const e of read(owner,token))seen.push(e);}).toThrow();expect(seen.some(e=>(e as {kind:string}).kind==='complete')).toBe(false);});
});
it('preserves original SQLite storage classes without converting untyped values into references',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture();
 change(path,db=>{db.prepare('UPDATE artifact_workspace_task_cursors SET event_index=? WHERE task_id=?').run(Buffer.from([0,255]),'fraction');db.prepare('UPDATE artifact_workspace_nodes SET created_by_task_id=?').run(Buffer.from('opaque'));});
 await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row');expect(rows.find(r=>r.table==='artifact_workspace_task_cursors')!.record.event_index).toEqual({type:'blob',value:'AP8='});expect(rows.find(r=>r.table==='artifact_workspace_nodes')!.references.find(r=>r.column==='created_by_task_id')!.referenceState).toBe('uninterpreted');});
});
it.each(['UTF-16le','UTF-16be'] as const)('reads actual original producer %s text including leading BOM and supplementary Unicode',async encoding=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture(true,encoding),text='\ufeff原文🎈\u0000尾';
 change(path,db=>{expect(db.pragma('encoding',{simple:true})).toBe(encoding);db.prepare('UPDATE artifact_workspace_nodes SET note_text=?').run(text);});
 await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row').filter(e=>e.table==='artifact_workspace_nodes');expect(rows[0]!.record.note_text).toEqual({type:'text',value:text});});
});
it.each(['{"n":9007199254740993}','{"n":1e400}','{"n":2.5}','{"n":1e2}','[1,2]','true'])('retains uninterpreted JSON text without rounded metadata: %s',async raw=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture();change(path,db=>db.prepare('UPDATE artifact_workspace_events SET metadata_json=?').run(raw));
 await held([path],(owner,token)=>{for(const row of read(owner,token))if(row.kind==='row'&&row.table==='artifact_workspace_events')expect(row.parsedMetadata).toEqual({classification:'uninterpreted-json',raw});});
});
it('releases its parser on early return and rejects copied or closed captures',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');
 await held([fixture()],async(owner,token)=>{expect(()=>[...read({...owner},token)]).toThrow('brand');const iterator=read(owner,token);expect(iterator.next().value!.kind).toBe('source-start');expect(iterator.next().value!.kind).toBe('row');iterator.return();expect(readProfileSqliteSchema(owner,token,'source-0')).toHaveLength(37);await owner.close();expect(()=>[...read(owner,token)]).toThrow('closed');});
});
it('uses the original capture UTF-16 source order and does not conflate event correlation with generation references',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const a=fixture(),b=fixture();change(a,db=>db.exec("UPDATE artifact_workspace_events SET request_id='unresolved-history'"));
 await held([a,b],(owner,token)=>{const events=[...read(owner,token)];expect(events.filter(e=>e.kind==='source-start').map(e=>e.sourceId)).toEqual(['\u{10000}','\ue000']);
  const row=events.filter(e=>e.kind==='row').find(e=>e.sourceId==='\ue000'&&e.table==='artifact_workspace_events')!;
  expect(row.references.find(r=>r.column==='request_id')).toEqual({column:'request_id',domain:'request-correlation',value:{type:'text',value:'unresolved-history'},relation:'declared',referenceState:'declared'});
 },['\ue000','\u{10000}']);
});
it('rejects actual index-page corruption with no complete event despite unchanged schema and table rows',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture(),bytes=readFileSync(path),size=bytes.readUInt16BE(16)||65536;let changed=false;
 for(let offset=size;offset<bytes.length;offset+=size){if(bytes[offset]!==10)continue;const at=bytes.indexOf(Buffer.from('conversation'),offset);if(at>=offset&&at+12<=offset+size){bytes.write('ConVersation',at,'utf8');changed=true;break;}}
 expect(changed).toBe(true);writeFileSync(path,bytes);change(path,db=>expect(db.pragma('integrity_check')).not.toEqual([{integrity_check:'ok'}]));
 await held([path],(owner,token)=>{const kinds:string[]=[];expect(()=>{for(const event of read(owner,token))kinds.push(event.kind);}).toThrow('integrity');expect(kinds).not.toContain('complete');});
});
it('retains all three original orphan generation-reference families as declared same-domain references',async()=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture(),store=new ArtifactWorkspaceStore({dbPath:path});
 try{store.commitQuarantineArtifact({generationRequestId:'orphan-generation',producedArtifactId:'orphan-artifact',projectionKind:'startup_reconcile',staging:{source:'generation',producingTaskId:'task',availability:'unavailable',owner:'system_staging',quarantineReason:'invalid_artifact_ref',keep:false,expiresAt:'2000-01-01T00:00:00.000Z'}});}finally{store.close();}
 await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row');for(const table of ['artifact_workspace_projection_receipts','artifact_workspace_artifact_claims','artifact_workspace_staging_files']){
  const row=rows.find(e=>e.table===table&&e.record.generation_request_id?.type==='text'&&e.record.generation_request_id.value==='orphan-generation')!;
  expect(row.references.find(ref=>ref.column==='generation_request_id')).toEqual({column:'generation_request_id',domain:'generation-request',targetTable:'workspace_generation_requests',value:{type:'text',value:'orphan-generation'},relation:'declared',referenceState:'declared'});
 }});
});
it('discovers the actual persistent constructor from the isolated real account registry',async()=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const path=fixture(),registry=readOrdinaryProfileSources();expect(registry).toBeDefined();
 const source=registry!.sources.find(s=>s.directory.canonicalPath===dirname(path)&&s.database?.basename===basename(path));expect(source?.snapshotFormat).toBe('artifact-workspace-sqlite-v1');
 const generation=registry!.generation,store=new ArtifactWorkspaceStore({dbPath:path});store.close();expect(readOrdinaryProfileSources()!.generation).toBe(generation);
});
it.each(['protected','unavailable'])('refuses ordinary workspace creation before any directory or file for %s',route=>{
 const path=join(root,'denied-'+route,'workspace.sqlite');discovery.route=route;
 try{expect(()=>new ArtifactWorkspaceStore({dbPath:path})).toThrow('ordinary_source_route');expect(existsSync(dirname(path))).toBe(false);}finally{discovery.route='ordinary';}
});
it('retains failed registration facts and closes the actual workspace handle before any DDL',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),close=vi.spyOn(DatabaseSync.prototype,'close'),path=join(root,'fsync-failure','workspace.sqlite');discovery.failSync=true;
 try{expect(()=>new ArtifactWorkspaceStore({dbPath:path})).toThrow('registry_fsync_fixture');}finally{discovery.failSync=false;}
 expect(close).toHaveBeenCalled();close.mockRestore();change(path,db=>expect(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([]));
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');expect(readOrdinaryProfileSources()!.sources.some(s=>s.directory.canonicalPath===dirname(path))).toBe(true);
});
it.each([':memory:',''])('keeps the original nonpersistent workspace %j out of durable discovery',async dbPath=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js'),before=readOrdinaryProfileSources();const store=new ArtifactWorkspaceStore({dbPath});
 try{expect(store.getOrCreateWorkspace({conversationId:'temporary',workspaceRootId:'root'}).id).toBeTruthy();}finally{store.close();}expect(readOrdinaryProfileSources()).toEqual(before);
});
it('retains original source identity on replacement and permits reopening after the original file is restored',async()=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const path=fixture(),before=readOrdinaryProfileSources(),backup=path+'.original',replacement=path+'.replacement';renameSync(path,backup);
 let wrong:ArtifactWorkspaceStore|undefined;
 try{expect(()=>{wrong=new ArtifactWorkspaceStore({dbPath:path});}).toThrow('profile_source_registry_identity');}finally{wrong?.close();}
 expect(readOrdinaryProfileSources()).toEqual(before);renameSync(path,replacement);renameSync(backup,path);
 const reopened=new ArtifactWorkspaceStore({dbPath:path});try{expect(reopened.listWorkspaces()).toHaveLength(1);}finally{reopened.close();}expect(readOrdinaryProfileSources()).toEqual(before);
});
it('carries the real registered live WAL source through review parsing and native capture without losing its latest commit',async()=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const {parseProfileSourceReview}=await import('../../../src/runtime/verification/profile-source-review.js');const {canonicalVerificationJson}=await import('../../../src/runtime/verification/protocol.js');const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');
 const path=fixture(false),store=new ArtifactWorkspaceStore({dbPath:path});
 try{
  const workspace=store.getOrCreateWorkspace({conversationId:'uncheckpointed',workspaceRootId:'root'});expect(statSync(path+'-wal').size).toBeGreaterThan(0);
  const registry=readOrdinaryProfileSources();expect(registry).toBeDefined();const source=registry!.sources.find(s=>s.directory.canonicalPath===dirname(path))!;expect(source).toBeDefined();
  const captureSource={sourceId:source.sourceId,kind:'sqlite-db' as const,directory:source.directory,database:source.database!,snapshotFormat:'artifact-workspace-sqlite-v1' as const};
  const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources:[captureSource],signal:new AbortController().signal});
  try{const token=await owner.capture(),facts=readProfileSourceCapture(owner,token),sourceSet={schemaVersion:1,authorityId:'authority',profileId:'profile',uid:process.getuid!(),accountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',inventoryGeneration:registry!.generation,sources:[{...captureSource,namespaceId:source.namespaceId,reviewedSnapshotSha256:facts.sources[0]!.snapshotHash}]};
   const review=parseProfileSourceReview({version:1,purpose:'profile-source-custody',authorityId:'authority',challengeId:'challenge',principal:{uid:process.getuid!(),accountGeneration:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',auditSessionId:2},requestSource:'user',sourceSet,inventoryHash:createHash('sha256').update(canonicalVerificationJson(sourceSet)).digest('hex'),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}});
   expect(review.sourceSet.sources[0]!.snapshotFormat).toBe('artifact-workspace-sqlite-v1');const rows=[...read(owner,token)].filter(e=>e.kind==='row');expect(rows.find(r=>r.table==='artifact_workspaces')!.record.id).toEqual({type:'text',value:workspace.id});expect(rows.find(r=>r.table==='artifact_workspace_meta')!.record.schema_version).toEqual({type:'integer',value:'1'});await owner.checkCurrent();expect(readOrdinaryProfileSources()!.legacyInventoryRequired).toBe(true);
  }finally{await owner.close();}
 }finally{store.close();}
});
it.each([7,1.5])('classifies original large event metadata without regex stack overflow (n=%s)',async n=>{
 const {iterateCapturedSQLiteArtifactWorkspaceSources:read}=await import('../../../src/runtime/verification/captured-sqlite-artifact-workspace.js');const path=fixture(false),store=new ArtifactWorkspaceStore({dbPath:path}),text='value1.5[,]{}\\"'+'x'.repeat(16*1024**2);
 try{const workspace=store.getOrCreateWorkspace({conversationId:'large-meta',workspaceRootId:'root'});store.recordEvent({workspaceId:workspace.id,conversationId:'large-meta',eventName:'workspace_opened',metadata:{text,n}});}finally{store.close();}
 await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row').filter(e=>e.table==='artifact_workspace_events'),row=rows.at(-1)!;expect(row.parsedMetadata).toEqual(n===7?{classification:'scalar-map',value:{text,n}}:{classification:'uninterpreted-json',raw:JSON.stringify({text,n})});});
});
it('rejects KSwarm query IDs against a held ArtifactWorkspace source',async()=>{
 const {readProfileSqliteLosslessRows}=await import('../../../src/runtime/verification/profile-source-capture.js');await held([fixture()],(owner,token)=>expect(()=>[...readProfileSqliteLosslessRows(owner,token,'source-0','state_entities')]).toThrow('query_format'));
});
