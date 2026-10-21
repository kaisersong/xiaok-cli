import {createRequire} from 'node:module';
import {lstatSync,realpathSync,existsSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {join} from 'node:path';
import {syncDirectoryTreeStrict} from '../../utils/atomic-file.js';
// Unknown native close outcomes retain the exact original owner until a known
// successful close or process exit; GC must never authorize another owner.
const failedLocks=new Set<object>();
/** Private filesystem primitive only. The installed caller must first establish
 * its separated OS identity and root. This lock never proves a guest is stopped. */
export function acquireControllerLifetimeLock(inputRoot:string){
 const original=lstatSync(inputRoot),uid=process.getuid?.();
 if(uid===undefined||original.isSymbolicLink()||!original.isDirectory()||original.uid!==uid||(original.mode&0o077))throw Error('controller_lifetime_path');
 const root=realpathSync(inputRoot),path=join(root,'controller-owner.sqlite');
 function file(name:string){const s=lstatSync(name);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid||(s.mode&0o077)||s.size>1024**2)throw Error('controller_lifetime_path');return s;}
 for(const name of [path,path+'-journal'])if(existsSync(name)||(()=>{try{lstatSync(name);return true;}catch{return false;}})())file(name);
 if(existsSync(path+'-wal')||existsSync(path+'-shm'))throw Error('controller_lifetime_path');
 if(!existsSync(path)){try{const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{fsyncSync(fd);}finally{closeSync(fd);}}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}file(path);}
 const Native=createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
 const db=new Native(path,{timeout:0});let closed=false,invalidated=false;
 try{
  db.pragma('journal_mode=DELETE');db.pragma('synchronous=FULL');
  const pages=Math.floor(1024**2/(db.pragma('page_size',{simple:true}) as number));if((db.pragma(`max_page_count=${pages}`,{simple:true}) as number)>pages||(db.pragma('page_count',{simple:true}) as number)>pages)throw Error('controller_lifetime_budget');
  // SQLite-created files inherit the service umask. Reject wider permissions;
  // never chmod an existing resource to manufacture private ownership.
  const identity=file(path);db.exec('BEGIN EXCLUSIVE');syncDirectoryTreeStrict(root);
  function current(){if(invalidated)throw Error('controller_lifetime_invalidated');try{if(closed||!db.open||!db.inTransaction)throw Error('controller_lifetime_closed');const r=lstatSync(root),s=file(path);if(r.dev!==original.dev||r.ino!==original.ino||r.uid!==uid||(r.mode&0o077)||s.dev!==identity.dev||s.ino!==identity.ino)throw Error('controller_lifetime_changed');}catch(error){invalidated=true;throw error;}}
  const value:Readonly<{assertCurrent():void;close():void}>=Object.freeze({assertCurrent:current,close(){if(closed)return;try{db.close();closed=true;failedLocks.delete(value);}catch(error){failedLocks.add(value);throw error;}}});return value;
 }catch(error){try{db.close();}catch(cleanupError){failedLocks.add({database:db});throw new AggregateError([error,cleanupError],'controller_lifetime_cleanup_unknown',{cause:error});}throw error;}
}
