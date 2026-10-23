import {
 readProfileSourceCapture, openProfileSqliteReader, closeProfileSqliteReader, readProfileSqliteReaderSchema,
 iterateProfileSqliteReaderRows, iterateProfileSqliteReaderRelation,
} from './profile-source-capture.js';
import { METADATA_SESSION_QUERIES, type MetadataSessionQueryId } from './metadata-session-query-manifest.js';
import { metadataSessionRelationManifest, type MetadataSessionRelationId } from './metadata-session-relation-manifest.js';
import { decodeCapturedLoopRow, parseCapturedLoopSemanticRow, readCapturedLoopSchema } from './captured-sqlite-loop-values.js';
import type { CapturedSqliteCell } from './source-sqlite-cell.js';

export interface CapturedLoopRow {
 readonly table:string;
 readonly rowid:string;
 readonly cells:Readonly<Record<string,CapturedSqliteCell>>;
 readonly value:Readonly<Record<string,unknown>>;
 readonly json:Readonly<Record<string,unknown>>;
}
/** Internal read-only semantic view of one already captured source. The actual
 * parser lifetime remains with the original profile reader; no caller SQL or
 * cached complete table is introduced here. */
export class CapturedLoopSourceReader {
 readonly tables:readonly string[];
 private readonly reader:ReturnType<typeof openProfileSqliteReader>;
 private closed=false;
 constructor(private readonly owner:object,private readonly token:object,sourceId:string){
  this.reader=openProfileSqliteReader(owner,token,sourceId);
  try{this.tables=Object.freeze(readCapturedLoopSchema(readProfileSqliteReaderSchema(this.reader)).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));}
  catch(error){try{this.close();}catch(closeError){throw new AggregateError([error,closeError],'captured_sqlite_loop_schema_close_failed');}throw error;}
 }
 private current():void{if(this.closed)throw Error('captured_sqlite_loop_reader_closed');readProfileSourceCapture(this.owner,this.token);}
 close():void{if(this.closed)return;this.closed=true;closeProfileSqliteReader(this.reader);}
 private parse(table:string,row:{rowid:string;record:Readonly<Record<string,CapturedSqliteCell>>}):CapturedLoopRow{
  const value=decodeCapturedLoopRow(table,row.record);
  return Object.freeze({table,rowid:row.rowid,cells:row.record,value,json:parseCapturedLoopSemanticRow(table,value)});
 }
 *rows(table:string):Generator<CapturedLoopRow,void,unknown>{
  this.current();if(!this.tables.includes(table))throw Error('captured_sqlite_loop_table');
  const query=Object.entries(METADATA_SESSION_QUERIES).find(([id,spec])=>['loop','completion','artifactScanner'].includes(id.split(':')[0]!)&&spec.table===table)?.[0] as MetadataSessionQueryId|undefined;
  if(!query)throw Error('captured_sqlite_loop_query');
  for(const row of iterateProfileSqliteReaderRows(this.reader,query))yield this.parse(table,row);
 }
 *related(relation:MetadataSessionRelationId,key:string):Generator<CapturedLoopRow,void,unknown>{
  this.current();const table=METADATA_SESSION_QUERIES[metadataSessionRelationManifest[relation].queryId].table;
  if(!this.tables.includes(table))return;
  for(const row of iterateProfileSqliteReaderRelation(this.reader,relation,[key]))yield this.parse(table,row);
 }
 one(relation:MetadataSessionRelationId,key:unknown,required=true):CapturedLoopRow|undefined{
  this.current();if(typeof key!=='string'||!key)throw Error('captured_sqlite_loop_identity');
  if(metadataSessionRelationManifest[relation].cardinality!=='zero-or-one')throw Error('captured_sqlite_loop_relation');
  const iterator=this.related(relation,key);
  try{const first=iterator.next();if(first.done){if(required)throw Error('captured_sqlite_loop_orphan');return undefined;}if(!iterator.next().done)throw Error('captured_sqlite_loop_duplicate_identity');return first.value;}
  finally{iterator.return();}
 }
}
