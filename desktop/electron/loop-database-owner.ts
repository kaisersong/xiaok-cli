import {assertLoopSQLiteAutocommit,closeLoopSQLiteDatabase} from './loop-sqlite-autocommit.js';
import {assertLoopDatabaseBirthReady,openLoopDatabaseBirth,commitLoopDatabaseBirth,abortLoopDatabaseBirth,type LoopDatabaseBirth} from './loop-database-birth-custody.js';
import {assertOrdinarySourceWriterRoute} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {existsSync,lstatSync,mkdirSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createKnownDirectoryWriterFence} from '../../src/runtime/verification/known-directory-writer-fence.js';
import {createRoomTurnCustody,type RoomTurnCustody} from '../../src/runtime/verification/original-sdk-custody.js';
import {captureLoopSQLiteBindings} from './loop-sqlite-bindings.js';
const nativePrepare=DatabaseSync.prototype.prepare,nativeExec=DatabaseSync.prototype.exec,nativeRun=StatementSync.prototype.run,apply=Reflect.apply;
declare const sourceBrand:unique symbol;
export interface LoopDatabaseSource {readonly [sourceBrand]:true}
export type LoopDatabaseComponent='loop'|'completion'|'artifactScanner'|'healthScanner';
export interface LoopDatabaseLease {readonly database:DatabaseSync;runWrite(sql:string,...bindings:unknown[]):ReturnType<StatementSync['run']>;execWrite(sql:string):void;rollbackOwned():void;rollbackAssistantQualitySavepointOwned(name:string):void;failAssistantQualityOwned(raw:unknown):void;restoreForeignKeysOwned(enabled:boolean):void;recordComponent(component:LoopDatabaseComponent):void;close():void}
interface Owner {database:DatabaseSync;location:string;identity:string|undefined;stopped:boolean;closed:boolean;components:Set<LoopDatabaseComponent>;layoutRevision:number;retirement?:Error;stock:RoomTurnCustody;failures:{raw:unknown}[];inventoryFailure?:{raw:unknown};fence?:ReturnType<typeof createKnownDirectoryWriterFence>}
const sources=new WeakMap<object,Owner>();
const leases=new WeakMap<object,{owner:Owner;lease:LoopDatabaseLease}>(),heldOwners=new Set<Owner>();
function retain(owner:Owner,raw:unknown){heldOwners.add(owner);owner.failures.push({raw});try{owner.stock.inventory(raw);}catch(secondary){owner.inventoryFailure??={raw:secondary};owner.failures.push({raw:secondary});}}
function stop(owner:Owner){owner.stopped=true;try{if(!owner.closed){closeLoopSQLiteDatabase(owner.database);owner.closed=true;}if(owner.inventoryFailure)throw owner.inventoryFailure.raw;owner.stock.assertPhysicalKnown();heldOwners.delete(owner);}catch(raw){retain(owner,raw);throw raw;}}
function fresh(owner:Owner,closed:boolean){
 if(owner.retirement)throw owner.retirement;
 assertLoopDatabaseBirthReady();if(closed||owner.stopped)throw Error('loop_database_closed');if(owner.inventoryFailure)throw owner.inventoryFailure.raw;owner.stock.assertPhysicalKnown();
 try{assertOrdinarySourceWriterRoute();owner.fence?.assertOpen();assertOrdinarySourceWriterRoute();}
 catch(raw){if(!owner.retirement){owner.retirement=new Error('loop_ordinary_writer_retired',{cause:raw});retain(owner,raw);}throw owner.retirement;}
}
function filePath(input:string){const absolute=resolve(input);mkdirSync(dirname(absolute),{recursive:true});return existsSync(absolute)?realpathSync(absolute):join(realpathSync(dirname(absolute)),basename(absolute));}
function fileIdentity(path:string){if(!existsSync(path))return undefined;const stat=statSync(path,{bigint:true});return stat.ino>0n&&stat.dev>=0n?`${stat.dev}:${stat.ino}`:undefined;}
/** Main-owned connections only. Sources convey a local lifetime, never capacity
 * or execution authority. A group is published only after every open succeeds. */
export function createLoopDatabaseOwnerGroup(paths:readonly string[]){
 assertLoopDatabaseBirthReady();
 const owners:Owner[]=[],byPath=new Map<string,Owner>(),byIdentity=new Map<string,Owner>();
 const births:LoopDatabaseBirth[]=[];
 try{
  const result=paths.map(input=>{
   if(typeof input!=='string'||!input||input.includes('\0'))throw Error('loop_database_path');
   assertOrdinarySourceWriterRoute();
   const location=input===':memory:'?input:filePath(input),identity=input===':memory:'?undefined:fileIdentity(location);
   let owner=byPath.get(location)??(identity?byIdentity.get(identity):undefined);
   if(!owner){
    const birth=openLoopDatabaseBirth(location);births.push(birth);const database=birth.database;
    database.exec('PRAGMA journal_mode=WAL');database.exec('PRAGMA foreign_keys=ON');database.exec('PRAGMA busy_timeout=5000');owner={database,location,identity:location===':memory:'?undefined:fileIdentity(location),stopped:false,closed:false,components:new Set(),layoutRevision:0,stock:createRoomTurnCustody(),failures:[],fence:location===':memory:'?undefined:createKnownDirectoryWriterFence(dirname(location),'sqlite-db')};owners.push(owner);
    const openedIdentity=location===':memory:'?undefined:fileIdentity(location);if(openedIdentity)byIdentity.set(openedIdentity,owner);
   }
   if(location!==':memory:')byPath.set(realpathSync(location),owner);
   byPath.set(location,owner);const source=Object.freeze({}) as LoopDatabaseSource;sources.set(source,owner);return source;
  });
  const group=Object.freeze({sources:Object.freeze(result),close(){const errors:unknown[]=[];for(const owner of [...owners].reverse()){try{stop(owner);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'loop_database_close');}});
  for(let i=0;i<births.length;i++)commitLoopDatabaseBirth(births[i]!);
  return group;
 }catch(error){for(let i=0;i<owners.length;i++)owners[i]!.stopped=true;for(let i=births.length-1;i>=0;i--)abortLoopDatabaseBirth(births[i]!,error);throw error;}
}
export function openLoopDatabase(input:string|LoopDatabaseSource):LoopDatabaseLease {
 assertLoopDatabaseBirthReady();
 const standalone=typeof input==='string'?createLoopDatabaseOwnerGroup([input]):undefined;
 const source=standalone?.sources[0]??input,owner=source&&typeof source==='object'?sources.get(source):undefined;
 if(!owner)throw Error('loop_database_source');if(owner.stopped)throw Error('loop_database_closed');
 fresh(owner,false);
 let closed=false;
 const lease:LoopDatabaseLease=Object.freeze({
  get database(){assertLoopDatabaseBirthReady();if(closed||owner.stopped)throw Error('loop_database_closed');return owner.database;},
  runWrite(sql:string,...bindings:unknown[]){
   if(owner.retirement)throw owner.retirement;if(typeof sql!=='string')throw Error('loop_sqlite_sql');
   const snapshot=captureLoopSQLiteBindings(bindings);fresh(owner,closed);
   try{const statement=apply(nativePrepare,owner.database,[sql]);fresh(owner,closed);return apply(nativeRun,statement,snapshot);}
   catch(raw){retain(owner,raw);throw raw;}
  },
  execWrite(sql:string){if(owner.retirement)throw owner.retirement;if(typeof sql!=='string')throw Error('loop_sqlite_sql');fresh(owner,closed);try{apply(nativeExec,owner.database,[sql]);}catch(raw){retain(owner,raw);throw raw;}},
  rollbackOwned(){try{apply(nativeExec,owner.database,['ROLLBACK']);}catch(raw){retain(owner,raw);throw raw;}},
  failAssistantQualityOwned(raw:unknown){owner.stopped=true;retain(owner,raw);},
  rollbackAssistantQualitySavepointOwned(name:string){
   if(typeof name!=='string'||!/^assistant_quality_[a-f0-9]{32}$/.test(name))throw Error('assistant_quality_savepoint');
   const failures:unknown[]=[];for(const sql of ['ROLLBACK TO '+name,'RELEASE '+name])try{apply(nativeExec,owner.database,[sql]);}catch(raw){owner.stopped=true;retain(owner,raw);failures.push(raw);}
   if(failures.length===1)throw failures[0];if(failures.length)throw new AggregateError(failures,'assistant_quality_rollback',{cause:failures[0]});
  },
  restoreForeignKeysOwned(enabled:boolean){if(typeof enabled!=='boolean')throw Error('loop_sqlite_foreign_keys');try{apply(nativeExec,owner.database,[enabled?'PRAGMA foreign_keys=ON':'PRAGMA foreign_keys=OFF']);}catch(raw){retain(owner,raw);throw raw;}},
  recordComponent(component:LoopDatabaseComponent){fresh(owner,closed);if(!['loop','completion','artifactScanner','healthScanner'].includes(component))throw Error('loop_database_component');if(!owner.components.has(component)){owner.components.add(component);owner.layoutRevision++;}},
  close(){closed=true;standalone?.close();},
 });
 leases.set(lease,{owner,lease});return lease;
}

/** Only the actual constructor's original lease and exact original DB pair can
 * select the owned migration path. No callback, shape, or caller assertion. */
export function readOriginalLoopMigrationLease(value:unknown,database:DatabaseSync):LoopDatabaseLease {
 const row=value&&typeof value==='object'?leases.get(value):undefined;
 if(!row||row.owner.database!==database)throw Error('loop_database_lease');return row.lease;
}
export function rollbackOriginalLoopDatabase(value:unknown,database:DatabaseSync):void {
 readOriginalLoopMigrationLease(value,database).rollbackOwned();
}
export function retainOriginalLoopDatabaseFailure(value:unknown,database:DatabaseSync,raw:unknown):void {
 const row=value&&typeof value==='object'?leases.get(value):undefined;
 if(!row||row.owner.database!==database)throw Error('loop_database_lease');retain(row.owner,raw);
}

export interface LoopDatabaseMetadataFacts {
 readonly components:readonly LoopDatabaseComponent[];readonly layoutRevision:number;readonly layoutHash:string;
 readonly path:string;readonly physicalIdentity:string;readonly pageSize:number;readonly pageCount:number;
 readonly freelistCount:number;readonly maximumPageCount:number;readonly journalMode:string;
 readonly databaseBytes:number;readonly walBytes:number;readonly journalBytes:number;
}
/** Local physical observations only. These neither grant capacity nor prove
 * exclusion of another process; installed admission needs the broker custody. */
export function describeLoopDatabaseSource(source:LoopDatabaseSource):Readonly<LoopDatabaseMetadataFacts> {
 assertLoopDatabaseBirthReady();
 const owner=source&&typeof source==='object'?sources.get(source):undefined;
 if(!owner)throw Error('loop_database_source');if(owner.stopped)throw Error('loop_database_closed');
 assertLoopSQLiteAutocommit(owner.database,'loop_database_metadata_transaction');
 if(owner.location===':memory:'||!owner.identity)throw Error('loop_database_metadata_file');
 const identity=()=>{if(fileIdentity(owner.location)!==owner.identity)throw Error('loop_database_metadata_identity');};identity();
 const bytes=(path:string,optional=false)=>{try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||!Number.isSafeInteger(stat.size)||stat.size<0)throw Error('loop_database_metadata_file');return stat.size;}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return 0;throw error;}};
 const number=(pragma:string)=>{const value=Number(owner.database.prepare('PRAGMA '+pragma).get()?.[pragma]);if(!Number.isSafeInteger(value)||value<0)throw Error('loop_database_metadata_pragma');return value;};
 const components=Object.freeze([...owner.components].sort()),layoutRevision=owner.layoutRevision,layoutHash=createHash('sha256').update(JSON.stringify({version:1,components,layoutRevision})).digest('hex');
 const facts={components,layoutRevision,layoutHash,path:owner.location,physicalIdentity:owner.identity,pageSize:number('page_size'),pageCount:number('page_count'),freelistCount:number('freelist_count'),maximumPageCount:number('max_page_count'),journalMode:String(owner.database.prepare('PRAGMA journal_mode').get()?.journal_mode),databaseBytes:bytes(owner.location),walBytes:bytes(owner.location+'-wal',true),journalBytes:bytes(owner.location+'-journal',true)};
 identity();return Object.freeze(facts);
}
