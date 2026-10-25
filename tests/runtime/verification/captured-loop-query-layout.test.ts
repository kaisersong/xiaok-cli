import {afterAll,afterEach,beforeAll,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../../desktop/electron/loop-store.js';
import {startProfileSourceCapture,readProfileSqliteRows} from '../../../src/runtime/verification/profile-source-capture.js';
import type {MetadataSessionQueryId} from '../../../src/runtime/verification/metadata-session-query-manifest.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'captured-loop-layout-'))),directoryHelper=join(root,'directory'),sqliteHelper=join(root,'sqlite');
const closes:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
beforeAll(()=>{
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o');
 execFileSync('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object],{timeout:30000});
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 execFileSync('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);
},40000);
let serial=0;
async function fixture(legacy:boolean,extra?:'ordinary'|'hidden'){
 const path=join(root,`loops-${serial++}.sqlite`);
 if(legacy){const db=new DatabaseSync(path);try{db.exec(`CREATE TABLE loop_definitions (
 id text primary key,title text not null,description text not null,status text not null,
 active_run_id text,created_at integer not null,updated_at integer not null
 );INSERT INTO loop_definitions VALUES ('original-loop','Original','Before migration','idle',NULL,1,1);`);}finally{db.close();}}
 const store=new LoopStore(path);store.close();
 const db=new DatabaseSync(path);let physicalColumns:string[];
 try{if(extra)db.exec(extra==='hidden'?'ALTER TABLE loop_definitions ADD COLUMN unlisted TEXT GENERATED ALWAYS AS (title) VIRTUAL':'ALTER TABLE loop_definitions ADD COLUMN unlisted TEXT');physicalColumns=(db.prepare('PRAGMA table_xinfo(loop_definitions)').all() as Array<{name:string}>).map(row=>row.name);}finally{db.close();}
 const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});
 const owner=await startProfileSourceCapture({uid:process.getuid!(),directoryHelper,sqliteHelper,sources:[{sourceId:'loop-source',kind:'sqlite-db',snapshotFormat:'loop-sqlite-v1',directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}}],signal:new AbortController().signal});
 closes.push(()=>owner.close());return{owner,token:await owner.capture(),physicalColumns};
}
it('reads the actual original constructor migration despite the appended physical column order',async()=>{
 const{owner,token,physicalColumns}=await fixture(true);
 expect(physicalColumns.indexOf('origin')).toBeGreaterThan(physicalColumns.indexOf('updated_at'));
 expect([...readProfileSqliteRows(owner,token,'loop-source','loop:loop_definitions')]).toMatchObject([{id:'original-loop',origin:'built_in',deleted_at:null,delete_reason:null}]);
 await owner.checkCurrent();
});
it('keeps the original fresh constructor projection available',async()=>{
 const{owner,token,physicalColumns}=await fixture(false);
 expect(physicalColumns.indexOf('origin')).toBeLessThan(physicalColumns.indexOf('updated_at'));
 expect([...readProfileSqliteRows(owner,token,'loop-source','loop:loop_definitions')]).toEqual([]);
});
it.each(['ordinary','hidden'] as const)('still rejects unknown %s columns instead of selecting a subset',async(extra)=>{
 const{owner,token}=await fixture(true,extra);
 expect(()=>[...readProfileSqliteRows(owner,token,'loop-source','loop:loop_definitions')]).toThrow('source_sqlite_query_columns');
});
it('exposes the original Loop export allocator through its own fixed format query',async()=>{
 const{owner,token}=await fixture(false);
 expect([...readProfileSqliteRows(owner,token,'loop-source','loop:sqlite_sequence' as MetadataSessionQueryId)]).toEqual([]);
 expect(()=>[...readProfileSqliteRows(owner,token,'loop-source','session:sqlite_sequence')]).toThrow('source_sqlite_query_format');
});
