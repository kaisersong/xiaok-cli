import {DatabaseSync,StatementSync,type DatabaseSyncOptions,type SQLInputValue} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {types} from 'node:util';
const isAsyncFunction=types.isAsyncFunction,isPromise=types.isPromise,isProxy=types.isProxy;
const ownDescriptor=Object.getOwnPropertyDescriptor,prototype=Object.getPrototypeOf,apply=Reflect.apply,own=Object.hasOwn,nativeThen=Promise.prototype.then;
const NativePromise=Promise,promisePrototype=Promise.prototype,promiseSpecies=ownDescriptor(Promise,Symbol.species)!.get;
function observeNativeRejection(value:unknown):void{
 if(!isPromise(value)||prototype(value)!==promisePrototype||ownDescriptor(value,'constructor'))return;
 const constructor=ownDescriptor(promisePrototype,'constructor'),species=ownDescriptor(NativePromise,Symbol.species);
 if(constructor&&own(constructor,'value')&&constructor.value===NativePromise&&species&&own(species,'get')&&species.get===promiseSpecies)apply(nativeThen,value,[undefined,()=>{}]);
}
function assertSynchronousResult(value:unknown):void{
 if(!value||(typeof value!=='object'&&typeof value!=='function'))return;
 if(isProxy(value))throw Error('sqlite_async_transaction_forbidden');
 if(isPromise(value))throw Error('sqlite_async_transaction_forbidden',{cause:value});
 let cursor:object|null=value,depth=0;
 while(cursor!==null){if(isProxy(cursor)||++depth>128)throw Error('sqlite_transaction_result_unconfirmed');const then=ownDescriptor(cursor,'then');if(then){if(!own(then,'value')||typeof then.value==='function')throw Error('sqlite_async_transaction_forbidden');return;}cursor=prototype(cursor);}
}

/** Store conveniences over the runtime's own SQLite. No addon or alternate driver. */
export interface Options {readonly?:boolean;fileMustExist?:boolean;timeout?:number;verbose?:null;nativeBinding?:null}
export interface RunResult {changes:number|bigint;lastInsertRowid:number|bigint}
type NativeBase=Omit<DatabaseSync,'open'|'prepare'|'exec'|'close'|'function'|'loadExtension'>;
const OriginalDatabase=DatabaseSync,OriginalStatement=StatementSync;
const Base=OriginalDatabase as unknown as {new(path:string,options?:DatabaseSyncOptions):NativeBase};
const nativePrepare=OriginalDatabase.prototype.prepare,nativeExec=OriginalDatabase.prototype.exec,nativeClose=OriginalDatabase.prototype.close,nativeFunction=OriginalDatabase.prototype.function;
const statementRun=OriginalStatement.prototype.run,statementGet=OriginalStatement.prototype.get,statementAll=OriginalStatement.prototype.all,statementIterate=OriginalStatement.prototype.iterate,statementColumns=OriginalStatement.prototype.columns,statementRaw=OriginalStatement.prototype.setReturnArrays,statementBigInts=OriginalStatement.prototype.setReadBigInts,statementBare=OriginalStatement.prototype.setAllowBareNamedParameters,statementUnknown=OriginalStatement.prototype.setAllowUnknownNamedParameters;
let savepointId=0;
function parameters(input:unknown[]):SQLInputValue[]{
 const args=input.length===1&&Array.isArray(input[0])?input[0]:input;
 return args.map(value=>value===undefined?null:value&&typeof value==='object'&&!ArrayBuffer.isView(value)?Object.fromEntries(Object.entries(value).map(([key,cell])=>[key,cell===undefined?null:cell])):value) as SQLInputValue[];
}
function copyValue(value:unknown):unknown{return value instanceof Uint8Array?Buffer.copyBytesFrom(value):value;}
function copyRow(value:unknown):any{
 if(Array.isArray(value))return value.map(copyValue);
 if(value===undefined)return undefined;
 return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,cell])=>[key,copyValue(cell)]));
}
export class Statement<BindParameters extends unknown[]|{}=unknown[],Result=unknown>{
 #native:StatementSync;#source:()=>string;#bound:unknown[]|undefined;#pluck=false;
 readonly database:Database;
 constructor(statement:StatementSync,database:Database){this.#native=statement;this.database=database;const metadata=ownDescriptor(statement,'sourceSQL')??ownDescriptor(OriginalStatement.prototype,'sourceSQL');if(metadata?.get){const getter=metadata.get;this.#source=()=>apply(getter,statement,[]);}else if(metadata&&own(metadata,'value')&&typeof metadata.value==='string'){const value=metadata.value;this.#source=()=>value;}else throw Error('sqlite_source_metadata_required');apply(statementBare,statement,[true]);apply(statementUnknown,statement,[true]);}
 get source():string{return this.#source();}
 get reader():boolean{return apply(statementColumns,this.#native,[]).length>0;}
 #args(args:unknown[]):SQLInputValue[]{if(this.#bound){if(args.length)throw Error('sqlite_statement_already_bound');return parameters(this.#bound);}return parameters(args);}
 #row(row:unknown):any{if(row===undefined)return undefined;const copied=copyRow(row);return this.#pluck?(Array.isArray(copied)?copied[0]:Object.values(copied)[0]):copied;}
 run(...args:unknown[]):RunResult{return apply(statementRun,this.#native,this.#args(args));}
 get(...args:unknown[]):Result|undefined{return this.#row(apply(statementGet,this.#native,this.#args(args)));}
 all(...args:unknown[]):Result[]{return apply(statementAll,this.#native,this.#args(args)).map((row:unknown)=>this.#row(row));}
 *iterate(...args:unknown[]):IterableIterator<Result>{for(const row of apply(statementIterate,this.#native,this.#args(args)))yield this.#row(row);}
 raw(enabled=true):this{apply(statementRaw,this.#native,[enabled]);return this;}
 safeIntegers(enabled=true):this{apply(statementBigInts,this.#native,[enabled]);return this;}
 pluck(enabled=true):this{this.#pluck=enabled;return this;}
 bind(...args:unknown[]):this{if(this.#bound)throw Error('sqlite_statement_already_bound');this.#bound=parameters(args);return this;}
 columns():ReturnType<StatementSync['columns']>{return apply(statementColumns,this.#native,[]);}
}
export type Transaction<F extends (...args:any[])=>any>=F&{deferred:F;immediate:F;exclusive:F};
export class Database extends Base{
 readonly name:string;readonly readonly:boolean;readonly memory:boolean;
 constructor(path=':memory:',options:Options={}){
  if(typeof path!=='string')throw TypeError('sqlite_path_must_be_string');
  if(typeof OriginalStatement.prototype.setReturnArrays!=='function'||typeof OriginalStatement.prototype.columns!=='function')throw Error('sqlite_requires_node_22_22_1_or_later');
  if(options.verbose!=null||options.nativeBinding!=null)throw Error('sqlite_external_driver_options_unsupported');
  const timeout=options.timeout??5000;if(!Number.isInteger(timeout)||timeout<0||timeout>2147483647)throw RangeError('sqlite_timeout_invalid');
  let location=path;
  if(options.fileMustExist&&path!==':memory:'){const url=pathToFileURL(resolve(path));url.searchParams.set('mode',options.readonly?'ro':'rw');location=url.href;}
  super(location,{readOnly:options.readonly??false,enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false});
  this.name=path;this.readonly=options.readonly??false;this.memory=path===':memory:';
  try{
   const opened=Object.getOwnPropertyDescriptor(this,'isOpen')?.get,transaction=Object.getOwnPropertyDescriptor(this,'isTransaction')?.get;
   if(!opened||!transaction)throw Error('sqlite_native_state_getters_required');
   Object.defineProperties(this,{open:{get:opened,configurable:false},inTransaction:{get:transaction,configurable:false}});
   for(const key of ['name','readonly','memory'])Object.defineProperty(this,key,{writable:false,configurable:false});
   this.exec('PRAGMA busy_timeout='+timeout);
  }catch(error){try{this.close();}catch(cleanup){throw new AggregateError([error,cleanup],'sqlite_constructor_cleanup_unknown');}throw error;}
 }
 get open():boolean{return this.isOpen;}
 get inTransaction():boolean{return this.isTransaction;}
 exec(sql:string):this{Reflect.apply(nativeExec,this,[sql]);return this;}
 close():this{Reflect.apply(nativeClose,this,[]);return this;}
 prepare<BindParameters extends unknown[]|{}=unknown[],Result=unknown>(sql:string):Statement<BindParameters,Result>{return new Statement(Reflect.apply(nativePrepare,this,[sql]),this);}
 pragma(source:string,options?:{simple?:boolean}):any{const statement=new Statement(Reflect.apply(nativePrepare,this,['PRAGMA '+source]),this);return options?.simple?statement.pluck().get():statement.all();}
 transaction<F extends (...args:any[])=>any>(work:F):Transaction<F>{
  if(typeof work!=='function')throw TypeError('sqlite_transaction_function_required');
  if(isProxy(work)||isAsyncFunction(work))throw Error('sqlite_async_transaction_forbidden');
  const database=this;
  const variant=(mode:'DEFERRED'|'IMMEDIATE'|'EXCLUSIVE')=>function(this:unknown,...args:Parameters<F>):ReturnType<F>{
   const nested=database.inTransaction,savepoint='xiaok_sp_'+(++savepointId);
   database.exec(nested?'SAVEPOINT '+savepoint:'BEGIN '+mode);
   let result:ReturnType<F>|undefined;
   try{const completed=Reflect.apply(work,this,args);result=completed;assertSynchronousResult(completed);database.exec(nested?'RELEASE '+savepoint:'COMMIT');return completed;}
   catch(error){try{if(database.inTransaction){database.exec(nested?'ROLLBACK TO '+savepoint:'ROLLBACK');if(nested)database.exec('RELEASE '+savepoint);}}catch(cleanup){throw new AggregateError([error,cleanup],'sqlite_transaction_rollback_unknown');}try{observeNativeRejection(result);}catch(observation){throw new AggregateError([error,observation],'sqlite_transaction_promise_unconfirmed');}throw error;}
  } as F;
  const deferred=variant('DEFERRED'),immediate=variant('IMMEDIATE'),exclusive=variant('EXCLUSIVE');
  return Object.assign(deferred,{deferred,immediate,exclusive});
 }
 function(name:string,optionsOrFn:Record<string,unknown>|((...args:any[])=>any),fn?:(...args:any[])=>any):this{
  if(typeof optionsOrFn==='function')Reflect.apply(nativeFunction,this,[name,optionsOrFn]);else Reflect.apply(nativeFunction,this,[name,optionsOrFn,fn]);return this;
 }
}
type Connection=Database;type PreparedStatement<B extends unknown[]|{}=unknown[],R=unknown>=Statement<B,R>;type OpenOptions=Options;
export namespace Database{export type Database=Connection;export type Statement<B extends unknown[]|{}=unknown[],R=unknown>=PreparedStatement<B,R>;export type Options=OpenOptions;}
export default Database;
