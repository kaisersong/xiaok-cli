import {randomUUID} from 'node:crypto';
import {chmodSync,closeSync,constants,fchmodSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync,type Stats} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Database} from 'better-sqlite3';
import {syncDirectoryTreeStrict,readOwnAtomicErrorCode} from '../../utils/atomic-file.js';
import {canonicalVerificationJson,VERIFICATION_BUDGET} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
import {migrationOwnerFileName,migrationProfileDirectoryName,parseMigrationMarker,type MigrationMarker} from './migration-markers.js';
import {createMainRootActivationClaimJournal} from './main-root-activation-claim.js';
import {createMainRootFamilyJournal} from './main-root-family-enrollment-journal.js';
import {createMigrationJournalSyncIo} from './migration-journal-sync-io.js';
const journalSdk=Object.freeze({randomUUID,chmodSync,closeSync,fchmodSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync});
const retainedJournalDatabases=new Set<object>();

interface Intent {owner_key:string;profile_id:string;marker_json:string;state:'pending'|'migrated';published:number;charged_bytes:number}

function identity(marker:Readonly<MigrationMarker>){if(marker.state==='migrated'){const {state:_state,importReceiptHash:_receipt,...facts}=marker;return canonicalVerificationJson(facts);}const {state:_state,...facts}=marker;return canonicalVerificationJson(facts);}
/** Private filesystem journal, NOT OS qualification. The sole installed controller
 * owns the namespace and database; its wrapper must check real service identity and
 * actual native authorization/import+source-fence facts before authorizing a token.
 */
export function createMigrationMarkerJournal(input:{root:string;database:Database;authorityId:string;assertCurrent():void;assertAuthorized(token:object,marker:Readonly<MigrationMarker>):void}){
 const {root,database:db,authorityId,assertCurrent,assertAuthorized}=input;
 const api:Record<string,unknown>={};
 const retainedJournal={api,database:db};
 const sourceIo=createMigrationJournalSyncIo(api,assertCurrent,()=>{retainedJournalDatabases.add(retainedJournal);});
 const invoke=sourceIo.invoke;
 const randomUUID:typeof journalSdk.randomUUID=((...args:unknown[])=>invoke('uuid',journalSdk.randomUUID,args)) as typeof journalSdk.randomUUID;
 const lstatSync:typeof journalSdk.lstatSync=((...args:unknown[])=>invoke('stat',journalSdk.lstatSync,args)) as typeof journalSdk.lstatSync;
 const fstatSync:typeof journalSdk.fstatSync=((...args:unknown[])=>invoke('fd-stat',journalSdk.fstatSync,args)) as typeof journalSdk.fstatSync;
 const openSync:typeof journalSdk.openSync=((...args:unknown[])=>{
  const flags=args[1],kind=typeof flags==='number'&&!(flags&(constants.O_WRONLY|constants.O_RDWR))?'fd-open-read':'fd-open';
  const fd=invoke(kind,journalSdk.openSync,args) as number;
  try{invoke('fd-stat',journalSdk.fstatSync,[fd,{bigint:true}]);}catch(error){try{invoke('fd-close',journalSdk.closeSync,[fd]);}catch(cleanup){throw new AggregateError([error,cleanup],'migration_journal_open_cleanup',{cause:error});}throw error;}
  return fd;
 }) as typeof journalSdk.openSync;
 const closeSync:typeof journalSdk.closeSync=((...args:unknown[])=>invoke('fd-close',journalSdk.closeSync,args)) as typeof journalSdk.closeSync;
 const mkdirSync:typeof journalSdk.mkdirSync=((...args:unknown[])=>invoke('mkdir',journalSdk.mkdirSync,args)) as typeof journalSdk.mkdirSync;
 const chmodSync:typeof journalSdk.chmodSync=((...args:unknown[])=>invoke('void',journalSdk.chmodSync,args)) as typeof journalSdk.chmodSync;
 const fchmodSync:typeof journalSdk.fchmodSync=((...args:unknown[])=>invoke('void',journalSdk.fchmodSync,args)) as typeof journalSdk.fchmodSync;
 const fsyncSync:typeof journalSdk.fsyncSync=((...args:unknown[])=>invoke('void',journalSdk.fsyncSync,args)) as typeof journalSdk.fsyncSync;
 const readFileSync:typeof journalSdk.readFileSync=((...args:unknown[])=>invoke('string',journalSdk.readFileSync,args)) as typeof journalSdk.readFileSync;
 const writeFileSync:typeof journalSdk.writeFileSync=((...args:unknown[])=>invoke('void',journalSdk.writeFileSync,args)) as typeof journalSdk.writeFileSync;
 const renameSync:typeof journalSdk.renameSync=((...args:unknown[])=>invoke('rename-temp',journalSdk.renameSync,args)) as typeof journalSdk.renameSync;
 const unlinkSync:typeof journalSdk.unlinkSync=((...args:unknown[])=>invoke('unlink-temp',journalSdk.unlinkSync,args)) as typeof journalSdk.unlinkSync;
 const rootStat=lstatSync(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o777)!==0o755||rootStat.blksize>4096)throw Error('migration_publisher_identity');
 db.exec('CREATE TABLE IF NOT EXISTS migration_publication_intents(owner_key TEXT PRIMARY KEY,profile_id TEXT NOT NULL,marker_json TEXT NOT NULL,state TEXT NOT NULL,published INTEGER NOT NULL,charged_bytes INTEGER NOT NULL)');
 let busy=false;
 function current(){sourceIo.invoke('current',()=>undefined,[]);const actual=lstatSync(root);if(actual.isSymbolicLink()||!actual.isDirectory()||actual.dev!==rootStat.dev||actual.ino!==rootStat.ino||actual.uid!==rootStat.uid||(actual.mode&0o777)!==0o755)throw Error('migration_publisher_identity');}
 function probe(path:string):Stats|undefined{try{return lstatSync(path);}catch(error){if(readOwnAtomicErrorCode(error)==='ENOENT')return undefined;throw error;}}
 function directory(path:string){let s=probe(path);if(!s){mkdirSync(path,{mode:0o755});chmodSync(path,0o755);s=lstatSync(path);}if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==rootStat.uid||(s.mode&0o777)!==0o755)throw Error('migration_publisher_identity');}
 function read(path:string):string|undefined{
  const s=probe(path);if(!s)return undefined;if(s.isSymbolicLink()||!s.isFile()||s.uid!==rootStat.uid||s.nlink!==1||(s.mode&0o777)!==0o644||s.size>4096)throw Error('migration_publisher_identity');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let value:string|undefined,failure:{error:unknown}|undefined;
  try{const actual=fstatSync(fd);if(actual.ino!==s.ino||actual.dev!==s.dev||actual.nlink!==1||actual.size>4096)throw Error('migration_publisher_identity');value=readFileSync(fd,'utf8');}catch(error){failure={error};}
  try{closeSync(fd);}catch(error){failure??={error};}
  if(failure)throw failure.error;return value;
 }
 function atomic(path:string,contents:string){
  const existing=read(path);if(existing===contents){syncDirectoryTreeStrict(dirname(path),{sourceContext:sourceIo.context});return;}
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
      syncDirectoryTreeStrict(dirname(path),{sourceContext:sourceIo.context});
  }
  catch (error) {
      settledBodyFailure = { error };
  }
  if (fd !== undefined) {
    try {closeSync(fd);} catch (error) {settledBodyFailure ??= {error};}
  }
  if (!renamed) {
    try {unlinkSync(temp);} catch (error) {if(readOwnAtomicErrorCode(error)!=='ENOENT')settledBodyFailure ??= {error};}
  }
  if (settledBodyFailure)
      throw settledBodyFailure.error;
 }
 function publish(raw:MigrationMarker,token:object,requested:'pending'|'migrated'){
  if(busy)throw Error('migration_publisher_reentrant');if(db.inTransaction)throw Error('migration_publisher_outer_transaction');busy=true;
  try{
   const marker=parseMigrationMarker(raw);if(marker.state!==requested||marker.authorityId!==authorityId)throw Error('migration_publisher_binding');current();sourceIo.invoke('void',assertAuthorized,[token,marker]);current();
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
   current();atomic(target,canonicalVerificationJson(effective));current();syncDirectoryTreeStrict(root,{sourceContext:sourceIo.context});
   runVerificationTransaction(db,()=>{const row=db.prepare('SELECT marker_json FROM migration_publication_intents WHERE owner_key=?').get(ownerKey) as {marker_json:string};if(row.marker_json!==canonicalVerificationJson(effective))throw Error('migration_publisher_conflict');db.prepare('UPDATE migration_publication_intents SET published=1 WHERE owner_key=?').run(ownerKey);});
   return effective;
  }finally{busy=false;}
 }
 const activationClaims=createMainRootActivationClaimJournal({database:db,authorityId,current});
 const mainRootFamily=createMainRootFamilyJournal({root,database:db,authorityId,current,directory,read,atomic,assertUnclaimed:activationClaims.assertMainRootFamilyUnclaimed,sync(){syncDirectoryTreeStrict(root,{sourceContext:sourceIo.context});},exclusive<T>(work:()=>T):T{if(busy)throw Error('migration_publisher_reentrant');busy=true;try{return work();}finally{busy=false;}}});
 const methods={...mainRootFamily,...activationClaims,closeMainRootFamily:sourceIo.close,assertMainRootFamilyPhysicalKnown:sourceIo.assertKnown,publishPending(marker:Extract<MigrationMarker,{state:'pending'}>,token:object){return publish(marker,token,'pending');},publishMigrated(marker:Extract<MigrationMarker,{state:'migrated'}>,token:object){return publish(marker,token,'migrated');}};
 Object.assign(api,methods);return Object.freeze(api) as typeof methods;
}
