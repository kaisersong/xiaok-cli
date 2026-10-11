import {isDeepStrictEqual as initialIsDeepStrictEqual} from 'node:util';
const isDeepStrictEqual=initialIsDeepStrictEqual;

import type {Database,Statement} from 'better-sqlite3';
import {assertNativeSqliteArrayConstruction} from './native-sqlite-construction-intrinsics.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {freezeCapturedData} from './captured-source-json.js';
import {capturedSqliteEncoding,encodeCapturedSqliteCell,type CapturedSqliteCell,type CapturedSqliteEncoding} from './source-sqlite-cell.js';

const inventoryTables=['verification_profiles','verification_registered_owners','verification_registered_invocations','owner_enrollment_invocation_receipts','owner_enrollment_goal_sessions','owner_enrollment_intents','owner_enrollment_loop_subjects','owner_enrollment_intent_contracts','owner_enrollment_kswarm_subjects','verification_storage_features','owner_enrollment_challenges','owner_enrollment_requests'] as const;
type InventoryTable=typeof inventoryTables[number];
const scopedQueries={owner:{table:'verification_owners',where:'owner_key'},obligations:{table:'mandatory_observation_checks',where:'owner_key',order:'obligation_id'},dependencies:{table:'verification_owner_dependencies',where:'parent_key',order:'child_key'},registered:{table:'verification_registered_owners',where:'owner_key'},profile:{table:'verification_profiles',where:'profile_id'},invocations:{table:'verification_registered_invocations',where:'owner_key',order:'invocation_json'},receipts:{table:'owner_enrollment_invocation_receipts',where:'owner_key',order:'invocation_json'},subject:{table:'owner_enrollment_kswarm_subjects',where:'owner_key'},storageFeature:{table:'verification_storage_features',where:'feature'}} as const;
const producerTables=new Set<string>([...inventoryTables,...Object.values(scopedQueries).map(query=>query.table)]);
const asciiName=(name:string)=>name.replace(/[A-Z]/g,character=>character.toLowerCase());
/** Fixed native producer namespaces cannot resolve to virtual modules or computed data. */
export function assertNativeSqliteProducerTableKinds(database:Database):void{
 if(arguments.length!==1)throw Error('native_sqlite_census_query');
 assertNativeSqliteArrayConstruction();
 const modules=database.pragma('module_list') as Array<{name:string}>;
 assertNativeSqliteArrayConstruction();
 if(modules.some(row=>typeof row.name==='string'&&producerTables.has(asciiName(row.name))))throw Error('native_sqlite_census_schema');
 const tables=database.pragma('main.table_list') as Array<{schema:string;name:string;type:string}>;
 assertNativeSqliteArrayConstruction();
 if(tables.some(row=>row.schema==='main'&&typeof row.name==='string'&&producerTables.has(asciiName(row.name))&&row.type!=='table'))throw Error('native_sqlite_census_schema');
}
/** Call after the producer kind guard, before a semantic SELECT. Missing tables remain absent. */
export function assertNativeSqliteStoredProducerColumns(database:Database,table:string):void{
 if(arguments.length!==2||!producerTables.has(table))throw Error('native_sqlite_census_query');
 assertNativeSqliteArrayConstruction();
 const columns=database.prepare('PRAGMA main.table_xinfo('+quote(table)+')').all() as Array<{hidden:number}>;
 assertNativeSqliteArrayConstruction();
 if(columns.some(column=>column.hidden!==0))throw Error('native_sqlite_census_schema');
}
type ScopedQuery=keyof typeof scopedQueries;
type Cells=Readonly<Record<string,CapturedSqliteCell>>;
const issuedFrames=new WeakSet<object>();
function issued<T extends object>(frame:T):T{issuedFrames.add(frame);return frame;}
/** Pure encoding of already-issued immutable facts, never an authority. */
export function canonicalNativeCensusPopulation(frames:readonly object[]):string{
 if(arguments.length!==1||!Array.isArray(frames))throw Error('native_sqlite_census_frame');

 const captured:object[]=[];
 for(const frame of frames){if(!frame||typeof frame!=='object'||!issuedFrames.has(frame))throw Error('native_sqlite_census_frame');captured.push(frame);}
 // Only descendants of exact privately issued, deeply frozen frames enter
 // this encoder. The public protocol continues to reject arbitrary accessors.
 const fragments=new WeakMap<object,string>();
 const encode=(value:unknown):string=>{
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(!value||typeof value!=='object')throw Error('native_sqlite_census_frame');
  let fragment=fragments.get(value);if(fragment!==undefined)return fragment;
  fragment=Array.isArray(value)?'['+value.map(encode).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+encode(Reflect.get(value,key))).join(',')+'}';
  fragments.set(value,fragment);return fragment;
 };
 return '['+captured.map(encode).join(',')+']';
}

type Statements=Map<string,Statement>;
function prepare(database:Database,sql:string,statements:Statements){let statement=statements.get(sql);if(!statement){statement=database.prepare(sql);statements.set(sql,statement);}return statement;}
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function semantic(cell:CapturedSqliteCell):unknown{
 if(cell.type==='null')return null;
 if(cell.type==='text')return cell.value;
 if(cell.type==='integer'){const value=BigInt(cell.value);return value>=BigInt(Number.MIN_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):cell;}
 if(cell.type==='real'){const value=Buffer.from(cell.value,'hex').readDoubleBE();return Number.isFinite(value)?value:cell;}
 return cell;
}
// SQL fragments/field lists are private. Only fixed query names cross this
// internal read boundary; no parser, callbacks or authority can be substituted.
function rows(database:Database,encoding:CapturedSqliteEncoding,columns:readonly string[],from:string,parameters:readonly string[],order='',anchor?:{table:string;sql:CapturedSqliteCell},statements:Statements=new Map()){
 const scalar=anchor?"(SELECT sql FROM main.sqlite_master WHERE type='table' AND name=?)":undefined;
 const assertAnchor=()=>{if(anchor){const current=rows(database,encoding,['sql'],"main.sqlite_master WHERE type='table' AND name=?",[anchor.table],'',undefined,statements);if(current.length!==1||json(current[0]!.cells.sql)!==json(anchor.sql))throw Error('native_sqlite_census_changed');}};
 assertAnchor();
 const projection=columns.flatMap(name=>[quote(name),'typeof('+quote(name)+')','CAST('+quote(name)+' AS BLOB)']).concat(scalar?[scalar,'typeof('+scalar+')','CAST('+scalar+' AS BLOB)']:[]).join(',');
 const statement=prepare(database,'SELECT '+projection+' FROM '+from+(order?' ORDER BY '+order:''),statements);
 assertNativeSqliteArrayConstruction();
 const values=statement.raw(true).safeIntegers(true).all(...(anchor?[anchor.table,anchor.table,anchor.table,...parameters]:parameters)) as unknown[][];
 assertNativeSqliteArrayConstruction();
 if(anchor){for(const value of values){const i=columns.length*3,actual=encodeCapturedSqliteCell(value[i+1],value[i],value[i+2],encoding);if(json(actual)!==json(anchor.sql))throw Error('native_sqlite_census_changed');}assertAnchor();}

 return values.map(value=>{const cellRow:Cells=Object.fromEntries(columns.map((name,i)=>[name,encodeCapturedSqliteCell(value[i*3+1],value[i*3],value[i*3+2],encoding)]));return {cells:cellRow,semantic:Object.fromEntries(Object.entries(cellRow).map(([name,cell])=>[name,semantic(cell)]))};});
}

function stamp(database:Database,statements:Statements){return json({schema:database.pragma('main.schema_version',{simple:true}),changes:String((prepare(database,'SELECT total_changes() AS n',statements).safeIntegers(true).get() as {n:bigint}).n)});}
function createContext(database:Database){
 assertNativeSqliteProducerTableKinds(database);
 const statements:Statements=new Map(),initial=stamp(database,statements),encoding=capturedSqliteEncoding(database.pragma('encoding',{simple:true}));
 const master=rows(database,encoding,['type','name','tbl_name','sql'],'main.sqlite_master',[],'type,name',undefined,statements);
 const masterCells=freezeCapturedData(master.map(row=>row.cells));
 const schemaError=()=>{throw Error('native_sqlite_census_schema');};
 const asciiFold=(value:string)=>value.replace(/[A-Z]/g,char=>char.toLowerCase());
 const names=new Set<string>();
 for(const {semantic:row} of master){
  if(typeof row.type!=='string'||!['table','index','trigger','view'].includes(row.type)||typeof row.name!=='string'||!row.name||typeof row.tbl_name!=='string'||!row.tbl_name||(row.sql!==null&&typeof row.sql!=='string'))schemaError();
  const name=row.name as string,type=row.type as string,tblName=row.tbl_name as string;
  const key=json([type==='trigger'?'trigger':'schema',asciiFold(name)]);
  if(names.has(key))schemaError();names.add(key);
  if((type==='table'||type==='view')&&name!==tblName) schemaError();
 }
 const indexCache=new Map<string,ReturnType<typeof rows>>();
 const indices=(tableName:string)=>{
  let result=indexCache.get(tableName);
  if(!result){result=rows(database,encoding,['name','origin'],'pragma_index_list(?,?)',[tableName,'main'],'',undefined,statements);indexCache.set(tableName,result);}
  return result;
 };
 for(const {semantic:row} of master){
  if(row.sql===null){
   const name=row.name as string,tblName=row.tbl_name as string;
   if(row.type!=='index'||!name.startsWith('sqlite_autoindex_'+tblName+'_')||indices(tblName).filter(index=>index.semantic.name===name&&['pk','u'].includes(index.semantic.origin as string)).length!==1)schemaError();
  }
 }

 return {database,encoding,master,masterCells,indices,schemaError,initial,statements};
}
type Context=ReturnType<typeof createContext>;
function finish(context:Context){
 const {database,encoding,masterCells,initial,statements}=context;
 if(stamp(database,statements)!==initial)throw Error('native_sqlite_census_changed');
 const current=rows(database,encoding,['type','name','tbl_name','sql'],'main.sqlite_master',[],'type,name',undefined,statements);
 if(!isDeepStrictEqual(current.map(row=>row.cells),masterCells)||stamp(database,statements)!==initial)throw Error('native_sqlite_census_changed');
}
function census(context:Context,query:InventoryTable|ScopedQuery,argument?:string){
 const {database,encoding,master,masterCells,indices,schemaError,statements}=context;
 const scoped=Object.hasOwn(scopedQueries,query)?scopedQueries[query as ScopedQuery]:undefined;
 const table=scoped?.table??query;
 const schemas=master.filter(row=>row.semantic.name===table||row.semantic.tbl_name===table);
 if(!schemas.length){
  const actual=rows(database,encoding,['name'],'pragma_table_xinfo(?,?)',[table,'main'],'',undefined,statements);
  if(actual.length)schemaError();
  return issued(Object.freeze({table,present:false as const,masterCells}));
 }
 if(schemas.filter(row=>row.semantic.type==='table'&&row.semantic.name===table&&row.semantic.tbl_name===table&&typeof row.semantic.sql==='string').length!==1)schemaError();
 for(const {semantic:row} of schemas){
  if(row.tbl_name!==table||(row.type!=='table'&&!['index','trigger'].includes(row.type as string)))schemaError();
 }
 for(const index of indices(table)){
  const matches=master.filter(row=>row.semantic.type==='index'&&row.semantic.name===index.semantic.name&&row.semantic.tbl_name===table);
  if(matches.length!==1)schemaError();
 }
 const primary=schemas.find(row=>row.semantic.type==='table'&&row.semantic.name===table)!;const anchor={table,sql:primary.cells.sql!};
 const metadata=rows(database,encoding,['cid','name','type','notnull','dflt_value','pk','hidden'],'pragma_table_xinfo(?,?)',[table,'main'],'cid',anchor,statements);
 if(metadata.some(column=>column.semantic.hidden!==0))schemaError();
 const columns=metadata.map(row=>{if(typeof row.semantic.name!=='string'||!row.semantic.name)throw Error('native_sqlite_census_column');return row.semantic.name;});
 if(!columns.length)throw Error('native_sqlite_census_column');
 let data=rows(database,encoding,columns,'main.'+quote(table)+(scoped?' WHERE '+quote(scoped.where)+'=?':''),scoped?[argument!]:[] ,scoped&&'order' in scoped?quote(scoped.order):'',anchor,statements);
 if(!scoped)data=data.map(value=>({...value,key:json(value.cells)})).sort((a,b)=>Buffer.compare(Buffer.from(a.key),Buffer.from(b.key)));
 return issued(Object.freeze({table,present:true as const,masterCells,schema:freezeCapturedData(schemas.map(row=>row.semantic)),schemaCells:freezeCapturedData(schemas.map(row=>row.cells)),columns:freezeCapturedData(metadata.map(row=>row.semantic)),columnCells:freezeCapturedData(metadata.map(row=>row.cells)),rows:freezeCapturedData(data.map(row=>row.semantic)),cellRows:freezeCapturedData(data.map(row=>row.cells))}));
}

/** Readonly original facts; no source brand, callbacks or write grant. */
export function readNativeSqliteCensus(database:Database,query:InventoryTable|ScopedQuery,argument?:string){
 const scoped=Object.hasOwn(scopedQueries,query)?scopedQueries[query as ScopedQuery]:undefined;
 if(!scoped&&!inventoryTables.includes(query as InventoryTable)||scoped&&typeof argument!=='string'||!scoped&&argument!==undefined)throw Error('native_sqlite_census_query');
 assertNativeSqliteArrayConstruction();
 const context=createContext(database),result=census(context,query,argument);finish(context);return result;
}
/** Fixed population, with one context for this synchronous transaction only. */
export function readNativeEnrollmentCensus(database:Database){
 if(arguments.length!==1)throw Error('native_sqlite_census_query');
 assertNativeSqliteArrayConstruction();
 const run=()=>{const context=createContext(database),result=inventoryTables.map(table=>census(context,table));finish(context);return Object.freeze(result);};
 return database.inTransaction?run():database.transaction(run)();
}
export function readNativeKSwarmCensus(database:Database,ownerKey:string,profileId:string){
 if(arguments.length!==3||typeof ownerKey!=='string'||typeof profileId!=='string')throw Error('native_sqlite_census_query');
 assertNativeSqliteArrayConstruction();
 const run=()=>{const context=createContext(database),queries=['owner','obligations','dependencies','registered','profile','invocations','receipts','subject','storageFeature'] as const;const result=Object.fromEntries(queries.map(query=>[query,census(context,query,query==='storageFeature'?'kswarm-owner':query==='profile'?profileId:ownerKey)]));finish(context);return Object.freeze(result);};
 return database.inTransaction?run():database.transaction(run)();
}
