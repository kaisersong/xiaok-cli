import {createHash} from 'node:crypto';
import {readProfileSourceCapture,openProfileSqliteReader,closeProfileSqliteReader,readProfileSqliteReaderSchema,readProfileSqliteReaderUserVersion,iterateProfileSqliteReaderRows,iterateProfileSqliteReaderRelation,type ProfileSqliteReader} from './profile-source-capture.js';
import {METADATA_SESSION_QUERIES,type MetadataSessionQueryId} from './metadata-session-query-manifest.js';
import type {MetadataSessionRelationId} from './metadata-session-relation-manifest.js';
import {readCapturedGroupsSchema} from './groups-source-schema.js';
import {readCapturedGroupsRow,groupsObject,type CapturedGroupsRow} from './captured-sqlite-groups-row.js';
import {declareCapturedGroupsRow,type CapturedGroupsReference} from './captured-sqlite-groups-references.js';
import {encodeMultiAgentRow} from '../multi-agent/row-codec.js';
import {freezeCapturedData,capturedFields} from './captured-source-json.js';
import type {CapturedSqliteCell} from './source-sqlite-cell.js';

type Count=Readonly<{table:string;count:string}>;
type Source=Readonly<{sourceId:string;snapshotHash:string;tables:readonly Count[]}>;
export type CapturedGroupsStreamEvent=
 |Readonly<{kind:'source-start';sourceId:string;snapshotHash:string;userVersion:1|2|3|4}>
 |Readonly<{kind:'table-start';sourceId:string;table:string;columns:readonly string[]}>
 |Readonly<{kind:'row';sourceId:string;table:string;rowid:string;ordinal:string;cells:Readonly<Record<string,CapturedSqliteCell>>;parsed:Readonly<Record<string,unknown>>;references:readonly CapturedGroupsReference[];unmapped:readonly string[];observationDeclarations:readonly Readonly<{path:string;reference:unknown}>[]}>
 |Readonly<{kind:'table-end';sourceId:string;table:string;count:string}>
 |Readonly<Source&{kind:'source-end'}>
 |Readonly<{kind:'complete';version:1;sources:readonly Source[];digest:string}>;
function fail(reason:string):never{throw Error('captured_groups_'+reason);}
function scalar(row:CapturedGroupsRow,key:string):string{const cell=row.cells[key];if(cell?.type!=='text')fail('identity');return cell.value;}
function integer(row:CapturedGroupsRow,key:string):bigint{const cell=row.cells[key];if(cell?.type!=='integer'||BigInt(cell.value)<0n)fail('counter');return BigInt(cell.value);}
function one(reader:ProfileSqliteReader,relation:MetadataSessionRelationId,table:string,keys:string[]):CapturedGroupsRow{
 const iterator=iterateProfileSqliteReaderRelation(reader,relation,keys);try{const first=iterator.next();if(first.done)fail('relation');const row=readCapturedGroupsRow(table,first.value);if(!iterator.next().done)fail('relation_cardinality');return row;}finally{iterator.return();}
}
function messageDigest(value:Record<string,unknown>):string{const{groupId,messageId,sender,receiverId,kind,preview,contentId,truncated,createdAt,bodyUnavailable}=value;return createHash('sha256').update(encodeMultiAgentRow({groupId,messageId,sender,receiverId,kind,preview,contentId,truncated,createdAt,bodyUnavailable})).digest('hex');}
function relationships(reader:ProfileSqliteReader,row:CapturedGroupsRow,activityTables:boolean):void{
 const body=row.json.data_json===undefined?undefined:groupsObject(row.json.data_json);
 if(row.table==='thread_bindings'&&row.cells.active_group_id?.type==='text'){
  const group=one(reader,'groups:group','groups',[row.cells.active_group_id.value]);if(scalar(group,'thread_id')!==scalar(row,'thread_id'))fail('active_thread');
 }
 if(row.table==='groups'){
  let bytes=integer(row,'logical_bytes'),events=0n;const id=scalar(row,'group_id');
  const tables=activityTables?['agents','events','messages','contents','operations','root_turns','managed_resources','activity_runs','activity_members']:['agents','events','messages','contents','operations','root_turns','managed_resources'];
  for(const table of tables)for(const raw of iterateProfileSqliteReaderRelation(reader,('groups:group-'+table) as MetadataSessionRelationId,[id])){
   const item=readCapturedGroupsRow(table,raw);bytes+=integer(item,'logical_bytes');if(table==='events'){events++;if(integer(item,'seq')!==events)fail('event_sequence');}
  }
  if(integer(row,'byte_usage')!==bytes||typeof body?.lastSeq!=='number'||!Number.isSafeInteger(body.lastSeq)||BigInt(body.lastSeq)!==events)fail('group_accounting');
 }
 if(activityTables&&row.table==='activity_runs'){
  const group=one(reader,'groups:group','groups',[scalar(row,'group_id')]);
  if(body?.threadId!==scalar(group,'thread_id'))fail('activity_thread');
 }
 if(activityTables&&row.table==='activity_members'){
  const run=one(reader,'groups:activity-run','activity_runs',[scalar(row,'run_id')]);
  if(scalar(run,'group_id')!==scalar(row,'group_id'))fail('activity_group');
 }
 if(row.table==='messages'&&body?.contentId!==undefined){if(typeof body.contentId!=='string')fail('content');const content=one(reader,'groups:content','contents',[body.contentId]);if(scalar(content,'group_id')!==scalar(row,'group_id'))fail('content_group');}
 if(row.table==='operations'&&body&&['published_message','published_message_unavailable'].includes(String(body.command))){
  const result=groupsObject(body.result);if(body.applyState!=='applied'||typeof result.messageId!=='string'||typeof result.messageSeq!=='number'||!Number.isSafeInteger(result.messageSeq)||result.messageSeq<1)fail('anchor');
  const event=groupsObject(one(reader,'groups:event','events',[scalar(row,'group_id'),String(result.messageSeq)]).json.data_json),original=groupsObject(groupsObject(event.payload).message);
  if(event.kind!=='message_sent'||original.groupId!==body.groupId||original.messageId!==result.messageId||messageDigest(original)!==body.requestHash)fail('anchor_event');
  const current=groupsObject(one(reader,'groups:message','messages',[result.messageId]).json.data_json);
  if(current.groupId!==original.groupId||current.originalReceiverId!==undefined&&current.originalReceiverId!==original.receiverId||messageDigest({...current,receiverId:current.originalReceiverId??current.receiverId})!==body.requestHash)fail('anchor_message');
  if(body.command==='published_message'){
   const facts=groupsObject(result.facts);capturedFields(facts,['version','sourceSessionId','recipientSessionId','historyDigest','closure']);if(facts.version!==1||typeof facts.sourceSessionId!=='string'||!facts.sourceSessionId||typeof facts.recipientSessionId!=='string'||!facts.recipientSessionId||typeof facts.historyDigest!=='string'||!/^[a-f0-9]{64}$/.test(facts.historyDigest))fail('anchor_facts');
  }
  if(body.command==='published_message_unavailable'&&(current.bodyUnavailable!==true||current.preview!=='FINAL_CONTENT_NOT_PERSISTED'||result.bodyUnavailable!==true))fail('anchor_unavailable');
 }
}
/** Complete internal capture declarations; neither these rows nor the final
 * digest are an authorization, source lock, read grant, or import capability. */
export function* iterateCapturedSQLiteGroupsSources(owner:object,token:object):Generator<CapturedGroupsStreamEvent,void,unknown>{
 const facts=readProfileSourceCapture(owner,token),sources:Source[]=[],hash=createHash('sha256').update('xiaok-captured-groups-stream-v1\0');
 const frame=(event:Exclude<CapturedGroupsStreamEvent,{kind:'complete'}>)=>{readProfileSourceCapture(owner,token);const raw=Buffer.from(JSON.stringify(event));hash.update(String(raw.length)+'\0');hash.update(raw);return event;};
 for(const item of facts.sources.filter(item=>item.source.kind==='sqlite-db'&&item.source.snapshotFormat==='multi-agent-groups-sqlite-v1').sort((a,b)=>Buffer.compare(Buffer.from(a.source.sourceId),Buffer.from(b.source.sourceId)))){
  const sourceId=item.source.sourceId,reader=openProfileSqliteReader(owner,token,sourceId),counts:Count[]=[];
  try{
   const schema=readCapturedGroupsSchema(readProfileSqliteReaderSchema(reader),readProfileSqliteReaderUserVersion(reader));
   yield frame({kind:'source-start',sourceId,snapshotHash:item.snapshotHash,userVersion:schema.version});
   for(const table of [...schema.tables].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){
    const query=(table==='thread_bindings'?schema.threadQuery:'groups:'+table) as MetadataSessionQueryId;let count=0n;
    yield frame({kind:'table-start',sourceId,table,columns:METADATA_SESSION_QUERIES[query].columns});
    for(const raw of iterateProfileSqliteReaderRows(reader,query)){
     const row=readCapturedGroupsRow(table,raw);relationships(reader,row,schema.version===4);const declared=declareCapturedGroupsRow(row);count++;
     yield frame({kind:'row',sourceId,table,rowid:row.rowid,ordinal:String(count),cells:row.cells,parsed:row.json,references:declared.references,unmapped:declared.unmapped,observationDeclarations:declared.observationDeclarations});
    }
    counts.push(Object.freeze({table,count:String(count)}));yield frame({kind:'table-end',sourceId,table,count:String(count)});
   }
  }finally{closeProfileSqliteReader(reader);}
  readProfileSourceCapture(owner,token);const source=freezeCapturedData({sourceId,snapshotHash:item.snapshotHash,tables:counts});sources.push(source);yield frame({kind:'source-end',...source});
 }
 readProfileSourceCapture(owner,token);yield freezeCapturedData({kind:'complete',version:1 as const,sources,digest:hash.digest('hex')});
}
