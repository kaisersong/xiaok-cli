import {mkdtempSync,openSync,writeFileSync,closeSync,fstatSync,lstatSync,unlinkSync,rmdirSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from './builtin-sqlite.js';
import {DatabaseSync} from 'node:sqlite';
const nativeClose=DatabaseSync.prototype.close,apply=Reflect.apply;
const failures=new WeakSet<object>(),addFailure=WeakSet.prototype.add,hasFailure=WeakSet.prototype.has;
function retain(error:unknown):void{if(error&&typeof error==='object')apply(addFailure,failures,[error]);}
export function isSqliteParsingCopyCleanupUnknown(error:unknown):boolean{return !!error&&typeof error==='object'&&apply(hasFailure,failures,[error]);}

/** Disposable parser input, never a source identity, installed authority or real user database. */
export function openSqliteParsingCopy(bytes:Buffer,readonly:boolean){
 const root=mkdtempSync(join(tmpdir(),'xiaok-sqlite-parser-')),rootIdentity=lstatSync(root),path=join(root,'snapshot.sqlite');
 let identity:ReturnType<typeof lstatSync>|undefined,database:Database|undefined,closed=false,nativeClosed=false,descriptor:number|undefined;
 function remove(){
  const directory=lstatSync(root),file=lstatSync(path);
  if(directory.isSymbolicLink()||directory.dev!==rootIdentity.dev||directory.ino!==rootIdentity.ino||!identity||file.isSymbolicLink()||file.nlink!==1||file.dev!==identity.dev||file.ino!==identity.ino)throw Error('source_sqlite_parser_copy_changed');
  unlinkSync(path);rmdirSync(root);
 }
 try{
  descriptor=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
  try{identity=fstatSync(descriptor);writeFileSync(descriptor,bytes);}finally{closeSync(descriptor);descriptor=undefined;}
  database=new Database(path,{readonly,fileMustExist:true,timeout:0});
  const isOpen=Object.getOwnPropertyDescriptor(database,'isOpen')!.get!;
  return {database,close(){if(closed)return;try{if(!nativeClosed){apply(nativeClose,database!,[]);if(apply(isOpen,database!,[])!==false)throw Error('source_sqlite_parser_close_unconfirmed');nativeClosed=true;}remove();closed=true;}catch(error){retain(error);throw error;}}};
 }catch(error){try{if(descriptor!==undefined)throw Error('source_sqlite_parser_descriptor_close_unconfirmed');if(database?.open)apply(nativeClose,database,[]);if(identity)remove();else rmdirSync(root);}catch(cleanup){const failure=new AggregateError([error,cleanup],'source_sqlite_parser_cleanup_unknown');retain(failure);throw failure;}throw error;}
}
