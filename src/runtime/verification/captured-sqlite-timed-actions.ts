import {createHash} from 'node:crypto';
import {readProfileSourceCapture,readProfileSqliteSchema,assertProfileSqliteIntegrity,readProfileSqliteLosslessRows} from './profile-source-capture.js';
import {TIMED_ACTION_SOURCE_SCHEMAS} from './timed-action-source-schema.js';
import {TIMED_ACTION_TABLES,TIMED_ACTION_QUERIES} from './timed-action-source-queries.js';
import {freezeCapturedData} from './captured-source-json.js';
import {canonicalVerificationJson} from './protocol.js';
import type {CapturedSqliteCell as Cell} from './source-sqlite-cell.js';
import type {TimedActionReference as Reference,TimedActionSourceEvent as Event,TimedActionCounts as Counts} from './timed-action-source-types.js';
function references(table:string,record:Readonly<Record<string,Cell>>):Reference[]{
 const result:Reference[]=[];
 function add(column:string,domain:string,definition=false,sameSource=false,interpreted=true){const value=record[column];if(value&&value.type!=='null')result.push({column,domain,value,definition,sameSource,referenceState:interpreted&&value.type==='text'&&value.value!==''?'declared':'uninterpreted'});}
 if(table==='timed_actions'){
  add('id','timed-action',true,true);add('created_by_task_id','task');add('last_runtime_task_id','task');add('locked_run_id','timed-run',false,true);
  const owner=record.owner_kind;const kind=owner?.type==='text'?owner.value:'';
  add('owner_id',kind==='user'?'actor-user':kind==='agent_task'?'task':'uninterpreted-owner',false,false,kind==='user'||kind==='agent_task');
 }else if(table==='timed_action_runs'){add('run_id','timed-run',true,true);add('action_id','timed-action',false,true);add('runtime_task_id','task');}
 else if(table==='loop_timed_action_tombstones')add('action_id','timed-action',false,true);
 else if(table==='loop_timed_completion_receipts')add('timed_run_id','timed-run',false,true);
 else if(table==='scheduled_task_delivery_receipts')add('run_id','timed-run',false,true);
 return result;
}
/** All still-present rows of the held original source. No business receipt or
 * automatic execution authorization can be obtained from these declarations. */
export function* iterateCapturedSQLiteTimedActionSources(owner:object,token:object):Generator<Event,void,unknown>{
 const capture=readProfileSourceCapture(owner,token),sources:Array<{sourceId:string;snapshotHash:string;counts:Counts}>=[],hash=createHash('sha256').update('xiaok-timed-actions-declarations-v1\0');
 function emit(event:Exclude<Event,{kind:'complete'}>):Event{const bytes=Buffer.from(canonicalVerificationJson(event));hash.update(String(bytes.length)).update(':').update(bytes);return freezeCapturedData(event);}
 for(const entry of [...capture.sources].sort((a,b)=>a.source.sourceId<b.source.sourceId?-1:a.source.sourceId>b.source.sourceId?1:0)){
  const {source,snapshotHash}=entry;if(source.kind!=='sqlite-db'||source.snapshotFormat!=='timed-actions-sqlite-v1')continue;
  const actual=readProfileSqliteSchema(owner,token,source.sourceId).map(row=>({...row,sql:typeof row.sql==='string'?row.sql.replace(/\s+/g,' ').trim():row.sql}));
  if(!TIMED_ACTION_SOURCE_SCHEMAS.some(schema=>canonicalVerificationJson(schema)===canonicalVerificationJson(actual)))throw Error('captured_timed_actions_schema');
  assertProfileSqliteIntegrity(owner,token,source.sourceId);
  const counts=Object.fromEntries(TIMED_ACTION_TABLES.map(table=>[table,0])) as Record<keyof Counts,number>;
  yield emit({kind:'source-start',sourceId:source.sourceId,snapshotHash,format:'timed-actions-sqlite-v1'});
  for(const queryId of TIMED_ACTION_TABLES){const table=TIMED_ACTION_QUERIES[queryId].table;for(const row of readProfileSqliteLosslessRows(owner,token,source.sourceId,queryId)){counts[queryId]++;yield emit({kind:'row',sourceId:source.sourceId,table,rowid:row.rowid,record:row.record,references:references(table,row.record)});}}
  readProfileSourceCapture(owner,token);yield emit({kind:'source-end',sourceId:source.sourceId,counts});sources.push(freezeCapturedData({sourceId:source.sourceId,snapshotHash,counts}));
 }
 readProfileSourceCapture(owner,token);yield freezeCapturedData({kind:'complete',sources,digest:hash.digest('hex')});
}
