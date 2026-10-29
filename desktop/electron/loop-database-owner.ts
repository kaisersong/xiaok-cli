import {assertOrdinarySourceWriterRoute} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import {existsSync,lstatSync,mkdirSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
declare const sourceBrand:unique symbol;
export interface LoopDatabaseSource {readonly [sourceBrand]:true}
export type LoopDatabaseComponent='loop'|'completion'|'artifactScanner'|'healthScanner';
export interface LoopDatabaseLease {readonly database:DatabaseSync;recordComponent(component:LoopDatabaseComponent):void;close():void}
interface Owner {database:DatabaseSync;location:string;identity:string|undefined;stopped:boolean;closed:boolean;components:Set<LoopDatabaseComponent>;layoutRevision:number}
const sources=new WeakMap<object,Owner>();
function stop(owner:Owner){owner.stopped=true;if(!owner.closed){owner.database.close();owner.closed=true;}}
function filePath(input:string){const absolute=resolve(input);mkdirSync(dirname(absolute),{recursive:true});return existsSync(absolute)?realpathSync(absolute):join(realpathSync(dirname(absolute)),basename(absolute));}
function fileIdentity(path:string){if(!existsSync(path))return undefined;const stat=statSync(path,{bigint:true});return stat.ino>0n&&stat.dev>=0n?`${stat.dev}:${stat.ino}`:undefined;}
/** Main-owned connections only. Sources convey a local lifetime, never capacity
 * or execution authority. A group is published only after every open succeeds. */
export function createLoopDatabaseOwnerGroup(paths:readonly string[]){
 const owners:Owner[]=[],byPath=new Map<string,Owner>(),byIdentity=new Map<string,Owner>();
 try{
  const result=paths.map(input=>{
   if(typeof input!=='string'||!input||input.includes('\0'))throw Error('loop_database_path');
   assertOrdinarySourceWriterRoute();
   const location=input===':memory:'?input:filePath(input),identity=input===':memory:'?undefined:fileIdentity(location);
   let owner=byPath.get(location)??(identity?byIdentity.get(identity):undefined);
   if(!owner){
    const database=new DatabaseSync(location);try{database.exec('PRAGMA journal_mode=WAL');database.exec('PRAGMA foreign_keys=ON');database.exec('PRAGMA busy_timeout=5000');owner={database,location,identity:location===':memory:'?undefined:fileIdentity(location),stopped:false,closed:false,components:new Set(),layoutRevision:0};owners.push(owner);}
    catch(error){try{database.close();}catch{/* Keep the initialization error. */}throw error;}
    const openedIdentity=location===':memory:'?undefined:fileIdentity(location);if(openedIdentity)byIdentity.set(openedIdentity,owner);
   }
   if(location!==':memory:')byPath.set(realpathSync(location),owner);
   byPath.set(location,owner);const source=Object.freeze({}) as LoopDatabaseSource;sources.set(source,owner);return source;
  });
  return Object.freeze({sources:Object.freeze(result),close(){const errors:unknown[]=[];for(const owner of [...owners].reverse()){try{stop(owner);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'loop_database_close');}});
 }catch(error){for(const owner of owners.reverse()){try{stop(owner);}catch{/* Retain the original initialization error. */}}throw error;}
}
export function openLoopDatabase(input:string|LoopDatabaseSource):LoopDatabaseLease {
 const standalone=typeof input==='string'?createLoopDatabaseOwnerGroup([input]):undefined;
 const source=standalone?.sources[0]??input,owner=source&&typeof source==='object'?sources.get(source):undefined;
 if(!owner)throw Error('loop_database_source');if(owner.stopped)throw Error('loop_database_closed');
 if(!standalone)assertOrdinarySourceWriterRoute();
 let closed=false;
 return Object.freeze({get database(){if(closed||owner.stopped)throw Error('loop_database_closed');return owner.database;},recordComponent(component:LoopDatabaseComponent){if(closed||owner.stopped)throw Error('loop_database_closed');if(!['loop','completion','artifactScanner','healthScanner'].includes(component))throw Error('loop_database_component');if(!owner.components.has(component)){owner.components.add(component);owner.layoutRevision++;}},close(){closed=true;standalone?.close();}});
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
 const owner=source&&typeof source==='object'?sources.get(source):undefined;
 if(!owner)throw Error('loop_database_source');if(owner.stopped)throw Error('loop_database_closed');
 if(owner.database.isTransaction)throw Error('loop_database_metadata_transaction');
 if(owner.location===':memory:'||!owner.identity)throw Error('loop_database_metadata_file');
 const identity=()=>{if(fileIdentity(owner.location)!==owner.identity)throw Error('loop_database_metadata_identity');};identity();
 const bytes=(path:string,optional=false)=>{try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||!Number.isSafeInteger(stat.size)||stat.size<0)throw Error('loop_database_metadata_file');return stat.size;}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return 0;throw error;}};
 const number=(pragma:string)=>{const value=Number(owner.database.prepare('PRAGMA '+pragma).get()?.[pragma]);if(!Number.isSafeInteger(value)||value<0)throw Error('loop_database_metadata_pragma');return value;};
 const components=Object.freeze([...owner.components].sort()),layoutRevision=owner.layoutRevision,layoutHash=createHash('sha256').update(JSON.stringify({version:1,components,layoutRevision})).digest('hex');
 const facts={components,layoutRevision,layoutHash,path:owner.location,physicalIdentity:owner.identity,pageSize:number('page_size'),pageCount:number('page_count'),freelistCount:number('freelist_count'),maximumPageCount:number('max_page_count'),journalMode:String(owner.database.prepare('PRAGMA journal_mode').get()?.journal_mode),databaseBytes:bytes(owner.location),walBytes:bytes(owner.location+'-wal',true),journalBytes:bytes(owner.location+'-journal',true)};
 identity();return Object.freeze(facts);
}
