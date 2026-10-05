import type {Database} from 'better-sqlite3';
import {isDeepStrictEqual,types} from 'node:util';
import {readPrivateDatabaseNativeAccess} from './private-database.js';
const isProxy=types.isProxy,freeze=Object.freeze;
const apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,prototype=Object.getPrototypeOf;
const globals=[{target:types,key:'isProxy',value:descriptor(types,'isProxy')},{target:Object,key:'freeze',value:descriptor(Object,'freeze')},{target:Object,key:'getPrototypeOf',value:descriptor(Object,'getPrototypeOf')},{target:Object,key:'getOwnPropertyDescriptor',value:descriptor(Object,'getOwnPropertyDescriptor')},{target:Object,key:'create',value:descriptor(Object,'create')},{target:Object,key:'defineProperty',value:descriptor(Object,'defineProperty')},{target:Reflect,key:'apply',value:descriptor(Reflect,'apply')},{target:Function.prototype,key:'call',value:descriptor(Function.prototype,'call')},{target:Function.prototype,key:'apply',value:descriptor(Function.prototype,'apply')},{target:Object,key:'fromEntries',value:descriptor(Object,'fromEntries')},{target:Array.prototype,key:'slice',value:descriptor(Array.prototype,'slice')}];
export const REGISTRATION_TABLE_KEYS={verification_owner_dependencies:'parent_key',owner_enrollment_intents:'logical_owner_key',verification_registered_owners:'owner_key',verification_owners:'owner_key',mandatory_observation_checks:'owner_key',verification_registered_invocations:'owner_key',owner_enrollment_invocation_receipts:'owner_key',owner_enrollment_goal_sessions:'owner_key',owner_enrollment_loop_subjects:'owner_key',owner_enrollment_intent_contracts:'owner_key',owner_enrollment_kswarm_subjects:'logical_owner_key',migration_publication_intents:'owner_key',verification_application_pointers:'owner_key',verification_application_history:'owner_key',verification_application_transitions:'owner_key'} as const;
const tables=[...Object.keys(REGISTRATION_TABLE_KEYS),'verification_profiles','verification_storage_features'];
const lower=(v:string)=>v.replace(/[A-Z]/g,c=>c.toLowerCase());
function fail():never{throw Error('application_registration_changed');}
/** Per-call full SQL census only. No row/permission/clock/current result crosses a checkpoint. */
export function createRegistrationCensusDatabase(db:Database){
 const native=readPrivateDatabaseNativeAccess(db);if(!native)return undefined;
 function current(){
  if(isProxy(db)||descriptor(db,native!.symbol)?.value!==native!.cpp||prototype(db)!==native!.databasePrototype||prototype(native!.cpp)!==native!.cppPrototype)fail();
  for(const entry of native!.fingerprints)if(!isDeepStrictEqual(descriptor(entry.target,entry.key),entry.descriptor))fail();
  for(const entry of globals)if(!isDeepStrictEqual(descriptor(entry.target,entry.key),entry.value))fail();
  if(apply(native!.open,native!.cpp,[])!==true)fail();
 }
 const prepare=(sql:string)=>apply(native.prepare,native.cpp,[sql,db,false,false]);
 const call=(key:string,stmt:object,args:unknown[]=[])=>apply(native.statement[key]!,stmt,args);
 function raw(sql:string,args:unknown[]=[]){const stmt=prepare(sql);call('raw',stmt,[true]);return call('all',stmt,args) as unknown[][];}
 function records(sql:string,args:unknown[]=[]):Record<string,any>[] {
  const stmt=prepare(sql);call('raw',stmt,[true]);const columns=call('columns',stmt) as Array<{name:string}>,rows=call('all',stmt,args) as unknown[][],result:Record<string,any>[]=[];
  for(let i=0;i<rows.length;i++){if(rows[i]!.length!==columns.length)fail();const row:Record<string,any>={__proto__:null};for(let j=0;j<columns.length;j++){if(columns[j]!.name==='__proto__')fail();row[columns[j]!.name]=rows[i]![j];}result.push(row);}return result;
 }
 function counter(){current();const funcs=records('PRAGMA function_list');if(!funcs.some(f=>f.name==='total_changes'&&f.builtin===1)||funcs.some(f=>typeof f.name==='string'&&lower(f.name)==='total_changes'&&f.builtin!==1))fail();
  const schema=raw('PRAGMA main.schema_version')[0]?.[0],data=raw('PRAGMA main.data_version')[0]?.[0];if(!Number.isSafeInteger(schema)||Number(schema)<0||!Number.isSafeInteger(data)||Number(data)<0)fail();
  const stmt=prepare('SELECT total_changes() AS n');call('safeIntegers',stmt,[true]);call('raw',stmt,[true]);const changes=(call('get',stmt) as unknown[]|undefined)?.[0];if(typeof changes!=='bigint'||changes<0n)fail();return {schema,data,changes};
 }
 function schema(){const modules=records('PRAGMA module_list');if(modules.some(r=>typeof r.name==='string'&&tables.includes(lower(r.name))))fail();
  const master=records('SELECT type,name,tbl_name,rootpage,sql FROM main.sqlite_master ORDER BY type,name,tbl_name,rootpage,sql');
  for(const row of master)if(tables.includes(lower(String(row.name)))&&row.type==='table'&&typeof row.sql==='string'&&/^CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql))fail();
  const kinds=records('PRAGMA main.table_list');for(const row of kinds)if(row.schema==='main'&&tables.includes(lower(String(row.name)))&&(row.type!=='table'&&row.type!=='view'||row.type==='view'&&['verification_profiles','verification_storage_features'].includes(lower(String(row.name)))))fail();
  const columns={__proto__:null} as unknown as Record<string,Record<string,any>[]>,present=new Set<string>();
  for(const table of tables){const entry=master.find(row=>row.type==='table'&&lower(String(row.name))===table);if(!entry)continue;if(entry.name===table)present.add(table);const value=records('PRAGMA main.table_xinfo('+table+')');if(value.some(c=>c.hidden!==0||c.name==='__proto__'))fail();columns[table]=value;}
  return {master,columns,present};
 }
 return freeze({begin(){const before=counter(),structure=schema();if(!isDeepStrictEqual(before,counter()))fail();const statementCache=new Map<string,any>();
  return {evidence:{master:structure.master,columns:structure.columns},has:(table:string)=>structure.present.has(table),records,

   groups(table:keyof typeof REGISTRATION_TABLE_KEYS,lookups:readonly string[]){if(!Object.hasOwn(REGISTRATION_TABLE_KEYS,table))fail();const result=new Map<string,Record<string,any>[]>();for(const key of lookups)result.set(key,[]);if(!structure.present.has(table)||!lookups.length)return result;
    const unique=[...result.keys()];for(let start=0;start<unique.length;start+=128){const count=Math.min(128,unique.length-start),values:string[]=[];for(let i=0;i<count;i++)values.push(unique[start+i]!);const sql='WITH wanted(lookup) AS (VALUES '+Array(count).fill('(?)').join(',')+') SELECT wanted.lookup,item.* FROM wanted JOIN main.'+table+' AS item ON item.'+REGISTRATION_TABLE_KEYS[table]+'=wanted.lookup';
     let stmt=statementCache.get(sql);if(!stmt){stmt=prepare(sql);call('raw',stmt,[true]);statementCache.set(sql,stmt);}const cols=call('columns',stmt) as Array<{name:string}>,rows=call('all',stmt,values) as unknown[][];
     for(let i=0;i<rows.length;i++){const source=rows[i]!,key=source[0];if(typeof key!=='string'||!result.has(key)||source.length!==cols.length)fail();const row:Record<string,any>={__proto__:null};for(let j=1;j<cols.length;j++){if(cols[j]!.name==='__proto__')fail();row[cols[j]!.name]=source[j];}result.get(key)!.push(row);}
    }return result;
   },finish(){if(!isDeepStrictEqual(counter(),before)||!isDeepStrictEqual(schema(),structure)||!isDeepStrictEqual(counter(),before))fail();}};
 }});
}
