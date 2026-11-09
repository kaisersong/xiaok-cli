import {spawnSync} from 'node:child_process';
import {appendFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function child(command:string,args:string[],timeout=30000):void {
 const result=spawnSync(command,args,{encoding:'utf8',timeout});
 if(process.env.XIAOK_BROKER_SOURCE_PID_LOG)appendFileSync(process.env.XIAOK_BROKER_SOURCE_PID_LOG,JSON.stringify({command,args,pid:result.pid,status:result.status,signal:result.signal})+'\n');
 if(result.error||result.status!==0||result.signal)throw Error(result.stderr||'broker_source_fixture_child_failed',{cause:result.error});
}
export function compileBrokerCustody(root:string){
 const sqlite=resolve('node_modules/better-sqlite3/deps/sqlite3'),object=join(root,'sqlite.o'),sqliteHelper=join(root,'sqlite'),directoryHelper=join(root,'directory');
 child('clang',['-O2','-DSQLITE_THREADSAFE=0','-DSQLITE_OMIT_LOAD_EXTENSION=1','-DSQLITE_TEMP_STORE=3','-DSQLITE_ENABLE_DBPAGE_VTAB=1','-c',join(sqlite,'sqlite3.c'),'-o',object]);
 child('clang',['-Wall','-Wextra','-Werror','-std=c11','-I',sqlite,resolve('src/runtime/verification/native/source-sqlite-custody.c'),object,'-o',sqliteHelper]);
 child('clang',['-Wall','-Wextra','-Werror','-std=c11',resolve('src/runtime/verification/native/source-lock-custody.c'),'-o',directoryHelper]);
 return {sqliteHelper,directoryHelper};
}
/** Real sibling constructors and business APIs. EventStore currently has no
 * negative port: a finite child owns both connections until actual process exit. */
export function createOriginalBrokerRoom(root:string,version:8|9,encoding='UTF-8'):string {
 const file=join(mkdtempSync(join(root,'broker-')),'original.sqlite');
 const url=(path:string)=>JSON.stringify(pathToFileURL(resolve('../intent-broker/src',path)).href);
 child(process.execPath,['--input-type=module','-e',`
 import {DatabaseSync} from 'node:sqlite';
 import {createEventStore} from ${url('store/event-store.js')};
 import {createRoomStore,getDefaultMigrations} from ${url('room/store.js')};
 import {createRoomService} from ${url('room/service.js')};
 import {admissionDigest} from ${url('room/admission-control.js')};
 const file=process.argv[1],version=Number(process.argv[2]);
 const seed=new DatabaseSync(file);try{seed.exec('PRAGMA encoding='+JSON.stringify(process.argv[3]));}finally{seed.close();}
 const events=createEventStore({dbPath:file});
 events.appendIntent({intentId:'intent',kind:'request_task',fromParticipantId:'human',taskId:'task',threadId:'thread',payload:{text:'尾\\u0000'},recipients:['agent']});
 events.ackInbox('agent',1);
 const room=createRoomStore({dbPath:file,migrations:getDefaultMigrations().filter(row=>row.version<=version)});
 try {
  room.migrate();room.insertRoom({roomId:'room',title:'original',description:'',status:'active',origin:'user_created',createdBy:{kind:'user',userId:'user'},revision:1,discussionEpoch:0,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  if(version===9){
   const service=createRoomService({store:room}),scope={profileId:'profile',workspaceId:'workspace'},authority={authorityId:'authority',authorityEpoch:1};
   const ctx={requestSource:'scheduler',actor:{kind:'system',service:'desktop'},hostPrincipal:'fixture-desktop'};
   const baseline=service.establishAdmissionBaseline({schemaVersion:1,scope,authority,operationId:'baseline',visibility:{kind:'no_visibility'}},ctx);
   if(!baseline.ok)throw Error('actual_baseline_failed');
   const policy={mode:'observe'},axis='mode',sourceHeadId='mode:global';
   const reply=service.applyAdmissionFence({schemaVersion:1,scope,authority,realmId:baseline.receipt.realmId,range:{sourceBindingId:null,mandateId:null,workId:null},axis,controlKey:admissionDigest({sourceHeadId,axis}),sourceHeadId,commandHash:admissionDigest({command:'fixture'}),epoch:1,operationId:'mode',canonicalPolicyHash:admissionDigest(policy),policy},ctx);
   if(!reply.ok)throw Error('actual_fence_failed');
  }
 } finally {room.close();}
 `,file,String(version),encoding]);return file;
}
