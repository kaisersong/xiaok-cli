import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync,mkdirSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,basename,dirname} from 'node:path';
import Database from 'better-sqlite3';
const discovery=vi.hoisted(()=>({home:'',route:'ordinary',failSync:false,platform:undefined as string|undefined}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:discovery.home})};});
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return {...actual,fsyncSync:(fd:number)=>{if(discovery.failSync&&actual.fstatSync(fd).isDirectory())throw Error('registry_fsync_fixture');return actual.fsyncSync(fd);}};});
const nextUuid=vi.hoisted(()=>({value:undefined as string|undefined}));
vi.mock('node:crypto',async load=>{const actual=await load<typeof import('node:crypto')>();return {...actual,randomUUID:()=>{if(nextUuid.value){const value=nextUuid.value;nextUuid.value=undefined;return value;}return actual.randomUUID();}};});
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>({kind:'ordinary'})}));
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:discovery.route})}));
import {CodexNativeService} from '../../../desktop/electron/codex-native-service.js';
import {CodexTaskBridge} from '../../../desktop/electron/codex-task-bridge.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {startProfileSourceCapture,readProfileSqliteRows,type ProfileCaptureSource} from '../../../src/runtime/verification/profile-source-capture.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-codex-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
beforeAll(()=>{discovery.home=join(root,'account');mkdirSync(discovery.home);const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);},40000);
afterAll(()=>rmSync(root,{recursive:true,force:true}));
class ClientFixture {
 threadId='external-thread';activeTurnId:string|null=null;
 constructor(readonly fail=false){}async connect(){if(this.fail)throw Error('fixture_connect');}async create(){return {thread:{id:this.threadId}};}async close(){}
}
async function native(){
 const path=join(mkdtempSync(join(root,'native-')),'codex-native.sqlite'),ids:string[]=[];
 for(const profileId of ['profile-a','profile-b']){const service=new CodexNativeService({dbPath:path,profileId,createClient:()=>new ClientFixture() as never});try{ids.push((await service.create({requestSource:'user',actorId:profileId},root)).id);}finally{await service.dispose();}}
 const failed=new CodexNativeService({dbPath:path,profileId:'failed',createClient:()=>new ClientFixture(true) as never});try{await expect(failed.create({requestSource:'user',actorId:'failed'},root)).rejects.toThrow('fixture_connect');}finally{await failed.dispose();}
 return {path,ids};
}
class BridgeClientFixture {
 threadId='external-thread';activeTurnId:string|null=null;
 constructor(readonly options:{onEvent?:(event:{method:string;params:unknown})=>void}){}
 async connect(){}async create(){return {thread:{id:this.threadId}};}async close(){}
 async start(){this.activeTurnId='turn';this.options.onEvent?.({method:'turn/started',params:{threadId:this.threadId,turn:{id:'turn',status:'inProgress'}}});setTimeout(()=>{this.options.onEvent?.({method:'item/completed',params:{threadId:this.threadId,turnId:'turn',item:{id:'answer',type:'agentMessage',text:'done'}}});this.activeTurnId=null;this.options.onEvent?.({method:'turn/completed',params:{threadId:this.threadId,turn:{id:'turn',status:'completed'}}});},5);return {turnId:'turn'};}
}
async function routes(success=false,threadId='thread'){
 const dir=mkdtempSync(join(root,'routes-')),store=new FileTaskSnapshotStore(join(dir,'tasks'));
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'profile-a',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace'),maxBytes:1024*1024}),snapshotStore:store,createClient:options=>new BridgeClientFixture(options) as never,admitThread:async()=>()=>{if(!success)throw Error('fixture_revoked');}});
 try{bridge.select(true);const pending=bridge.create({prompt:'original',materials:[],context:{threadId}},{requestSource:'user',actorId:'profile-a'});if(success){const task=await pending;await vi.waitFor(async()=>expect((await store.recoverTask(task.taskId))?.status).toBe('completed'));}else await expect(pending).rejects.toThrow('fixture_revoked');}finally{await bridge.dispose();await store.closeAndDrain();}
 return join(dir,'codex-task-routes.sqlite');
}
async function held(paths:Array<{path:string;format:'codex-native-sqlite-v1'|'codex-routes-sqlite-v1'|'session-sqlite-v1'}>,run:(owner:object,token:object)=>void|Promise<void>){
 const sources:ProfileCaptureSource[]=paths.map(({path,format},index)=>{const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});return {sourceId:'source-'+index,kind:'sqlite-db',snapshotFormat:format,directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}};});
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});try{const token=await owner.capture();await run(owner,token);await owner.checkCurrent();}finally{await owner.close();}
}
function change(path:string,run:(db:Database.Database)=>void){const db=new Database(path);try{run(db);}finally{db.close();}}
it('captures all real native profile rows and null external mappings without granting session ownership',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const f=await native();
 await held([{path:f.path,format:'codex-native-sqlite-v1'}],(owner,token)=>{const facts=readCapturedSQLiteCodexSources(owner,token),rows=facts.sources[0]!.nativeSessions;
 expect(rows.map(r=>r.owner).sort()).toEqual(['failed','profile-a','profile-b']);expect(rows.filter(r=>r.nativeId==='external-thread')).toHaveLength(2);expect(rows.find(r=>r.owner==='failed')!.nativeId).toBeNull();expect(Object.isFrozen(rows[0]!.snapshot.messages)).toBe(true);expect(facts).not.toHaveProperty('sessionIdentities');expect(()=>readCapturedSQLiteCodexSources({...owner},token)).toThrow('brand');expect(()=>[...readProfileSqliteRows(owner,token,'source-0','session:sessions')]).toThrow('format');});
});
it('preserves a real revoked bridge route before native thread creation',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes();
 await held([{path,format:'codex-routes-sqlite-v1'},{path:join(dirname(path),'codex-native.sqlite'),format:'codex-native-sqlite-v1'}],(owner,token)=>{const source=readCapturedSQLiteCodexSources(owner,token).sources[0]!;expect(source.settings).toEqual([{key:'selected',value:'true'}]);expect(source.threads).toEqual([]);expect(source.routes).toEqual([expect.objectContaining({threadId:'thread',threadPresent:false})]);});
});
it.each(['unknown-table','extra-column','duplicate-json','identity','approval','revision','status-array'] as const)('refuses captured native inconsistency: %s',async mode=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const f=await native();change(f.path,db=>{
 if(mode==='unknown-table')db.exec('CREATE TABLE hidden(id TEXT)');else if(mode==='extra-column')db.exec('ALTER TABLE codex_native_sessions ADD COLUMN hidden TEXT');else {const row=db.prepare('SELECT id,snapshot FROM codex_native_sessions LIMIT 1').get() as {id:string;snapshot:string};const value=JSON.parse(row.snapshot);let raw:string;if(mode==='duplicate-json')raw=row.snapshot.replace('"id":','"id":"hidden","id":');else {if(mode==='identity')value.id='different';else if(mode==='revision')value.revision=0;else if(mode==='status-array')value.status=['idle'];else value.approvals=[{token:'hidden',method:'command',description:'hidden',expiresAt:1}];raw=JSON.stringify(value);}db.prepare('UPDATE codex_native_sessions SET snapshot=? WHERE id=?').run(raw,row.id);}
 });await held([{path:f.path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(()=>readCapturedSQLiteCodexSources(owner,token)).toThrow());
});

it.each(['unknown-setting','null-thread','blob-route','missing-native'] as const)('rejects invalid original bridge declarations: %s',async mode=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes();change(path,db=>{
  if(mode==='unknown-setting')db.prepare('INSERT INTO settings VALUES (?,?)').run('unknown','true');
  if(mode==='null-thread')db.prepare('INSERT INTO threads VALUES (?,?)').run('thread',null);
  if(mode==='blob-route')db.prepare('UPDATE routes SET thread_id=?').run(Buffer.from('thread'));
  if(mode==='missing-native')db.prepare('INSERT INTO threads VALUES (?,?)').run('thread','missing');
 });await held([{path,format:'codex-routes-sqlite-v1'},{path:join(dirname(path),'codex-native.sqlite'),format:'codex-native-sqlite-v1'}],(owner,token)=>expect(()=>readCapturedSQLiteCodexSources(owner,token)).toThrow());
});
it('refuses a routes source paired only with a native source from another physical directory',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes(),foreign=await native();
 await held([{path,format:'codex-routes-sqlite-v1'},{path:foreign.path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(readCapturedSQLiteCodexSources(owner,token).pairs).toEqual([expect.objectContaining({routesSourceId:'source-0',nativeSourceId:null,state:'native-source-absent'})]));
});

it('binds an actual successful bridge to its same-directory native history and the original four-table schema',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const {CODEX_SOURCE_SCHEMAS}=await import('../../../src/runtime/verification/codex-source-schema.js');const path=await routes(true),nativePath=join(dirname(path),'codex-native.sqlite');
 for(const [file,format] of [[path,'codex-routes-sqlite-v1'],[nativePath,'codex-native-sqlite-v1']] as const)change(file,db=>expect(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all().map((raw:unknown)=>{const row=raw as {sql:string|null};return {...row,sql:row.sql?.replace(/\s+/g,' ').trim()??null};})).toEqual(CODEX_SOURCE_SCHEMAS[format]));
 await held([{path,format:'codex-routes-sqlite-v1'},{path:nativePath,format:'codex-native-sqlite-v1'}],(owner,token)=>{const facts=readCapturedSQLiteCodexSources(owner,token);expect(facts.pairs).toHaveLength(1);const routes=facts.sources.find(s=>s.sourceId==='source-0')!,native=facts.sources.find(s=>s.sourceId==='source-1')!;expect(routes.routes[0]!.threadPresent).toBe(true);expect(routes.threads[0]!.nativeId).toBe(native.nativeSessions[0]!.id);expect(native.nativeSessions[0]!.nativeId).toBe('external-thread');});
});

it('retains assistant state actually written by the original ID-only queue lookup on collision',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=join(mkdtempSync(join(root,'collision-')),'native.sqlite');let client!:BridgeClientFixture;
 const service=new CodexNativeService({dbPath:path,profileId:'profile',createClient:options=>(client=new BridgeClientFixture(options)) as never}),actor={requestSource:'user' as const,actorId:'profile'};
 try{const session=await service.create(actor,root);client.options.onEvent?.({method:'item/completed',params:{threadId:client.threadId,item:{id:'collision',type:'agentMessage',text:'earlier'}}});nextUuid.value='collision';await service.send(actor,session.id,'user');expect(service.get(actor,session.id).messages[0]!.state).toBe('sent');await new Promise(r=>setTimeout(r,10));}finally{nextUuid.value=undefined;await service.dispose();}
 await held([{path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(readCapturedSQLiteCodexSources(owner,token).sources[0]!.nativeSessions[0]!.snapshot.messages).toContainEqual(expect.objectContaining({id:'collision',role:'assistant',state:'sent'})));
});
it.each([42,null,{},''])('refuses the whole declaration after the actual service persisted an untyped external message ID: %j',async invalidId=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=join(mkdtempSync(join(root,'bad-external-')),'native.sqlite');let client!:BridgeClientFixture;
 const service=new CodexNativeService({dbPath:path,profileId:'profile',createClient:options=>(client=new BridgeClientFixture(options)) as never});
 try{await service.create({requestSource:'user',actorId:'profile'},root);client.options.onEvent?.({method:'item/completed',params:{threadId:client.threadId,item:{id:invalidId,type:'agentMessage',text:'actual external value'}}});}finally{await service.dispose();}
 await held([{path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(()=>readCapturedSQLiteCodexSources(owner,token)).toThrow());
});

it('keeps an actual routes-only constructor failure as an unresolved pairing without granting completeness',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const dir=mkdtempSync(join(root,'constructor-')),store=new FileTaskSnapshotStore(join(dir,'tasks'));mkdirSync(join(dir,'codex-native.sqlite'));
 expect(()=>new CodexTaskBridge({dataRoot:dir,profileId:'profile',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace'),maxBytes:1024*1024}),snapshotStore:store})).toThrow();await store.closeAndDrain();
 await held([{path:join(dir,'codex-task-routes.sqlite'),format:'codex-routes-sqlite-v1'}],(owner,token)=>{const facts=readCapturedSQLiteCodexSources(owner,token);expect(facts.sources[0]!.routes).toEqual([]);expect(facts.pairs).toEqual([expect.objectContaining({state:'native-source-absent',nativeSourceId:null})]);});
});
it('rejects tokens from another actual full capture and refuses declarations after close',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const a=await native(),b=await native();let ended:{owner:object;token:object}|undefined;
 await held([{path:a.path,format:'codex-native-sqlite-v1'}],async(owner,token)=>{ended={owner,token};await held([{path:b.path,format:'codex-native-sqlite-v1'}],(_other,foreign)=>expect(()=>readCapturedSQLiteCodexSources(owner,foreign)).toThrow('brand'));});
 expect(()=>readCapturedSQLiteCodexSources(ended!.owner,ended!.token)).toThrow('closed');
});

it('rejects a known same-directory native database captured under the wrong semantic format',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes();
 await held([{path,format:'codex-routes-sqlite-v1'},{path:join(dirname(path),'codex-native.sqlite'),format:'session-sqlite-v1'}],(owner,token)=>expect(()=>readCapturedSQLiteCodexSources(owner,token)).toThrow('pair_format'));
});
it.each([123,null,'','external\nthread'])('preserves the actual persisted external scalar after successful untyped bind: %j',async external=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=join(mkdtempSync(join(root,'external-scalar-')),'native.sqlite');
 const service=new CodexNativeService({dbPath:path,profileId:'profile',createClient:()=>({threadId:external,async connect(){},async create(){return {thread:{id:external}};},async close(){}}) as never});
 try{await service.create({requestSource:'user',actorId:'profile'},root);}finally{await service.dispose();}
 let persisted:unknown;change(path,db=>{persisted=(db.prepare('SELECT native_id FROM codex_native_sessions').get() as {native_id:unknown}).native_id;});expect(external===null?persisted===null:typeof persisted==='string').toBe(true);
 await held([{path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(readCapturedSQLiteCodexSources(owner,token).sources[0]!.nativeSessions[0]!.nativeId).toBe(persisted));
});
it.each(['','profile\nlabel'])('preserves original ordinary profile labels without assigning native identity: %j',async profileId=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=join(mkdtempSync(join(root,'profile-scalar-')),'native.sqlite');
 const service=new CodexNativeService({dbPath:path,profileId,createClient:()=>new ClientFixture() as never});
 try{await service.create({requestSource:'user',actorId:profileId},root);}finally{await service.dispose();}
 await held([{path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(readCapturedSQLiteCodexSources(owner,token).sources[0]!.nativeSessions[0]!.owner).toBe(profileId));
});
it('preserves an original local thread string without inventing a native session domain',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes(true,'thread\nlabel');
 await held([{path,format:'codex-routes-sqlite-v1'},{path:join(dirname(path),'codex-native.sqlite'),format:'codex-native-sqlite-v1'}],(owner,token)=>{const source=readCapturedSQLiteCodexSources(owner,token).sources[0]!;expect(source.threads[0]!.threadId).toBe('thread\nlabel');expect(source.routes[0]!.threadId).toBe('thread\nlabel');});
});
it('refuses a damaged original primary index even when the complete schema and table rows remain readable',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const f=await native();
 const bytes=readFileSync(f.path),size=bytes.readUInt16BE(16)||65536;let changed=false;
 for(let offset=size;offset<bytes.length;offset+=size){if(bytes[offset]!==10)continue;const at=bytes.indexOf(Buffer.from(f.ids[0]!),offset);if(at>=offset&&at+f.ids[0]!.length<=offset+size){bytes.write(f.ids[1]!,at,'utf8');changed=true;break;}}
 expect(changed).toBe(true);writeFileSync(f.path,bytes);
 change(f.path,db=>expect(db.pragma('integrity_check')).not.toEqual([{integrity_check:'ok'}]));
 await held([{path:f.path,format:'codex-native-sqlite-v1'}],(owner,token)=>expect(()=>readCapturedSQLiteCodexSources(owner,token)).toThrow('integrity'));
});
it('preserves two local thread references to one physical native row without duplicating that row',async()=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes(true);
 change(path,db=>{const row=db.prepare('SELECT native_id FROM threads LIMIT 1').get() as {native_id:string};db.prepare('INSERT INTO threads VALUES (?,?)').run('second-thread',row.native_id);});
 await held([{path,format:'codex-routes-sqlite-v1'},{path:join(dirname(path),'codex-native.sqlite'),format:'codex-native-sqlite-v1'}],(owner,token)=>{const facts=readCapturedSQLiteCodexSources(owner,token);expect(facts.sources[0]!.threads).toHaveLength(2);expect(facts.sources[1]!.nativeSessions).toHaveLength(1);expect(facts.pairs).toHaveLength(1);expect(Object.isFrozen(facts.pairs[0]!.directory)).toBe(true);expect(Object.isFrozen(facts.sources[0]!.threads)).toBe(true);});
});
it.each([12000,24000])('resolves all %i retained bridge references against actual production schemas',async count=>{
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');const path=await routes(true),nativePath=join(dirname(path),'codex-native.sqlite');
 // The constructors and seed rows are real producers. Bulk rows deliberately
 // clone that persisted schema/data; this fixture does not reimplement readers.
 change(nativePath,db=>{const seed=db.prepare('SELECT snapshot FROM codex_native_sessions LIMIT 1').get() as {snapshot:string},value=JSON.parse(seed.snapshot),insert=db.prepare('INSERT INTO codex_native_sessions VALUES (?,?,?,?)');db.transaction(()=>{for(let i=0;i<count;i++){const id='bulk-'+String(i).padStart(6,'0');insert.run(id,'profile-a','external-thread',JSON.stringify({...value,id}));}})();});
 change(path,db=>{const thread=db.prepare('INSERT INTO threads VALUES (?,?)'),route=db.prepare('INSERT INTO routes VALUES (?,?)');db.transaction(()=>{for(let i=0;i<count;i++){const id='bulk-'+String(i).padStart(6,'0');thread.run(id,id);route.run(id,id);}})();});
 await held([{path,format:'codex-routes-sqlite-v1'},{path:nativePath,format:'codex-native-sqlite-v1'}],(owner,token)=>{const started=performance.now(),facts=readCapturedSQLiteCodexSources(owner,token),elapsed=performance.now()-started;console.info(JSON.stringify({codexCaptureRows:count,readerMilliseconds:elapsed}));expect(facts.sources[0]!.routes).toHaveLength(count+1);expect(facts.sources[0]!.routes.every(r=>r.threadPresent)).toBe(true);expect(facts.sources[1]!.nativeSessions).toHaveLength(count+1);});
},30000);

it('discovers original Codex constructors from the real account registry through actual capture',async()=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');
 const {readCapturedSQLiteCodexSources}=await import('../../../src/runtime/verification/captured-sqlite-codex.js');
 const path=await routes(true),directory=dirname(path),registry=readOrdinaryProfileSources();
 expect(registry).toBeDefined();expect(registry!.legacyInventoryRequired).toBe(true);
 const discovered=registry!.sources.filter(s=>s.directory.canonicalPath===directory&&s.kind==='sqlite-db');expect(discovered).toHaveLength(2);
 const sources=discovered.map(s=>({sourceId:s.sourceId,kind:'sqlite-db' as const,directory:s.directory,database:s.database!,snapshotFormat:s.snapshotFormat as 'codex-native-sqlite-v1'|'codex-routes-sqlite-v1'}));
 const owner=await startProfileSourceCapture({uid:process.getuid!(),sqliteHelper,directoryHelper,sources,signal:new AbortController().signal});
 try{const token=await owner.capture(),facts=readCapturedSQLiteCodexSources(owner,token);expect(facts.sources.flatMap(s=>s.nativeSessions)).toHaveLength(1);expect(facts.sources.flatMap(s=>s.routes)).toHaveLength(1);expect(facts.pairs[0]?.state).toBe('paired');await owner.checkCurrent();}finally{await owner.close();}
});
it.each(['protected','unavailable'])('does not create ordinary Codex files for %s profile',async route=>{
 const path=join(root,'denied-'+route,'native.sqlite');discovery.route=route;
 try{expect(()=>new CodexNativeService({dbPath:path,profileId:'p'})).toThrow(/ordinary_source_route/);expect(existsSync(dirname(path))).toBe(false);}finally{discovery.route='ordinary';}
});
it('registers before schema writes, retains the source and closes on a real registry fsync failure',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const close=vi.spyOn(DatabaseSync.prototype,'close');
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');
 const path=join(root,'registry-fail','native.sqlite');discovery.failSync=true;
 try{expect(()=>new CodexNativeService({dbPath:path,profileId:'p'})).toThrow('registry_fsync_fixture');}finally{discovery.failSync=false;}
 expect(close).toHaveBeenCalled();close.mockRestore();
 const db=new Database(path);try{expect(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([]);}finally{db.close();}
 expect(readOrdinaryProfileSources()!.sources.some(s=>s.database?.basename==='native.sqlite'&&s.directory.canonicalPath===dirname(path))).toBe(true);
});
it('deduplicates an arbitrary native path reopened for another profile',async()=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');
 const path=join(root,'arbitrary','another.sqlite');let service=new CodexNativeService({dbPath:path,profileId:'one'});await service.dispose();
 const first=readOrdinaryProfileSources();expect(first).toBeDefined();service=new CodexNativeService({dbPath:path,profileId:'two'});await service.dispose();
 expect(readOrdinaryProfileSources()!.generation).toBe(first!.generation);expect(first!.sources.some(s=>s.database?.basename==='another.sqlite')).toBe(true);
});
it('closes both constructor databases after the original Host constructor fails',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const close=vi.spyOn(DatabaseSync.prototype,'close');const directory=mkdtempSync(join(root,'host-fail-'));
 const population={assertAccepting(){},createHost(){throw Error('host_constructor_fixture');}};
 expect(()=>new CodexTaskBridge({dataRoot:directory,profileId:'p',cwd:root,materialRegistry:new MaterialRegistry({workspaceRoot:join(directory,'workspace'),maxBytes:1024}),snapshotStore:new FileTaskSnapshotStore(join(directory,'tasks')),sourcePopulation:population as never})).toThrow('host_constructor_fixture');
 expect(close).toHaveBeenCalledTimes(2);close.mockRestore();
});
it.each(['ordinary','unavailable'])('handles the original Windows installation route %s before POSIX registration',async route=>{
 const original=process.platform,path=join(root,'windows-'+route,'native.sqlite'),{readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const before=readOrdinaryProfileSources();
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});discovery.route=route;
 try{if(route==='ordinary'){const service=new CodexNativeService({dbPath:path,profileId:'p'});await service.dispose();}else{expect(()=>new CodexNativeService({dbPath:path,profileId:'p'})).toThrow(/ordinary_source_route/);expect(existsSync(path)).toBe(false);}}finally{Object.defineProperty(process,'platform',{value:original,configurable:true});discovery.route='ordinary';}
 expect(readOrdinaryProfileSources()).toEqual(before);
});
it.each([':memory:',''])('preserves original nonpersistent SQLite %s without discovery files',async dbPath=>{
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const before=readOrdinaryProfileSources();
 const service=new CodexNativeService({dbPath,profileId:'p'});try{expect(service.list({requestSource:'user',actorId:'p'})).toEqual([]);expect(()=>service.closeBeforeUse()).toThrow('native_already_used');}finally{await service.dispose();}
 expect(readOrdinaryProfileSources()).toEqual(before);
});
