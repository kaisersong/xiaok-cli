import {DatabaseSync,StatementSync} from 'node:sqlite';
import {constants,openSync,closeSync,lstatSync,fstatSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname,resolve,join,basename} from 'node:path';
import {types} from 'node:util';
import {createRoomTurnCustody} from '../../../src/runtime/verification/original-sdk-custody.js';
import {assertOrdinarySourceWriterRoute} from '../../../src/runtime/verification/ordinary-source-writer-observation.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
import {createProtectedChildCallbackCustody} from '../protected-child-callback-custody.js';
const NativeDatabase=DatabaseSync,prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec,close=DatabaseSync.prototype.close;
const run=StatementSync.prototype.run,get=StatementSync.prototype.get,all=StatementSync.prototype.all;
const apply=Reflect.apply,define=Object.defineProperty;
const databasePrototype=NativeDatabase.prototype;
const nativeDatabaseDescriptors=Object.getOwnPropertyDescriptors(databasePrototype);
const nativeConstructorDescriptors=Object.getOwnPropertyDescriptors(NativeDatabase);
const releaseMetadata=()=>{};
/** Fixed actual SQLite intrinsic descriptors are API, not arbitrary DTO getters.
 * Every extra own/symbol tail remains strict resource inventory. */
function captureConstructor(row:Row):void{
 const project=(value:object,baseline:Record<string,PropertyDescriptor>,skipConstructor=false)=>{
  const box=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
   const d=Object.getOwnPropertyDescriptor(value,key)!;
   if(typeof key==='string'&&key==='constructor'&&skipConstructor){if(d.value!==NativeDatabase)throw Error('continuity_database_intrinsic_changed');continue;}
   if(value===NativeDatabase&&key==='prototype'){if(d.value!==databasePrototype)throw Error('continuity_database_intrinsic_changed');continue;}
   if(typeof key==='string'&&baseline[key]&&(d.get||d.set)){const original=baseline[key]!;if(d.get!==original.get||d.set!==original.set||d.enumerable!==original.enumerable||d.configurable!==original.configurable)throw Error('continuity_database_intrinsic_changed');if(d.get)row.callbacks.capture(d.get);if(d.set)row.callbacks.capture(d.set);continue;}
   Object.defineProperty(box,key,d);
  }
  return box;
 };
 const box=Object.assign(Object.create(null),{constructorMetadata:project(NativeDatabase,nativeConstructorDescriptors),prototypeMetadata:project(databasePrototype,nativeDatabaseDescriptors,true)});
 const stock=createRoomTurnCustody();row.stocks.push(stock);stock.sdk(()=>box,undefined,[],{accept:value=>value===box,consumer:releaseMetadata,strictProxyGraph:true});stock.consumeResource(releaseMetadata,box,[]);stock.assertPhysicalKnown();row.callbacks.assertPhysicalKnown();
}
interface Row{stocks:ReturnType<typeof createRoomTurnCustody>[];callbacks:ReturnType<typeof createProtectedChildCallbackCustody>;database?:DatabaseSync;closed:boolean;failed:boolean;raws:unknown[];unknownFds:{fd:number;raw:unknown}[];closeEntered?:boolean;first?:{raw:unknown};fence?:ReturnType<typeof createKnownDirectoryWriterFence>}
const rows=new WeakMap<object,Row>(),held=new Set<Row>();
function retain(row:Row,raw:unknown){row.first??={raw};row.raws.push(raw);held.add(row);const stock=createRoomTurnCustody();row.stocks.push(stock);try{stock.inventory(raw);}catch(extra){row.failed=true;row.raws.push(extra);}}
function check(row:Row){if(row.closed||row.failed)throw Error('continuity_database_unavailable',{cause:row.first?.raw});assertOrdinarySourceWriterRoute();row.fence?.assertOpen();for(const stock of row.stocks)stock.assertPhysicalKnown();}
function invoke<T>(row:Row,fn:Function,receiver:unknown,args:unknown[]):T{
 check(row);row.callbacks.capture(fn);let value!:T;
 const stock=createRoomTurnCustody();row.stocks.push(stock);try{stock.syncVoid(()=>{value=apply(fn,receiver,args);},undefined,[]);stock.inventory(value);stock.assertPhysicalKnown();return value;}catch(raw){retain(row,raw);throw raw;}
}
function identity(path:string){const s=lstatSync(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||(typeof process.getuid==='function'&&s.uid!==BigInt(process.getuid()))||(process.platform!=='win32'&&(s.mode&0o077n)!==0n))throw Error('continuity_database_identity');return s;}
function closeFd(row:Row,fd:number):void{try{closeSync(fd);}catch(raw){row.failed=true;row.unknownFds.push({fd,raw});retain(row,raw);throw raw;}}
function same(a:ReturnType<typeof identity>,b:ReturnType<typeof identity>,path:string,row:Row){
 if(a.ino!==b.ino||a.ino<=0n)throw Error('continuity_database_replaced');
 if(a.dev===b.dev)return;
 if(process.platform!=='win32'||a.dev!==0n||b.dev<=0n)throw Error('continuity_database_replaced');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let first:{raw:unknown}|undefined;
 try{const witness=fstatSync(fd,{bigint:true}),after=identity(path);if(witness.dev!==b.dev||witness.ino!==b.ino||witness.nlink!==1n||after.ino!==a.ino||after.dev!==a.dev||after.size!==a.size)throw Error('continuity_database_replaced');}catch(raw){first={raw};}
 try{closeFd(row,fd);}catch(raw){if(first)throw new AggregateError([first.raw,raw],'continuity_database_probe_unconfirmed',{cause:first.raw});throw raw;}if(first)throw first.raw;
}
/** Ordinary Main database lifetime only. Never a Native role or execution grant. */
export function openContinuityDatabase(path:string):DatabaseSync{
 for(const previous of held)if(previous.failed||!previous.database&&!previous.closed)throw Error('continuity_database_birth_unconfirmed',{cause:previous.first?.raw});
 assertOrdinarySourceWriterRoute();if(typeof path!=='string'||!path||path.includes('\0')||resolve(path)!==path)throw Error('continuity_database_path');
 const requestedParent=dirname(path);mkdirSync(requestedParent,{recursive:true,mode:0o700});const parentStat=lstatSync(requestedParent,{bigint:true});if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||(typeof process.getuid==='function'&&parentStat.uid!==BigInt(process.getuid()))||(process.platform!=='win32'&&(parentStat.mode&0o022n)!==0n))throw Error('continuity_database_path');const parent=realpathSync(requestedParent);path=join(parent,basename(path));
 const row:Row={stocks:[],callbacks:createProtectedChildCallbackCustody(),closed:false,failed:false,raws:[],unknownFds:[]};held.add(row);
 let fd:number|undefined;
 try{
  try{fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|(constants.O_NOFOLLOW??0),0o600);}catch(raw){if(types.isProxy(raw)||!(raw instanceof Error)||Object.getOwnPropertyDescriptor(raw,'code')?.value!=='EEXIST')throw raw;fd=openSync(path,constants.O_RDWR|(constants.O_NOFOLLOW??0));}
  const before=identity(path),actual=fstatSync(fd,{bigint:true});same(before,actual as ReturnType<typeof identity>,path,row);row.fence=createKnownDirectoryWriterFence(parent,'sqlite-db');row.fence.assertOpen();
  captureConstructor(row);row.failed=true;row.database=new NativeDatabase(path);row.failed=false;same(before,identity(path),path,row);same(before,fstatSync(fd,{bigint:true}) as ReturnType<typeof identity>,path,row);
  const database=row.database;rows.set(database,row);
  // Keep actual native receivers; wrapped results carry no synthetic physical proof.
  define(database,'prepare',{configurable:false,value:(sql:string)=>{let statement!:StatementSync;check(row);row.callbacks.capture(prepare);const stock=createRoomTurnCustody();row.stocks.push(stock);try{stock.syncVoid(()=>{statement=apply(prepare,database,[sql]);},undefined,[]);}catch(raw){retain(row,raw);throw raw;}
   for(const [name,fn] of [['run',run],['get',get],['all',all]] as const)define(statement,name,{value:(...args:unknown[])=>{return invoke<unknown>(row,fn,statement,args);}});
   return statement;
  }});
  define(database,'exec',{value:(sql:string)=>{check(row);row.callbacks.capture(exec);const stock=createRoomTurnCustody();row.stocks.push(stock);try{stock.syncVoid(()=>{apply(exec,database,[sql]);},undefined,[]);}catch(raw){retain(row,raw);throw raw;}}});
  define(database,'close',{value:()=>closeContinuityDatabase(database)});const closingFd=fd;fd=undefined;closeFd(row,closingFd);held.delete(row);return database;
 }catch(raw){retain(row,raw);if(row.database)try{apply(close,row.database,[]);row.closed=true;}catch(extra){retain(row,extra);}if(fd!==undefined){const closingFd=fd;fd=undefined;try{closeFd(row,closingFd);}catch(extra){retain(row,extra);}}throw raw;}

}
export function closeContinuityDatabase(database:DatabaseSync):void{
 const row=rows.get(database);if(!row)throw Error('continuity_database_source');const errors:unknown[]=[];
 try{if(!row.closed){if(row.closeEntered)throw Error('continuity_database_close_unknown',{cause:row.first?.raw});row.closeEntered=true;row.callbacks.capture(close);const stock=createRoomTurnCustody();row.stocks.push(stock);stock.syncVoid(()=>{apply(close,database,[]);},undefined,[]);row.closed=true;}}catch(raw){row.failed=true;retain(row,raw);errors.push(raw);}
 try{row.callbacks.assertPhysicalKnown();}catch(raw){retain(row,raw);errors.push(raw);}
 for(const stock of [...row.stocks])try{stock.assertPhysicalKnown();}catch(raw){retain(row,raw);errors.push(raw);}
 if(row.failed||row.unknownFds.length)errors.push(Error('continuity_database_physical_unknown',{cause:row.first?.raw}));
 if(errors.length)throw new AggregateError(errors,'continuity_database_close_unconfirmed',{cause:row.first?.raw});held.delete(row);
}
