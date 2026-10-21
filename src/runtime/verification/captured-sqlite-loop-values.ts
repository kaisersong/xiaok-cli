import type {readProfileSqliteReaderSchema} from './profile-source-capture.js';
import { LOOP_SOURCE_COLUMN_TYPES, LOOP_SOURCE_SCHEMAS, LOOP_SOURCE_MIGRATED_TABLES } from './loop-source-schema.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';
import { capturedFields, capturedInteger, parseCapturedSourceJson } from './captured-source-json.js';

/** These columns belong to ordinary original producers, whose clocks and
 * durations were not integer/monotonic protocols. No authorization is inferred. */
const ordinaryNumbers: Readonly<Record<string, readonly string[]>> = Object.freeze({
 loop_definitions:['created_at','updated_at','deleted_at'],
 loop_runs:['started_at','finished_at','updated_at','duration_ms'],
 loop_stages:['started_at','finished_at','created_at','updated_at'],
 assistant_profiles:['created_at','updated_at'],
 assistant_candidates:['created_at','decided_at'],
 user_loop_templates:['created_at','updated_at'],
 loop_learned_constraints:['created_at','updated_at','last_hit_at'],
 completion_expectations:['created_at','updated_at'],
 completion_evidence:['created_at','orphaned_at'],
 completion_records:['created_at'],
 evidence_anomalies:['first_seen_at','last_seen_at','last_resolved_at','ignored_until'],
});
for(const columns of Object.values(ordinaryNumbers))Object.freeze(columns);
export function isOrdinaryLoopNumber(table:string,column:string):boolean{return ordinaryNumbers[table]?.includes(column)===true;}
const minimum=-9223372036854775808n,maximum=9223372036854775807n;
function fail():never{throw Error('captured_sqlite_loop_storage_class');}
function integer(cell:CapturedSqliteCell):bigint{
 if(cell.type!=='integer'||! /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(cell.value))fail();
 const value=BigInt(cell.value);if(value<minimum||value>maximum)fail();return value;
}
function exactNumber(value:bigint):number{
 if(value<BigInt(Number.MIN_SAFE_INTEGER)||value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('captured_sqlite_loop_integer_precision');
 return Number(value);
}
function real(cell:CapturedSqliteCell):number{
 if(cell.type!=='real'||! /^[0-9a-f]{16}$/.test(cell.value))fail();
 const value=Buffer.from(cell.value,'hex').readDoubleBE();if(!Number.isFinite(value))throw Error('captured_sqlite_loop_real');return value;
}
/** Semantic temporary values only. Consumers must retain original tagged cells
 * in declarations, including REAL -0/subnormal and integers beyond JS precision. */
export function decodeCapturedLoopRow(table:string,cells:Readonly<Record<string,CapturedSqliteCell>>):Readonly<Record<string,unknown>>{
 const columns=LOOP_SOURCE_COLUMN_TYPES[table as keyof typeof LOOP_SOURCE_COLUMN_TYPES];
 if(!columns)throw Error('captured_sqlite_loop_schema');capturedFields(cells,columns.map(column=>column.name));
 const row:Record<string,unknown>={};
 for(const column of columns){
  const cell=cells[column.name]!;
  if(cell.type==='null'){if(column.notnull)fail();row[column.name]=null;continue;}
  const declared=column.type.toUpperCase();
  if(declared==='TEXT'||table==='sqlite_sequence'&&column.name==='name'){
   if(cell.type!=='text')fail();row[column.name]=cell.value;continue;
  }
  if(ordinaryNumbers[table]?.includes(column.name)){
   if(cell.type==='integer'){const value=integer(cell);row[column.name]=value>=BigInt(Number.MIN_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value;}
   else row[column.name]=real(cell);
   continue;
  }
  if(declared==='REAL'){
   const value=cell.type==='integer'?exactNumber(integer(cell)):real(cell);
   if(table!=='assistant_candidates'||column.name!=='confidence'||value<0||value>1)fail();row[column.name]=value;continue;
  }
  if(declared==='INTEGER'||table==='sqlite_sequence'&&column.name==='seq'){
   const value=exactNumber(integer(cell));capturedInteger(value);row[column.name]=value;continue;
  }
  fail();
 }
 return Object.freeze(row);
}

function semanticFail(reason:string):never{throw Error('captured_sqlite_loop_'+reason);}
export function readCapturedLoopSchema(actual:ReturnType<typeof readProfileSqliteReaderSchema>):string[]{
 const names=new Set(actual.map(row=>row.name));
 const selected=(Object.keys(LOOP_SOURCE_SCHEMAS) as Array<keyof typeof LOOP_SOURCE_SCHEMAS>).filter(kind=>LOOP_SOURCE_SCHEMAS[kind].some(row=>row.type==='table'&&names.has(row.name)));
 if(!selected.length)semanticFail('schema');
 const expected=selected.flatMap(kind=>[...LOOP_SOURCE_SCHEMAS[kind]]).sort((a,b)=>a.type<b.type?-1:a.type>b.type?1:a.name<b.name?-1:a.name>b.name?1:0);
 if(actual.length!==expected.length)semanticFail('schema');
 for(let index=0;index<actual.length;index++){
  const row=actual[index]!,match=expected[index]!;if(row.type!==match.type||row.name!==match.name||row.tbl_name!==match.tbl_name)semanticFail('schema');
  const sql=row.sql===null?null:row.sql.replace(/\s+/g,' ').trim();
  const variants=LOOP_SOURCE_MIGRATED_TABLES[row.name as keyof typeof LOOP_SOURCE_MIGRATED_TABLES] as readonly string[]|undefined;
  if(sql!==match.sql&&!(row.type==='table'&&typeof sql==='string'&&variants?.includes(sql)))semanticFail('schema');
 }
 return expected.filter(row=>row.type==='table').map(row=>row.name);
}
export function parseCapturedLoopSemanticRow(table:string,row:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{
 const columns=LOOP_SOURCE_COLUMN_TYPES[table as keyof typeof LOOP_SOURCE_COLUMN_TYPES];if(!columns)semanticFail('schema');capturedFields(row,columns.map(column=>column.name));const parsed:Record<string,unknown>={};
 for(const c of columns){const value=row[c.name];if(value===null){if(c.notnull)semanticFail('null');continue;}
  if(c.type.toUpperCase()==='TEXT'){if(typeof value!=='string')semanticFail('text');}else if(c.type.toUpperCase()==='INTEGER'){if(isOrdinaryLoopNumber(table,c.name)){if(typeof value!=='bigint'&&(typeof value!=='number'||!Number.isFinite(value)))semanticFail('ordinary_number');}else capturedInteger(value);}else if(c.type.toUpperCase()==='REAL'){if(typeof value!=='number'||!Number.isFinite(value))semanticFail('real');}else if(c.type!=='')semanticFail('column_type');
  if(c.name.endsWith('_json')){if(typeof value!=='string')semanticFail('text');parsed[c.name]=parseCapturedSourceJson(value);}
 }return parsed;
}
