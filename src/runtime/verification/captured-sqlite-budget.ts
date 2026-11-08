import {appendIntrinsic} from './intrinsic-async-collection.js';
import {createHash} from 'node:crypto';
import {readProfileSourceCapture,readProfileSqliteSchema,assertProfileSqliteIntegrity,readProfileSqliteLosslessRows} from './profile-source-capture.js';
import {BUDGET_SOURCE_LAYOUTS} from './budget-source-schema.js';
import {BUDGET_SOURCE_QUERIES,type BudgetQueryId} from './budget-source-queries.js';
import {freezeCapturedData} from './captured-source-json.js';
import {canonicalVerificationJson} from './protocol.js';
import type {CapturedSqliteCell as Cell} from './source-sqlite-cell.js';
const json=JSON.stringify,apply=Reflect.apply,map=Array.prototype.map,sort=Array.prototype.sort,replace=String.prototype.replace,trim=String.prototype.trim,entries=Object.entries,create=Object.create,get=Map.prototype.get,set=Map.prototype.set;
type Counts=Readonly<Record<string,number>>;
export type BudgetSourceEvent=Readonly<{kind:'source-start';sourceId:string;snapshotHash:string;format:'harness-budget-sqlite-v1'}|{kind:'row';sourceId:string;table:string;rowid:string;record:Readonly<Record<string,Cell>>;references:readonly never[]}|{kind:'source-end';sourceId:string;counts:Counts}|{kind:'complete';sources:readonly {sourceId:string;snapshotHash:string;counts:Counts}[];digest:string}>;
/** Complete raw ledger/receipt enumeration of the supplied capture only. Every
 * cell remains an explicit unverified semantic gap; no balance or refund grant. */
export function* iterateCapturedSQLiteBudgetSources(owner:object,token:object):Generator<BudgetSourceEvent,void,unknown>{
 const capture=readProfileSourceCapture(owner,token),sources:Array<{sourceId:string;snapshotHash:string;counts:Counts}>=[],hash=createHash('sha256').update('xiaok-harness-budget-declarations-v1\0');
 function emit(event:Exclude<BudgetSourceEvent,{kind:'complete'}>):BudgetSourceEvent{const bytes=Buffer.from(canonicalVerificationJson(event));hash.update(String(bytes.length)).update(':').update(bytes);return freezeCapturedData(event);}
 const ordered:typeof capture.sources[number][]=[];for(let i=0;i<capture.sources.length;i++)appendIntrinsic(ordered,capture.sources[i]!);apply(sort,ordered,[(a:typeof ordered[number],b:typeof ordered[number])=>a.source.sourceId<b.source.sourceId?-1:a.source.sourceId>b.source.sourceId?1:0]);
 for(let sourceIndex=0;sourceIndex<ordered.length;sourceIndex++){const entry=ordered[sourceIndex]!;
  const {source,snapshotHash}=entry;if(source.kind!=='sqlite-db'||source.snapshotFormat!=='harness-budget-sqlite-v1')continue;
  const schema=apply(map,readProfileSqliteSchema(owner,token,source.sourceId),[(row:{type:string;name:string;tbl_name:string;sql:string|null})=>({...row,sql:typeof row.sql==='string'?apply(trim,apply(replace,row.sql,[/\s+/g,' ']),[]):row.sql})]);
  const digest=createHash('sha256').update(json(schema)).digest('hex');let layout:typeof BUDGET_SOURCE_LAYOUTS[number]|undefined;for(let i=0;i<BUDGET_SOURCE_LAYOUTS.length;i++)if(BUDGET_SOURCE_LAYOUTS[i]!.schemaSha256===digest){layout=BUDGET_SOURCE_LAYOUTS[i];break;}
  if(!layout)throw Error('captured_harness_budget_schema');assertProfileSqliteIntegrity(owner,token,source.sourceId);
  const metadata=[...readProfileSqliteLosslessRows(owner,token,source.sourceId,'budget:metadata')],actual=new Map<string,Cell>();
  for(const row of metadata){const key=row.record.key,value=row.record.value;if(key?.type!=='text'||value?.type!=='text'||apply(get,actual,[key.value])!==undefined)throw Error('captured_harness_budget_metadata');apply(set,actual,[key.value,value]);}
  const required={schemaVersion:layout.version,...layout.profiles};for(const [key,value]of entries(required)){const cell=apply(get,actual,[key]) as Cell|undefined;if(cell?.type!=='text'||cell.value!==value)throw Error('captured_harness_budget_metadata');}
  const counts:Record<string,number>=create(null);yield emit({kind:'source-start',sourceId:source.sourceId,snapshotHash,format:'harness-budget-sqlite-v1'});
  for(let queryIndex=0;queryIndex<layout.queries.length;queryIndex++){const id=layout.queries[queryIndex]!,queryId=id as BudgetQueryId,query=BUDGET_SOURCE_QUERIES[queryId];counts[id]=0;
   for(const row of readProfileSqliteLosslessRows(owner,token,source.sourceId,queryId)){counts[id]++;yield emit({kind:'row',sourceId:source.sourceId,table:query.table,rowid:row.rowid,record:row.record,references:[]});}
  }
  readProfileSourceCapture(owner,token);yield emit({kind:'source-end',sourceId:source.sourceId,counts});appendIntrinsic(sources,freezeCapturedData({sourceId:source.sourceId,snapshotHash,counts}));
 }
 readProfileSourceCapture(owner,token);yield freezeCapturedData({kind:'complete',sources,digest:hash.digest('hex')});
}
