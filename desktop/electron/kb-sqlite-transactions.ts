import {DatabaseSync} from 'node:sqlite';

const descriptor = Object.getOwnPropertyDescriptor;
const prototypeTransaction = descriptor(DatabaseSync.prototype,'isTransaction');
const nativeClose = DatabaseSync.prototype.close;
const apply = Reflect.apply, NativeError = Error;
interface Failure {primary:unknown;secondary:unknown[]}
interface Row {db:DatabaseSync;failure:Failure|undefined}
const held = new Set<Row>();

/** KB-only uncertain SDK resources cannot be replaced by another store birth. */
export function assertKbSQLiteBirthReady():void {
 for(const row of held)throw row.failure!.primary;
}

/** One original synchronous connection; callers cannot report transaction facts. */
export function createKbSQLiteTransactions(db:DatabaseSync) {
 const transactionDescriptor=descriptor(db,'isTransaction')??prototypeTransaction;
 const row:Row={db,failure:undefined};
 let owned=false,closed=false;
 function retain(primary:unknown,...secondary:unknown[]):void {
  if(!row.failure)row.failure={primary,secondary};
  else row.failure.secondary.push(primary,...secondary);
  held.add(row);
 }
 function ready():void {
  if(row.failure)throw row.failure.primary;
  if(closed)throw new NativeError('kb_sqlite_closed');
 }
 function active():boolean|undefined {
  ready();
  if(transactionDescriptor===undefined)return undefined;
  try{
   const getter=transactionDescriptor.get;
   if(typeof getter!=='function')throw new NativeError('kb_sqlite_transaction_state');
   const value:unknown=apply(getter,db,[]);
   if(typeof value!=='boolean')throw new NativeError('kb_sqlite_transaction_state',{cause:value});
   return value;
  }catch(raw){retain(raw);throw raw;}
 }
 function autocommit():void {
  ready();
  if(owned)throw new NativeError('assistant_knowledge_outer_transaction');
  const state=active();
  if(state===true)throw new NativeError('assistant_knowledge_outer_transaction');
  if(state===false)return;
  // Node22.14 has no state getter. A failed BEGIN could be post-call:
  // preserve the external owner and do not guess from the error message.
  try{db.exec('BEGIN DEFERRED');}
  catch(raw){const error=new NativeError('assistant_knowledge_outer_transaction',{cause:raw});retain(error,raw);throw error;}
  try{db.exec('ROLLBACK');}catch(raw){retain(raw);throw raw;}
 }
 function own<T>(body:()=>T):T {
  try{db.exec('BEGIN IMMEDIATE');}catch(raw){retain(raw);throw raw;}
  owned=true;
  try{
   const value=body();db.exec('COMMIT');owned=false;return value;
  }catch(primary){
   // Only this owner rolls back its confirmed BEGIN. Nested operations join
   // without another catch, so the original error cannot be replaced twice.
   try{db.exec('ROLLBACK');owned=false;}catch(secondary){retain(primary,secondary);}
   throw primary;
  }
 }
 return {
  ready,
  run<T>(body:()=>T):T {ready();if(owned||active()===true)return body();return own(body);},
  exclusive<T>(body:()=>T):T {autocommit();return own(body);},
  close():void {
   try{
    const returned=apply(nativeClose,db,[]);
    if(returned!==undefined)throw new NativeError('kb_sqlite_close_nonvoid',{cause:returned});
   }catch(raw){retain(raw);throw raw;}
   closed=true;owned=false;held.delete(row);row.failure=undefined;
  },
 };
}
