import {spawnSync} from 'node:child_process';
import {appendFileSync,statSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startProfileSourceCapture} from '../../src/runtime/verification/profile-source-capture.js';

function run(command:string,args:string[],timeout=30000){
 const raw=spawnSync(command,args,{encoding:'utf8',timeout});
 if(process.env.XIAOK_KSWARM_SOURCE_PID_LOG)appendFileSync(process.env.XIAOK_KSWARM_SOURCE_PID_LOG,JSON.stringify({pid:raw.pid,command,args,status:raw.status,signal:raw.signal})+'\n');
 if(raw.error||raw.status!==0)throw new Error(raw.stderr||'kswarm_source_fixture_failed',{cause:raw.error});return raw.stdout;
}
export function compileKSwarmSourceCustody(root:string){
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o'),sqliteHelper=join(root,'sqlite'),directoryHelper=join(root,'directory');
 run('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object]);
 run('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 run('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);return {sqliteHelper,directoryHelper};
}
/** The override chooses a test runtime only, never a source or Native role. */
export function createOriginalKSwarmSource(path:string,mode:string,siblingRoot=resolve('../kswarm-authority-source-20261108')){
 const node=process.env.XIAOK_KSWARM_SOURCE_FIXTURE_NODE||process.execPath;
 const url=(p:string)=>JSON.stringify(pathToFileURL(join(siblingRoot,p)).href);
 return JSON.parse(run(node,['--input-type=module','--eval',`
 import {createHub} from ${url('src/core/hub.js')};
 import {createSqlitePersistence} from ${url('src/core/sqlite-persistence.js')};
 import {createProjectInputAuthority} from ${url('src/core/project-input-authority.js')};
 import {createSqliteWriterFloor} from ${url('src/core/sqlite-writer-floor.js')};
 import {semanticWriterProfiles} from ${url('src/core/initial-plan-acceptance-contract.js')};
 import {createWriterTransition,writerTransitionTriggers,WRITER_TRANSITION_KEY} from ${url('src/core/writer-transition-contract.js')};
 import {DatabaseSync} from 'node:sqlite';import{randomUUID}from'node:crypto';
 const v=process.versions.node.split('.').map(Number);if(v[0]<22||v[0]===22&&v[1]<22)throw Error('KSWARM_SOURCE_FIXTURE_REQUIRES_NODE_22_22');
 const [path,mode]=process.argv.slice(1),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
 let connection;const store=createSqlitePersistence({filePath:path,sqliteFactory:p=>(connection=new DatabaseSync(p))});
 let hub;try{
  if(mode==='dsh8'||mode==='ordinary-receipts'){
   hub=createHub({silent:true,persistence:store,dataDir:{backend:'sqlite',filePath:path}});
   if(mode==='dsh8'){const authority=createProjectInputAuthority(scope),prepared=hub.prepareDshAdmissionOwnerWriter({requestSource:'user',projectInputAuthority:authority.reader()});if(prepared.ok!==true)throw Error(JSON.stringify(prepared));}
   else hub.createProject({id:'original-project',name:'Source fixture',goal:'original',poAgent:'po',members:[],requestedStartPolicy:'plan_only'});
  }else{
   store.load();
   if(mode!=='plain'){
    const floor=createSqliteWriterFloor(connection),version=mode==='transition'?1:Number(mode),profile=semanticWriterProfiles().find(p=>p.schemaVersion===version);
    connection.exec('BEGIN IMMEDIATE');const base=floor.require(version===1?'sqlite_writer_gate_v1':{profile:profile.profile,storeId:randomUUID(),scope});
    if(mode==='transition'){
     const raw=connection.prepare("SELECT meta_value FROM state_meta WHERE meta_key='writer_floor_v1'").get().meta_value;
     const record=createWriterTransition({baseFloor:base,baseRaw:raw,scope,snapshotDigest:'c'.repeat(64),baseRevision:0,actorId:'desktop-user:'+scope.profileId});
     connection.prepare('INSERT INTO state_meta VALUES(?,?)').run(WRITER_TRANSITION_KEY,JSON.stringify(record));for(const sql of writerTransitionTriggers().values())connection.exec(sql);
     connection.prepare("UPDATE state_meta SET meta_value='1' WHERE meta_key='revision'").run();
    }connection.exec('COMMIT');floor.assertWritable();
   }
  }
  console.log(JSON.stringify({mode,profile:store.getWriterProfile(),schema:connection.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),pid:process.pid}));
 }finally{if(hub)hub.closePersistence();else store.close();}
 const cold=createSqlitePersistence({filePath:path});try{cold.load();cold.getWriterProfile();}finally{cold.close();}
 `,path,mode],10000)) as {mode:string;profile:unknown;schema:Array<{type:string;name:string;tbl_name:string;sql:string|null}>;pid:number};
}
export async function withOriginalKSwarmCapture<T>(path:string,helpers:{sqliteHelper:string;directoryHelper:string},fn:(owner:Awaited<ReturnType<typeof startProfileSourceCapture>>,token:object)=>T|Promise<T>){
 const d=statSync(dirname(path),{bigint:true}),s=statSync(path,{bigint:true});
 const owner=await startProfileSourceCapture({uid:process.getuid!(),...helpers,sources:[{sourceId:'original-kswarm',kind:'sqlite-db',snapshotFormat:'kswarm-state-sqlite-v1',directory:{canonicalPath:dirname(path),device:String(d.dev),inode:String(d.ino)},database:{basename:basename(path),device:String(s.dev),inode:String(s.ino)}}],signal:new AbortController().signal});
 try{return await fn(owner,await owner.capture());}finally{await owner.close();}
}
