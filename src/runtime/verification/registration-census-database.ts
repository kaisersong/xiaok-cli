import type {Database} from 'better-sqlite3';
import {isDeepStrictEqual as initialIsDeepStrictEqual,types} from 'node:util';
const isDeepStrictEqual=initialIsDeepStrictEqual;
import {readPrivateDatabaseNativeAccess} from './private-database.js';
import {assertRegistrationIntrinsics,assertRegistrationWeakMapIntrinsics} from './registration-intrinsics.js';
import {assertNativeSqliteArrayConstruction,assertNativeSqliteColumnConstruction} from './native-sqlite-construction-intrinsics.js';
const isProxy=types.isProxy,freeze=Object.freeze;
const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,prototype=Object.getPrototypeOf;
const define=Object.defineProperty,nativePush=Array.prototype.push;
function append<T>(array:T[],value:T):void{define(array,array.length,{__proto__:null,value,enumerable:true,writable:true,configurable:true} as PropertyDescriptor);}
// Only private native result arrays, after the complete closing intrinsic
// fence. Parameter arrays before that fence retain defineProperty above.
function appendResult<T>(array:T[],value:T):void{apply(nativePush,array,[value]);}
export const REGISTRATION_TABLE_KEYS=freeze({verification_owner_dependencies:'parent_key',owner_enrollment_intents:'logical_owner_key',verification_registered_owners:'owner_key',verification_owners:'owner_key',mandatory_observation_checks:'owner_key',verification_registered_invocations:'owner_key',owner_enrollment_invocation_receipts:'owner_key',owner_enrollment_goal_sessions:'owner_key',owner_enrollment_loop_subjects:'owner_key',owner_enrollment_intent_contracts:'owner_key',owner_enrollment_kswarm_subjects:'logical_owner_key',migration_publication_intents:'owner_key',verification_application_pointers:'owner_key',verification_application_history:'owner_key',verification_application_transitions:'owner_key'} as const);
const tables=[...Object.keys(REGISTRATION_TABLE_KEYS),'verification_profiles','verification_storage_features'];
const lower=(v:string)=>v.replace(/[A-Z]/g,c=>c.toLowerCase());
function fail():never{throw Error('application_registration_changed');}
/** Per-call full SQL census only. No row/permission/clock/current result crosses a checkpoint. */
export function createRegistrationCensusDatabase(db:Database){
 assertRegistrationWeakMapIntrinsics();
 const native=readPrivateDatabaseNativeAccess(db);if(!native)return undefined;
 function current(){
  assertRegistrationIntrinsics();
  if(isProxy(db)||descriptor(db,native!.symbol)?.value!==native!.cpp||prototype(db)!==native!.databasePrototype||prototype(native!.cpp)!==native!.cppPrototype)fail();
  for(let i=0;i<native!.fingerprints.length;i++){const entry=native!.fingerprints[i]!;if(!isDeepStrictEqual(descriptor(entry.target,entry.key),entry.descriptor))fail();}
  if(apply(native!.open,native!.cpp,[])!==true)fail();
 }
 const prepare=(sql:string)=>apply(native.prepare,native.cpp,[sql,db,false,false]);
 const call=(key:string,stmt:object,args:unknown[]=[])=>apply(native.statement[key]!,stmt,args);
 // Only counter() calls raw, after the complete function_list fence and builtin check.
 // Its fixed header-read tail closes once before any counter result is returned.
 function raw(sql:string,args:unknown[]=[]){const stmt=prepare(sql);call('raw',stmt,[true]);const rows=call('all',stmt,args) as unknown[][];return rows;}
 function records(sql:string,args:unknown[]=[]):Record<string,any>[] {
  assertNativeSqliteColumnConstruction();
  const stmt=prepare(sql);call('raw',stmt,[true]);assertNativeSqliteColumnConstruction();const columns=call('columns',stmt) as Array<{name:string}>,rows=call('all',stmt,args) as unknown[][];assertNativeSqliteColumnConstruction();return copyRecords(columns,rows);
 }
 function copyRecords(columns:Array<{name:string}>,rows:unknown[][]):Record<string,any>[] {const result:Record<string,any>[]=[];
  for(let i=0;i<rows.length;i++){if(rows[i]!.length!==columns.length)fail();const row:Record<string,any>={__proto__:null};for(let j=0;j<columns.length;j++){if(columns[j]!.name==='__proto__')fail();row[columns[j]!.name]=rows[i]![j];}appendResult(result,row);}return result;
 }
 // Private fixed-query reader: schema() already checked the realm before the
 // first call, or the preceding call checked it after all(). Keep both guards
 // after native SQL boundaries; prepare/step can reconnect a changed schema.
 function tableColumns(table:typeof tables[number]):Record<string,any>[] {
  const stmt=prepare('PRAGMA main.table_xinfo('+table+')');call('raw',stmt,[true]);assertNativeSqliteColumnConstruction();
  const columns=call('columns',stmt) as Array<{name:string}>,rows=call('all',stmt) as unknown[][];assertNativeSqliteColumnConstruction();
  return copyRecords(columns,rows);
 }
 function counter(){current();const funcs=records('PRAGMA function_list');if(!funcs.some(f=>f.name==='total_changes'&&f.builtin===1)||funcs.some(f=>typeof f.name==='string'&&lower(f.name)==='total_changes'&&f.builtin!==1))fail();
  const schema=raw('PRAGMA main.schema_version')[0]?.[0],data=raw('PRAGMA main.data_version')[0]?.[0];if(!Number.isSafeInteger(schema)||Number(schema)<0||!Number.isSafeInteger(data)||Number(data)<0)fail();
  const stmt=prepare('SELECT total_changes() AS n');call('safeIntegers',stmt,[true]);call('raw',stmt,[true]);const row=call('get',stmt) as unknown[]|undefined;assertNativeSqliteArrayConstruction();const changes=row?.[0];if(typeof changes!=='bigint'||changes<0n)fail();return {schema,data,changes};
 }
 function schema(){const modules=records('PRAGMA module_list');if(modules.some(r=>typeof r.name==='string'&&tables.includes(lower(r.name))))fail();
  const master=records('SELECT type,name,tbl_name,rootpage,sql FROM main.sqlite_master ORDER BY type,name,tbl_name,rootpage,sql');
  for(const row of master)if(tables.includes(lower(String(row.name)))&&row.type==='table'&&typeof row.sql==='string'&&/^CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql))fail();
  const kinds=records('PRAGMA main.table_list');for(const row of kinds)if(row.schema==='main'&&tables.includes(lower(String(row.name)))&&(row.type!=='table'&&row.type!=='view'||row.type==='view'&&['verification_profiles','verification_storage_features'].includes(lower(String(row.name)))))fail();
  const columns={__proto__:null} as unknown as Record<string,Record<string,any>[]>,present=new Set<string>();
  // table_list stays fully guarded: SQLite may connect arbitrary views/vtabs.
  // Only private native metadata copying/control flow separates one table read
  // from the next. SQL callback/reconnect boundaries keep their original guards.
  // Non-text SQLite schema names may be Buffers with caller-modified coercion.
  // Such rows keep the complete original per-query fences and evaluation order.
  const adjacentMetadata=master.every(row=>typeof row.name==='string');
  // table_list may have entered callbacks. Use its final positive classification,
  // not only the earlier master row, before trusting an existing main snapshot.
  const transactionMetadata=adjacentMetadata&&typeof native!.inTransaction==='function'&&apply(native!.inTransaction,native!.cpp,[])===true&&tables.every(table=>!master.some(row=>row.type==='table'&&lower(row.name)===table)||kinds.some(row=>row.schema==='main'&&row.name===table&&row.type==='table'));
  if(adjacentMetadata)assertNativeSqliteColumnConstruction();
  if(transactionMetadata){
   // No transaction is created here. Fixed ordinary-table metadata only, using
   // the existing read snapshot acquired by successful guarded table_list.
   // Native addon/VFS/extension provenance remains the trusted-native boundary.
   const pending:Array<{table:string;columns:Array<{name:string}>;rows:unknown[][]}>=[];
   // This layout belongs only to this synchronous transaction metadata batch.
   let layout:Array<{name:string}>|undefined;
   for(const table of tables){
    const entry=master.find(row=>row.type==='table'&&lower(String(row.name))===table);if(!entry)continue;if(entry.name===table)present.add(table);
    const stmt=prepare('PRAGMA main.table_xinfo('+table+')');call('raw',stmt,[true]);
    const names:Array<{name:string}>=layout??(call('columns',stmt) as Array<{name:string}>),rows=call('all',stmt) as unknown[][];
    layout=names;
    append(pending,{table,columns:names,rows});
   }
   assertNativeSqliteColumnConstruction();
   for(let i=0;i<pending.length;i++){const item=pending[i]!,value=copyRecords(item.columns,item.rows);if(value.some(c=>c.hidden!==0||c.name==='__proto__'))fail();columns[item.table]=value;}
  }else{
   for(const table of tables){const entry=master.find(row=>row.type==='table'&&lower(String(row.name))===table);if(!entry)continue;if(entry.name===table)present.add(table);const value=adjacentMetadata?tableColumns(table):records('PRAGMA main.table_xinfo('+table+')');if(value.some(c=>c.hidden!==0||c.name==='__proto__'))fail();columns[table]=value;}
  }
  return {master,columns,present};
 }
 return freeze({begin(){const before=counter(),structure=schema();if(!isDeepStrictEqual(before,counter()))fail();
  return {evidence:{master:structure.master,columns:structure.columns},has:(table:string)=>structure.present.has(table),records,

   groups(table:keyof typeof REGISTRATION_TABLE_KEYS,lookups:readonly string[]){assertNativeSqliteColumnConstruction();if(!Object.hasOwn(REGISTRATION_TABLE_KEYS,table))fail();const result=new Map<string,Record<string,any>[]>();for(const key of lookups)result.set(key,[]);if(!structure.present.has(table)||!lookups.length)return result;
    const unique=[...result.keys()];for(let start=0;start<unique.length;start+=128){const count=Math.min(128,unique.length-start),values:string[]=[];for(let i=0;i<count;i++)append(values,unique[start+i]!);const sql='WITH wanted(lookup) AS (VALUES '+Array(count).fill('(?)').join(',')+') SELECT wanted.lookup,item.* FROM wanted JOIN main.'+table+' AS item ON item.'+REGISTRATION_TABLE_KEYS[table]+'=wanted.lookup';
     const stmt=prepare(sql);call('raw',stmt,[true]);assertNativeSqliteColumnConstruction();const cols=call('columns',stmt) as Array<{name:string}>,rows=call('all',stmt,values) as unknown[][];assertNativeSqliteColumnConstruction();
     for(let i=0;i<rows.length;i++){const source=rows[i]!,key=source[0];if(typeof key!=='string'||!result.has(key)||source.length!==cols.length)fail();const row:Record<string,any>={__proto__:null};for(let j=1;j<cols.length;j++){if(cols[j]!.name==='__proto__')fail();row[cols[j]!.name]=source[j];}appendResult(result.get(key)!,row);}
    }return result;
   },finish(){if(!isDeepStrictEqual(counter(),before)||!isDeepStrictEqual(schema(),structure)||!isDeepStrictEqual(counter(),before))fail();}};
 }});
}
