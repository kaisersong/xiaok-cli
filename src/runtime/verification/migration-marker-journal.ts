import {randomUUID} from 'node:crypto';
import {chmodSync,closeSync,constants,fchmodSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync,type Stats} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Database} from 'better-sqlite3';
import {syncDirectoryTreeStrict} from '../../utils/atomic-file.js';
import {canonicalVerificationJson,VERIFICATION_BUDGET} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
import {migrationOwnerFileName,migrationProfileDirectoryName,parseMigrationMarker,type MigrationMarker} from './migration-markers.js';

interface Intent {owner_key:string;profile_id:string;marker_json:string;state:'pending'|'migrated';published:number;charged_bytes:number}
function synchronous(value:unknown){if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('migration_publisher_sync');}}
function probe(path:string):Stats|undefined{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
function identity(marker:Readonly<MigrationMarker>){if(marker.state==='migrated'){const {state:_state,importReceiptHash:_receipt,...facts}=marker;return canonicalVerificationJson(facts);}const {state:_state,...facts}=marker;return canonicalVerificationJson(facts);}
/** Private filesystem journal, NOT OS qualification. The sole installed controller
 * owns the namespace and database; its wrapper must check real service identity and
 * actual native authorization/import+source-fence facts before authorizing a token.
 */
export function createMigrationMarkerJournal(input:{root:string;database:Database;authorityId:string;assertCurrent():void;assertAuthorized(token:object,marker:Readonly<MigrationMarker>):void}){
 const {root,database:db,authorityId,assertCurrent,assertAuthorized}=input;
 const rootStat=lstatSync(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o777)!==0o755||rootStat.blksize>4096)throw Error('migration_publisher_identity');
 db.exec('CREATE TABLE IF NOT EXISTS migration_publication_intents(owner_key TEXT PRIMARY KEY,profile_id TEXT NOT NULL,marker_json TEXT NOT NULL,state TEXT NOT NULL,published INTEGER NOT NULL,charged_bytes INTEGER NOT NULL)');
 let busy=false;
 function current(){synchronous(assertCurrent());const actual=lstatSync(root);if(actual.isSymbolicLink()||!actual.isDirectory()||actual.dev!==rootStat.dev||actual.ino!==rootStat.ino||actual.uid!==rootStat.uid||(actual.mode&0o777)!==0o755)throw Error('migration_publisher_identity');}
 function directory(path:string){let s=probe(path);if(!s){mkdirSync(path,{mode:0o755});chmodSync(path,0o755);s=lstatSync(path);}if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==rootStat.uid||(s.mode&0o777)!==0o755)throw Error('migration_publisher_identity');}
 function read(path:string):string|undefined{
  const s=probe(path);if(!s)return undefined;if(s.isSymbolicLink()||!s.isFile()||s.uid!==rootStat.uid||s.nlink!==1||(s.mode&0o777)!==0o644||s.size>4096)throw Error('migration_publisher_identity');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const actual=fstatSync(fd);if(actual.ino!==s.ino||actual.dev!==s.dev||actual.nlink!==1||actual.size>4096)throw Error('migration_publisher_identity');return readFileSync(fd,'utf8');}finally{closeSync(fd);}
 }
 function atomic(path:string,contents:string){
  const existing=read(path);if(existing===contents){syncDirectoryTreeStrict(dirname(path));return;}
  const temp=join(dirname(path),'.migration-'+randomUUID()+'.tmp');let fd:number|undefined,renamed=false;
  let settledBodyFailure: {
      error: unknown;
  } | undefined;
  try {
      fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, contents);
      fchmodSync(fd, 0o644);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, path);
      renamed = true;
      syncDirectoryTreeStrict(dirname(path));
  }
  catch (error) {
      settledBodyFailure = { error };
  }
  {
      if (fd !== undefined)
          closeSync(fd);
      if (!renamed) {
          try {
              unlinkSync(temp);
          }
          catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                  throw error;
          }
      }
  }
  if (settledBodyFailure)
      throw settledBodyFailure.error;
 }
 function publish(raw:MigrationMarker,token:object,requested:'pending'|'migrated'){
  if(busy)throw Error('migration_publisher_reentrant');if(db.inTransaction)throw Error('migration_publisher_outer_transaction');busy=true;
  try{
   const marker=parseMigrationMarker(raw);if(marker.state!==requested||marker.authorityId!==authorityId)throw Error('migration_publisher_binding');current();synchronous(assertAuthorized(token,marker));current();
   const ownerKey=canonicalVerificationJson({profileId:marker.profileId,ownerKind:marker.ownerKind,ownerId:marker.ownerId});
   const effective=runVerificationTransaction(db,()=>{
    const old=db.prepare('SELECT * FROM migration_publication_intents WHERE owner_key=?').get(ownerKey) as Intent|undefined;
    if(old){const previous=parseMigrationMarker(JSON.parse(old.marker_json));if(identity(previous)!==identity(marker)||(previous.state==='migrated'&&marker.state==='migrated'&&previous.importReceiptHash!==marker.importReceiptHash))throw Error('migration_publisher_conflict');if(previous.state==='migrated'){if(marker.state!=='migrated')throw Error('migration_publisher_conflict');return previous;}
     if(marker.state==='migrated')db.prepare("UPDATE migration_publication_intents SET marker_json=?,state='migrated',published=0 WHERE owner_key=?").run(canonicalVerificationJson(marker),ownerKey);
     return marker;
    }
    if(marker.state!=='pending')throw Error('migration_pending_required');
    const usage=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(charged_bytes),0) bytes,COUNT(DISTINCT profile_id) profiles FROM migration_publication_intents').get() as {n:number;bytes:number;profiles:number};
    const hasProfile=!!db.prepare('SELECT 1 FROM migration_publication_intents WHERE profile_id=? LIMIT 1').get(marker.profileId);
    // <=4 KiB blocks, includes immutable final + temporary file and directory/header headroom.
    const charge=12288+(hasProfile?0:24576);
    if(usage.n>=1024||(!hasProfile&&usage.profiles>=64)||usage.bytes+charge>VERIFICATION_BUDGET.auxiliaryBytes)throw Error('migration_auxiliary_capacity');
    assertVerificationDatabaseBudget(db,{additionalBytes:8192});
    db.prepare('INSERT INTO migration_publication_intents VALUES(?,?,?,?,0,?)').run(ownerKey,marker.profileId,canonicalVerificationJson(marker),'pending',charge);return marker;
   });
   // The durable intent/reservation survives every following filesystem failure.
   const profile=join(root,migrationProfileDirectoryName(effective.profileId));directory(profile);
   const header=join(profile,'profile.json'),headerBytes=canonicalVerificationJson({version:1,profileId:effective.profileId,authorityId});
   const priorHeader=read(header);if(priorHeader!==undefined&&priorHeader!==headerBytes)throw Error('migration_publisher_conflict');atomic(header,headerBytes);
   const owners=join(profile,'owners');directory(owners);const target=join(owners,migrationOwnerFileName({profileId:effective.profileId,ownerKind:effective.ownerKind,ownerId:effective.ownerId}));
   const prior=read(target);
   if(prior!==undefined){const p=parseMigrationMarker(JSON.parse(prior));if(identity(p)!==identity(effective)||(p.state==='migrated'&&(effective.state!=='migrated'||p.importReceiptHash!==effective.importReceiptHash)))throw Error('migration_publisher_conflict');}
   current();atomic(target,canonicalVerificationJson(effective));current();syncDirectoryTreeStrict(root);
   runVerificationTransaction(db,()=>{const row=db.prepare('SELECT marker_json FROM migration_publication_intents WHERE owner_key=?').get(ownerKey) as {marker_json:string};if(row.marker_json!==canonicalVerificationJson(effective))throw Error('migration_publisher_conflict');db.prepare('UPDATE migration_publication_intents SET published=1 WHERE owner_key=?').run(ownerKey);});
   return effective;
  }finally{busy=false;}
 }
 return Object.freeze({publishPending(marker:Extract<MigrationMarker,{state:'pending'}>,token:object){return publish(marker,token,'pending');},publishMigrated(marker:Extract<MigrationMarker,{state:'migrated'}>,token:object){return publish(marker,token,'migrated');}});
}
