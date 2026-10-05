import {beforeAll,afterAll,afterEach,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,basename,dirname} from 'node:path';
import Database from 'better-sqlite3';
// Only installed route lookup is a fixture. Stores, leases, native custody,
// pager capture and fixed SQLite queries below are the real implementations.
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>({kind:'ordinary'})}));
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {startProfileSourceCapture,readProfileSourceCapture} from '../../../src/runtime/verification/profile-source-capture.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-sqlite-sessions-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
const cleanups:Array<()=>unknown>=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
beforeAll(()=>{
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');
 execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);
},40000);
afterAll(()=>rmSync(root,{recursive:true,force:true}));
let sequence=0;
async function fixture(migrate=false){
 const path=join(root,`sessions-${sequence++}.sqlite`),store=new SQLiteSessionStore(path);
 try{
  for(const sessionId of ['session','older.dot'])await store.save({sessionId,cwd:root,createdAt:1,updatedAt:2,lineage:[sessionId],messages:[{role:'user',content:[{type:'text',text:' old 中文 '}]},{role:'assistant',content:[{type:'text',text:'reply'}]}],usage:{inputTokens:2,outputTokens:1},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  if(migrate){
   const authority=createSessionExecutionAuthority({root,sessionIdentity:'session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'migration'})});
   try{const lease=await authority.acquire({invocationId:'migration',kind:'recovery'});try{const exported=await store.exportSessionForMigration({sessionId:'session',lease});await store.markSessionMigrated({sessionId:'session',expectedSnapshotHash:exported.snapshotHash,expectedStoreRevision:exported.storeRevision,migrationId:'migration',targetAuthorityId:'authority',targetSessionId:'target',migrationEpoch:1,importReceiptHash:'a'.repeat(64),lease});await expect(store.load('session')).rejects.toThrow('MIGRATED_SESSION');}finally{await lease.releaseAfterDrain();}}finally{authority.dispose();}
  }
 }finally{store.dispose();}
 return path;
}
async function captured(paths:string[]){
 const sources=paths.map((path,index)=>{const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});return {sourceId:'source-'+index,kind:'sqlite-db' as const,snapshotFormat:'session-sqlite-v1' as const,directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}};});
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources,signal:new AbortController().signal});cleanups.push(()=>owner.close());const token=await owner.capture();return {owner,token};
}
function change(path:string,sql:string,unsafe=false){const db=new Database(path);try{if(unsafe)db.unsafeMode(true);db.exec(sql);}finally{db.close();}}
it('uses actual all-source capture and retains migrated/live sessions and the original SQLite identity domain',async()=>{
 const {readCapturedSQLiteSessionSources}=await import('../../../src/runtime/verification/captured-sqlite-sessions.js');
 const first=await fixture(true),second=await fixture(),{owner,token}=await captured([first,second]);const before=readProfileSourceCapture(owner,token);
 const facts=readCapturedSQLiteSessionSources(owner,token);expect(facts.kind).toBe('captured-sqlite-session-declarations');expect(facts.sources).toHaveLength(2);
 expect(facts.sources[0]!.sessions.map(x=>x.containerSessionId)).toEqual(['older.dot','session']);expect(facts.sources[0]!.migrations[0]).toMatchObject({sessionId:'session',targetAuthorityId:'authority',targetSessionId:'target'});
 expect(facts.sources[0]!.snapshotHash).toBe(before.sources[0]!.snapshotHash);expect(Object.isFrozen(facts.sources[0]!.sessions)).toBe(true);expect(readProfileSourceCapture(owner,token)).toBe(before);
 await owner.checkCurrent();expect(()=>readCapturedSQLiteSessionSources({...owner},token)).toThrow('brand');await owner.close();expect(()=>readCapturedSQLiteSessionSources(owner,token)).toThrow('closed');
});
it.each([
 ['orphan-message',"UPDATE session_messages SET session_id='missing' WHERE message_id=1"],
 ['gap',"UPDATE session_messages SET message_index=4 WHERE message_id=1"],
 ['fts-identity',"UPDATE session_messages_fts SET session_id='hidden' WHERE rowid=1"],
 ['duplicate-json',`UPDATE sessions SET usage_json='{"inputTokens":999,"input\\u0054okens":2,"outputTokens":1}' WHERE session_id='session'`],
 ['schema',"CREATE TABLE hidden(session_id TEXT);INSERT INTO hidden VALUES('hidden')"],
 ['sequence',"UPDATE sqlite_sequence SET seq=0 WHERE name='session_messages'"],
 ['message-body',`UPDATE session_messages SET content_json='[{"type":"text","text":"different"}]' WHERE message_id=1`],
 ['null-lineage',"UPDATE sessions SET lineage_json='null' WHERE session_id='session'"],
] as const)('rejects an actual captured database inconsistency without dropping rows: %s',async(_name,sql)=>{
 const {readCapturedSQLiteSessionSources}=await import('../../../src/runtime/verification/captured-sqlite-sessions.js');const path=await fixture();change(path,sql);const {owner,token}=await captured([path]);expect(()=>readCapturedSQLiteSessionSources(owner,token)).toThrow();
});
it('rejects stale FTS postings even when the content rows agree with messages',async()=>{
 const {readCapturedSQLiteSessionSources}=await import('../../../src/runtime/verification/captured-sqlite-sessions.js');const path=await fixture();
 change(path,`UPDATE session_messages SET content_json='[{"type":"text","text":"new"}]',text_content='new' WHERE message_id=1;UPDATE session_messages_fts_content SET c2='new' WHERE id=1`,true);
 const db=new Database(path);try{expect(db.prepare("SELECT rowid FROM session_messages_fts WHERE session_messages_fts MATCH 'old'").all()).toContainEqual({rowid:1});expect(db.prepare('SELECT text_content FROM session_messages_fts WHERE rowid=1').get()).toEqual({text_content:'new'});}finally{db.close();}
 const {owner,token}=await captured([path]);expect(()=>readCapturedSQLiteSessionSources(owner,token)).toThrow();
});
it('checks the original migration snapshot rather than omitting migrated sessions',async()=>{
 const {readCapturedSQLiteSessionSources}=await import('../../../src/runtime/verification/captured-sqlite-sessions.js');const path=await fixture(true);change(path,"UPDATE sessions SET cwd='changed' WHERE session_id='session'");const {owner,token}=await captured([path]);expect(()=>readCapturedSQLiteSessionSources(owner,token)).toThrow('migration');
});
it('preserves a retained last-session reference and a high historical sequence after deleting message rows',async()=>{
 const {readCapturedSQLiteSessionSources}=await import('../../../src/runtime/verification/captured-sqlite-sessions.js');const path=await fixture();change(path,"DELETE FROM session_messages;DELETE FROM session_messages_fts;DELETE FROM sessions;UPDATE session_meta SET value='old-deleted' WHERE key='last_session'");
 const before=readFileSync(path),{owner,token}=await captured([path]);const facts=readCapturedSQLiteSessionSources(owner,token);expect(facts.sources[0]!.sessions).toEqual([]);expect(facts.sources[0]!.lastSessionReference).toBe('old-deleted');await owner.close();expect(readFileSync(path)).toEqual(before);
});

it.each([
 ['index', 'DROP INDEX idx_session_messages_session;CREATE INDEX idx_session_messages_session ON session_messages(role)'],
 ['nullable', 'ALTER TABLE session_meta RENAME TO original_meta;CREATE TABLE session_meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO session_meta SELECT * FROM original_meta;DROP TABLE original_meta'],
 ['unique-not-primary', 'ALTER TABLE session_meta RENAME TO original_meta;CREATE TABLE session_meta(key TEXT UNIQUE,value TEXT NOT NULL);INSERT INTO session_meta SELECT * FROM original_meta;DROP TABLE original_meta'],
] as const)('refuses a changed production schema despite valid rows: %s',async(_name,sql)=>{
 const {readCapturedSQLiteSessionSources}=await import('../../../src/runtime/verification/captured-sqlite-sessions.js');const path=await fixture();change(path,sql);const {owner,token}=await captured([path]);expect(()=>readCapturedSQLiteSessionSources(owner,token)).toThrow('schema');
});
