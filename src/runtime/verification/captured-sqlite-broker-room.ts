import {createHash} from 'node:crypto';
import {readProfileSourceCapture,readProfileSqliteSchema,assertProfileSqliteIntegrity,readProfileSqliteLosslessRows} from './profile-source-capture.js';
import {BROKER_ROOM_LAYOUTS,type BrokerRoomTable,type BrokerRoomQueryId} from './broker-room-source-schema.js';
import {freezeCapturedData} from './captured-source-json.js';
import {canonicalVerificationJson} from './protocol.js';
import type {CapturedSqliteCell as Cell} from './source-sqlite-cell.js';
type Summary=Readonly<{sourceId:string;snapshotHash:string;counts:Readonly<Partial<Record<BrokerRoomTable,number>>>}>;
export type BrokerRoomSourceEvent=
 |Readonly<{kind:'source-start';sourceId:string;snapshotHash:string;format:'broker-room-sqlite-v1';schemaVersion:8|9}>
 |Readonly<{kind:'row';sourceId:string;table:BrokerRoomTable;rowid:string;record:Readonly<Record<string,Cell>>;references:readonly never[]}>
 |Readonly<{kind:'source-end';sourceId:string;counts:Readonly<Partial<Record<BrokerRoomTable,number>>>}>
 |Readonly<{kind:'complete';sources:readonly Summary[];digest:string}>;
function fail(reason:string):never{throw Error('captured_broker_room_'+reason);}
/** Complete means every row in supplied original captures. No business grant,
 * discovery-completeness, old-FD terminal fate or canonical enrollment follows. */
export function* iterateCapturedSQLiteBrokerRoomSources(owner:object,token:object):Generator<BrokerRoomSourceEvent,void,unknown>{
 const capture=readProfileSourceCapture(owner,token),summaries:Summary[]=[],hash=createHash('sha256').update('xiaok-broker-room-declarations-v1\0');
 function emit(event:Exclude<BrokerRoomSourceEvent,{kind:'complete'}>):BrokerRoomSourceEvent{const json=canonicalVerificationJson(event);hash.update(String(Buffer.byteLength(json,'utf8'))).update(':').update(json);return freezeCapturedData(event);}
 const entries=[...capture.sources].sort((a,b)=>a.source.sourceId<b.source.sourceId?-1:a.source.sourceId>b.source.sourceId?1:0);
 for(const {source,snapshotHash}of entries){
  if(source.kind!=='sqlite-db'||source.snapshotFormat!=='broker-room-sqlite-v1')continue;
  const actual=readProfileSqliteSchema(owner,token,source.sourceId),layout=BROKER_ROOM_LAYOUTS.find(candidate=>actual.length===candidate.schema.length&&actual.every((row,i)=>{const wanted=candidate.schema[i]!;return row.type===wanted.type&&row.name===wanted.name&&row.tbl_name===wanted.tbl_name&&(typeof row.sql==='string'?row.sql.replace(/\s+/g,' ').trim():row.sql)===wanted.sql;}));
  if(!layout)fail('schema');assertProfileSqliteIntegrity(owner,token,source.sourceId);
  let maximum=0;
  for(const row of readProfileSqliteLosslessRows(owner,token,source.sourceId,'brokerRoom:room_schema_version')){
   const value=row.record.version;if(value?.type!=='integer'||!/^([1-9])$/.test(value.value))fail('version');maximum=Math.max(maximum,Number(value.value));
  }
  if(maximum!==layout.version)fail('version');
  const counts:Partial<Record<BrokerRoomTable,number>>={};
  yield emit({kind:'source-start',sourceId:source.sourceId,snapshotHash,format:'broker-room-sqlite-v1',schemaVersion:layout.version});
  for(const table of layout.tables){counts[table]=0;for(const row of readProfileSqliteLosslessRows(owner,token,source.sourceId,('brokerRoom:'+table) as BrokerRoomQueryId)){counts[table]!++;yield emit({kind:'row',sourceId:source.sourceId,table,rowid:row.rowid,record:row.record,references:[]});}}
  readProfileSourceCapture(owner,token);yield emit({kind:'source-end',sourceId:source.sourceId,counts});summaries.push(freezeCapturedData({sourceId:source.sourceId,snapshotHash,counts}));
 }
 readProfileSourceCapture(owner,token);yield freezeCapturedData({kind:'complete',sources:summaries,digest:hash.digest('hex')});
}
