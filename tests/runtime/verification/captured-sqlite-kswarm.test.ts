import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
const discovery=vi.hoisted(()=>({home:''}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:discovery.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {startProfileSourceCapture,readProfileSqliteSchema,type ProfileCaptureSource} from '../../../src/runtime/verification/profile-source-capture.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-kswarm-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
beforeAll(()=>{
 discovery.home=join(root,'account');mkdirSync(discovery.home);
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');
 execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);
},40000);
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function change(path:string,run:(db:Database.Database)=>void){const db=new Database(path);try{run(db);}finally{db.close();}}
function fixture(full=true,encoding?:'UTF-16le'|'UTF-16be'){
 const path=join(mkdtempSync(join(root,'store-')),'arbitrary-state.sqlite');
 if(encoding)change(path,db=>{db.pragma("encoding='"+encoding+"'");db.exec('CREATE TABLE encoding_seed(x); DROP TABLE encoding_seed');});
 execFileSync(process.execPath,['--input-type=module','--eval',`
 import {createSqlitePersistence} from ${JSON.stringify(pathToFileURL(resolve('../kswarm/src/core/sqlite-persistence.js')).href)};
 import {decomposeState} from ${JSON.stringify(pathToFileURL(resolve('../kswarm/src/core/state-scope.js')).href)};
 const store=createSqlitePersistence({filePath:process.argv[1],now:()=>1700000000000});store.load();
 try{if(process.argv[2]==='true'){
 const state={projects:[{id:'p',name:'first'}],boards:[{projectId:'p',tasks:[{id:'task',sessionId:'not-native-grant'}]}],workflowRuns:[{id:'run',projectId:'p'}],workflowProposals:[{id:'proposal',projectId:'p'}],finalDeliverables:[{deliverableId:'deliverable',projectId:'p'}],reviewGateDecisions:[{gateId:'gate',projectId:'p'}],reviewConditions:[{conditionId:'condition',projectId:'p'}],humanActions:[{id:'human',seq:0,projectId:'p'}]};
 const save=()=>{const all=decomposeState(state);store.save({entities:all.filter(e=>e.collection!=='humanAction'),humanActions:all.filter(e=>e.collection==='humanAction')});};
 save();state.projects[0].name='second';save();state.projects[0].name='third';save();state.workflowProposals=[];save();
 }}finally{store.close();}
 `,path,String(full)],{stdio:['ignore','pipe','pipe']});return path;
}
async function held(paths:string[],run:(owner:Awaited<ReturnType<typeof startProfileSourceCapture>>,token:object)=>void|Promise<void>,sourceIds?:string[]){
 const sources:ProfileCaptureSource[]=paths.map((path,index)=>{const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});return {sourceId:sourceIds?.[index]??'source-'+index,kind:'sqlite-db',snapshotFormat:'kswarm-state-sqlite-v1',directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}};});
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});
 try{await run(owner,await owner.capture());}finally{await owner.close();}
}
async function reader(){return (await import('../../../src/runtime/verification/captured-sqlite-kswarm.js')).iterateCapturedSQLiteKSwarmStateSources;}
it('uses original decompose and save for all eight collections including retained deleted history',()=>{
 change(fixture(),db=>{const collections=db.prepare('SELECT DISTINCT collection FROM state_entities UNION SELECT DISTINCT collection FROM state_entity_history').all();expect(collections).toHaveLength(8);expect(db.prepare('SELECT * FROM state_entity_history').all().length).toBeGreaterThan(0);});
});
it('matches original complete schema, all physical rows and retained historical entities',async()=>{
 const read=await reader(),path=fixture();await held([path],(owner,token)=>{
  const events=[...read(owner,token)],rows=events.filter(e=>e.kind==='row'),last=events.at(-1)!;
  expect(last.kind).toBe('complete');expect(Object.isFrozen(rows[0]!.record)).toBe(true);expect([...read(owner,token)]).toEqual(events);
  change(path,db=>{for(const table of ['state_entities','state_entity_history','state_meta'])expect(rows.filter(r=>r.table===table)).toHaveLength((db.prepare('SELECT count(*) n FROM '+table).get() as {n:number}).n);});
  const old=rows.find(r=>r.table==='state_entity_history'&&r.record.collection?.type==='text'&&r.record.collection.value==='workflowProposal')!;
  expect(old.record.state_json).toEqual({type:'text',value:'{"id":"proposal","projectId":"p"}'});expect(last).not.toHaveProperty('sessionIdentities');
 });
});
it('preserves multiple physical same-ID stores and empty initialized sources',async()=>{
 const read=await reader();await held([fixture(),fixture(),fixture(false)],(owner,token)=>{const events=[...read(owner,token)];expect(events.filter(e=>e.kind==='source-end')).toHaveLength(3);expect(events.filter(e=>e.kind==='row'&&e.table==='state_entities'&&e.record.collection?.type==='text'&&e.record.collection.value==='project')).toHaveLength(2);});
});
it.each(['UTF-16le','UTF-16be'] as const)('preserves %s raw JSON, BOM/NUL and exact INTEGER without Number conversion',async encoding=>{
 const read=await reader(),path=fixture(true,encoding),raw='{"text":"\\ufeff尾🎈\\u0000","n":9007199254740993,"exponent":1e400}';
 change(path,db=>{expect(db.pragma('encoding',{simple:true})).toBe(encoding);db.prepare('UPDATE state_entities SET state_json=?,checksum=?,revision=? WHERE collection=?').run(raw,createHash('sha256').update(raw).digest('hex'),9007199254740993n,'project');});
 await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row'),row=rows.find(e=>e.table==='state_entities'&&e.record.collection?.type==='text'&&e.record.collection.value==='project')!;expect(row.record.state_json).toEqual({type:'text',value:raw});expect(row.record.revision).toEqual({type:'integer',value:'9007199254740993'});expect(row).not.toHaveProperty('parsedState');});
});
it.each(['checksum-current','checksum-history','json','duplicate-json','collection','extra-table','extra-column','extra-index','changed-index','invalid-text'] as const)('refuses %s without repairing source or yielding complete',async mode=>{
 const read=await reader(),path=fixture();change(path,db=>{
  if(mode.startsWith('checksum'))db.exec("UPDATE "+(mode==='checksum-current'?'state_entities':'state_entity_history')+" SET checksum='bad'");
  else if(mode==='json'||mode==='duplicate-json'){const raw=mode==='json'?'{':'{"x":1,"x":2}';db.prepare('UPDATE state_entities SET state_json=?,checksum=?').run(raw,createHash('sha256').update(raw).digest('hex'));}
  else if(mode==='collection')db.exec("UPDATE state_entities SET collection='unknown' WHERE collection='project'");
  else if(mode==='extra-table')db.exec('CREATE TABLE unknown(x)');else if(mode==='extra-column')db.exec('ALTER TABLE state_entities ADD COLUMN unknown');
  else if(mode==='changed-index')db.exec('DROP INDEX idx_state_entities_project; CREATE INDEX idx_state_entities_project ON state_entities(entity_key)');
  else if(mode==='extra-index')db.exec('CREATE INDEX unknown ON state_meta(meta_value)');else db.exec("UPDATE state_entities SET updated_at=CAST(x'80' AS TEXT)");
 });const before=readFileSync(path);await held([path],(owner,token)=>{const kinds:string[]=[];expect(()=>{for(const e of read(owner,token))kinds.push(e.kind);}).toThrow();expect(kinds).not.toContain('complete');});expect(readFileSync(path)).toEqual(before);
});
it('releases an early iterator and rejects copied or closed capture identity',async()=>{
 const read=await reader();await held([fixture()],async(owner,token)=>{expect(()=>[...read({...owner},token)]).toThrow();expect(()=>[...read(owner,{...token})]).toThrow();const iterator=read(owner,token);iterator.next();iterator.next();iterator.return();expect(readProfileSqliteSchema(owner,token,'source-0')).toHaveLength(7);await owner.close();expect(()=>[...read(owner,token)]).toThrow();});
});
it('reads latest WAL commit while the original writer and its exclusive lock remain alive',async()=>{
 const read=await reader(),path=fixture(false),url=pathToFileURL(resolve('../kswarm/src/core/sqlite-persistence.js')).href;
 const {createSqlitePersistence}=await import(/* @vite-ignore */ url),store=createSqlitePersistence({filePath:path});store.load();
 try{
  store.save({entities:[{collection:'project',key:'wal',projectId:'wal',value:{id:'wal',latest:true}}]});const lock=readFileSync(path+'.lock');expect(statSync(path+'-wal').size).toBeGreaterThan(0);
  await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row');expect(rows.find(e=>e.table==='state_entities')!.record.entity_key).toEqual({type:'text',value:'wal'});});expect(readFileSync(path+'.lock')).toEqual(lock);
 }finally{store.close();}
});
it('rejects Artifact query IDs against held KSwarm sources',async()=>{
 await reader();const {readProfileSqliteLosslessRows}=await import('../../../src/runtime/verification/profile-source-capture.js');await held([fixture()],(owner,token)=>expect(()=>[...readProfileSqliteLosslessRows(owner,token,'source-0','artifact_workspaces')]).toThrow('query_format'));
});
it('keeps the complete SQL/schema manifest deeply immutable',async()=>{
 const {KSWARM_STATE_SOURCE_SCHEMA:schema,KSWARM_STATE_COLUMNS:columns,KSWARM_STATE_QUERIES:queries}=await import('../../../src/runtime/verification/kswarm-state-source-schema.js');
 expect(Object.isFrozen(schema)).toBe(true);expect(Object.isFrozen(schema[0])).toBe(true);expect(Object.isFrozen(columns)).toBe(true);expect(Object.isFrozen(columns.state_entities[0])).toBe(true);expect(Object.isFrozen(queries.state_entities.columns)).toBe(true);
});
it('does not conflate same-looking TEXT/BLOB candidates or same IDs in distinct source namespaces',async()=>{
 const read=await reader(),a=fixture(),b=fixture();change(b,db=>db.prepare('UPDATE state_entities SET project_id=? WHERE collection=?').run(Buffer.from('p'),'project'));
 await held([a,b],(owner,token)=>{
  const rows=[...read(owner,token)].filter(e=>e.kind==='row').filter(e=>e.table==='state_entities');const projects=rows.filter(e=>e.record.collection?.type==='text'&&e.record.collection.value==='project');expect(projects).toHaveLength(2);
  expect(projects.map(e=>e.sourceId)).toEqual(['source-0','source-1']);expect(projects[0]!.references.find(r=>r.column==='project_id')).toEqual({column:'project_id',domain:'kswarm:project',value:{type:'text',value:'p'},referenceState:'declared'});expect(projects[1]!.references.find(r=>r.column==='project_id')).toEqual({column:'project_id',domain:'kswarm:project',value:{type:'blob',value:'cA=='},referenceState:'uninterpreted'});
 });
});
it('matches every original schema item and complete physical column descriptor',async()=>{
 const {KSWARM_STATE_SOURCE_SCHEMA:schema,KSWARM_STATE_COLUMNS:columns}=await import('../../../src/runtime/verification/kswarm-state-source-schema.js');
 change(fixture(),db=>{
  const actual=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all() as {sql:string|null}[];expect(actual.map(e=>({...e,sql:e.sql?.replace(/\s+/g,' ').trim()??null}))).toEqual(schema);
  for(const [table,expected] of Object.entries(columns))expect(db.prepare('PRAGMA table_xinfo('+table+')').all()).toEqual(expected);
 });
});
it('streams a real producer large entity without accumulating the source output',async()=>{
 const read=await reader(),path=fixture(false),url=pathToFileURL(resolve('../kswarm/src/core/sqlite-persistence.js')).href;
 const {createSqlitePersistence}=await import(/* @vite-ignore */ url),store=createSqlitePersistence({filePath:path});store.load();
 try{store.save({entities:[{collection:'project',key:'large',projectId:'large',value:{id:'large',body:'x'.repeat(16*1024**2)}}]});}finally{store.close();}
 const before=process.memoryUsage();let peakHeap=before.heapUsed,peakRss=before.rss,bytes=0,complete=false;const start=performance.now();
 await held([path],(owner,token)=>{for(const event of read(owner,token)){const memory=process.memoryUsage();peakHeap=Math.max(peakHeap,memory.heapUsed);peakRss=Math.max(peakRss,memory.rss);if(event.kind==='row'&&event.record.state_json?.type==='text')bytes+=Buffer.byteLength(event.record.state_json.value);if(event.kind==='complete')complete=true;}});
 expect(complete).toBe(true);expect(bytes).toBeGreaterThan(16*1024**2);console.log(JSON.stringify({experiment:'kswarm-synthetic-large-entity',payloadBytes:bytes,elapsedMs:performance.now()-start,baselineHeap:before.heapUsed,observedPeakHeap:peakHeap,baselineRss:before.rss,observedPeakRss:peakRss,qualification:false}));
},30000);
it('compares table_xinfo by its fields rather than driver object insertion order',async()=>{
 const read=await reader(),path=fixture();await held([path],(owner,token)=>{
  const prepare=Database.prototype.prepare,spy=vi.spyOn(Database.prototype,'prepare').mockImplementation(function(this:Database.Database,sql:string){const statement=prepare.call(this,sql);if(sql.startsWith('PRAGMA table_xinfo(')){const all=statement.all.bind(statement);statement.all=(...args:unknown[])=>Reflect.apply(all,undefined,args).map((row:unknown)=>Object.fromEntries(Object.entries(row as object).reverse()));}return statement;});
  try{expect([...read(owner,token)].at(-1)!.kind).toBe('complete');}finally{spy.mockRestore();}
 });
});
it('orders non-BMP source IDs by UTF16 and binds each physical snapshot into framed digest',async()=>{
 const read=await reader(),{canonicalVerificationJson}=await import('../../../src/runtime/verification/protocol.js');
 await held([fixture(false),fixture(false)],(owner,token)=>{
  const events=[...read(owner,token)],starts=events.filter(e=>e.kind==='source-start');expect(starts.map(e=>e.sourceId)).toEqual(['\u{10000}','\ue000']);expect(starts[0]!.snapshotHash).not.toBe(starts[1]!.snapshotHash);
  const chunks=events.filter(e=>e.kind!=='complete').map(e=>Buffer.from(canonicalVerificationJson(e),'utf8'));
  const framed=Buffer.concat([Buffer.from('xiaok-kswarm-state-declarations-v1\0'),...chunks.flatMap(bytes=>[Buffer.from(bytes.length+':','ascii'),bytes])]);
  const complete=events.at(-1)!;expect(complete.kind).toBe('complete');if(complete.kind==='complete')expect(complete.digest).toBe(createHash('sha256').update(framed).digest('hex'));
 },['\ue000','\u{10000}']);
});
it('emits the fixed empty digest when a held capture has no matching format',async()=>{
 const read=await reader(),path=fixture(false),d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});
 // Capture itself makes no schema claim. A different format cannot enter this reader.
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources:[{sourceId:'other',kind:'sqlite-db',snapshotFormat:'session-sqlite-v1',directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}}],signal:new AbortController().signal});
 try{expect([...read(owner,await owner.capture())]).toEqual([{kind:'complete',sources:[],digest:'7bc97d1a06b41e9cddde22f130bcc6233439c5ebaeae7d1be38f30c848322e59'}]);}finally{await owner.close();}
});
it('matches each physical cell and rowid across the complete three-table population',async()=>{
 const read=await reader(),path=fixture();await held([path],(owner,token)=>{const rows=[...read(owner,token)].filter(e=>e.kind==='row');change(path,db=>{
  for(const table of ['state_entities','state_entity_history','state_meta']){
   const actual=db.prepare('SELECT rowid AS original_rowid,* FROM '+table+' ORDER BY rowid').safeIntegers(true).all() as Record<string,unknown>[];
   expect(rows.filter(e=>e.table===table).map(row=>({rowid:row.rowid,record:row.record}))).toEqual(actual.map(({original_rowid,...record})=>({rowid:String(original_rowid),record:Object.fromEntries(Object.entries(record).map(([key,value])=>{
    if(value===null)return [key,{type:'null'}];if(typeof value==='string')return [key,{type:'text',value}];if(typeof value==='bigint')return [key,{type:'integer',value:String(value)}];if(Buffer.isBuffer(value))return [key,{type:'blob',value:value.toString('base64')}];if(typeof value==='number'){const bytes=Buffer.alloc(8);bytes.writeDoubleBE(value);return [key,{type:'real',value:bytes.toString('hex')}];}throw Error('unexpected original SQLite cell');
   }))})));
  }
  expect(db.prepare("SELECT state_json FROM state_entity_history WHERE collection='project' ORDER BY revision").all()).toEqual([{state_json:'{"id":"p","name":"first"}'},{state_json:'{"id":"p","name":"second"}'}]);
 });});
});
it('carries an explicit registry entry through actual review parsing and native capture without claiming first-writer discovery',async()=>{
 const read=await reader(),path=fixture(),{registerOrdinaryProfileSource,readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js'),{readProfileSourceCapture}=await import('../../../src/runtime/verification/profile-source-capture.js'),{parseProfileSourceReview}=await import('../../../src/runtime/verification/profile-source-review.js'),{canonicalVerificationJson}=await import('../../../src/runtime/verification/protocol.js');
 registerOrdinaryProfileSource({kind:'sqlite-db',directory:dirname(path),databaseBasename:basename(path),snapshotFormat:'kswarm-state-sqlite-v1'});
 const registry=readOrdinaryProfileSources()!,source=registry.sources.find(s=>s.directory.canonicalPath===dirname(path))!;if(source.kind!=='sqlite-db'||source.snapshotFormat!=='kswarm-state-sqlite-v1'||!source.database)throw Error('registry source');
 const descriptor:ProfileCaptureSource={sourceId:source.sourceId,kind:'sqlite-db',snapshotFormat:source.snapshotFormat,directory:source.directory,database:source.database};
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources:[descriptor],signal:new AbortController().signal});
 try{const token=await owner.capture(),facts=readProfileSourceCapture(owner,token),sourceSet={schemaVersion:1,authorityId:'authority',profileId:'profile',uid:process.getuid!(),accountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',inventoryGeneration:registry.generation,sources:[{...descriptor,namespaceId:source.namespaceId,reviewedSnapshotSha256:facts.sources[0]!.snapshotHash}]};
  const review=parseProfileSourceReview({version:1,purpose:'profile-source-custody',authorityId:'authority',challengeId:'challenge',principal:{uid:process.getuid!(),accountGeneration:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',auditSessionId:2},requestSource:'user',sourceSet,inventoryHash:createHash('sha256').update(canonicalVerificationJson(sourceSet)).digest('hex'),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:1000}});
  expect(review.sourceSet.sources[0]!.snapshotFormat).toBe('kswarm-state-sqlite-v1');expect([...read(owner,token)].at(-1)!.kind).toBe('complete');expect(registry.legacyInventoryRequired).toBe(true);
 }finally{await owner.close();}
});
