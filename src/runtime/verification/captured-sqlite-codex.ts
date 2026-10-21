import {readProfileSourceCapture,readProfileSqliteSchema,readProfileSqliteRows,assertProfileSqliteIntegrity} from './profile-source-capture.js';
import {capturedFields,capturedIdentity,capturedInteger,freezeCapturedData,parseCapturedSourceJson} from './captured-source-json.js';
import {CODEX_SOURCE_SCHEMAS} from './codex-source-schema.js';
import type {NativeSnapshot} from '../task-host/codex-native-types.js';
import type {MetadataSessionQueryId} from './metadata-session-query-manifest.js';
import type {ProfileSourceDirectory} from './profile-source-descriptor.js';
interface NativeRow {id:string;owner:string;nativeId:string|null;snapshot:NativeSnapshot}
interface CodexSource {sourceId:string;snapshotHash:string;nativeSessions:NativeRow[];settings:Array<{key:'selected';value:'true'|'false'}>;threads:Array<{threadId:string;nativeId:string}>;routes:Array<{taskId:string;threadId:string;threadPresent:boolean}>}
interface Pair {routesSourceId:string;nativeSourceId:string|null;directory:Readonly<ProfileSourceDirectory>;state:'paired'|'native-source-absent'}
function fail(reason:string):never{throw Error('captured_sqlite_codex_'+reason);}
function text(value:unknown):asserts value is string{if(typeof value!=='string')fail('text');}
function thread(value:unknown):asserts value is string{text(value);if(!value)fail('thread');}
function snapshot(raw:unknown,id:string):NativeSnapshot{
 text(raw);const parsed=parseCapturedSourceJson(raw);capturedFields(parsed,['id','title','cwd','status','updatedAt','revision','messages','approvals','queued'],['error']);const value=parsed as Record<string,unknown>;
 if(value.id!==id)fail('identity');text(value.title);text(value.cwd);if(value.title.length>60||typeof value.status!=='string'||!['disconnected','connecting','idle','running','error'].includes(value.status))fail('snapshot');
 capturedInteger(value.updatedAt);capturedInteger(value.revision,1);capturedInteger(value.queued);if(value.error!==undefined)text(value.error);
 if(!Array.isArray(value.messages)||value.messages.length>200||!Array.isArray(value.approvals)||value.approvals.length)fail('snapshot');
 for(const message of value.messages){capturedFields(message,['id','role','text'],['state']);capturedIdentity(message.id);text(message.text);if(!['user','assistant'].includes(message.role)||message.text.length>65536||message.state!==undefined&&!['queued','sent','cancelled','unknown'].includes(message.state))fail('message');}
 return value as unknown as NativeSnapshot;
}
/** Complete known-format statements from a single actual full capture. Neither
 * ordinary owner strings nor external persisted IDs grant native authority. */
export function readCapturedSQLiteCodexSources(owner:object,token:object){
 const capture=readProfileSourceCapture(owner,token),sources:CodexSource[]=[],pairs:Pair[]=[];
 const descriptors=new Map(capture.sources.map(s=>[s.source.sourceId,s.source]));
 const directoryKey=(directory:Readonly<ProfileSourceDirectory>)=>JSON.stringify([directory.canonicalPath,directory.device,directory.inode]);
 const peerSources=new Map<string,Array<typeof capture.sources[number]['source']>>(),nativeIds=new Map<string,Set<string>>();
 for(const {source} of capture.sources)if(source.kind==='sqlite-db'&&source.database.basename==='codex-native.sqlite'){
  const key=directoryKey(source.directory),peers=peerSources.get(key)??[];peers.push(source);peerSources.set(key,peers);
 }
 for(const entry of capture.sources){
  const source=entry.source;if(source.kind!=='sqlite-db'||!['codex-native-sqlite-v1','codex-routes-sqlite-v1'].includes(source.snapshotFormat))continue;
  const format=source.snapshotFormat as keyof typeof CODEX_SOURCE_SCHEMAS,expected=CODEX_SOURCE_SCHEMAS[format],actual=readProfileSqliteSchema(owner,token,source.sourceId);
  if(actual.length!==expected.length||actual.some((row,i)=>{const e=expected[i]!;return row.type!==e.type||row.name!==e.name||row.tbl_name!==e.tbl_name||(typeof row.sql==='string'?row.sql.replace(/\s+/g,' ').trim():row.sql)!==e.sql;}))fail('schema');
  assertProfileSqliteIntegrity(owner,token,source.sourceId);
  const facts:CodexSource={sourceId:source.sourceId,snapshotHash:entry.snapshotHash,nativeSessions:[],settings:[],threads:[],routes:[]};
  const rows=(query:MetadataSessionQueryId)=>readProfileSqliteRows(owner,token,source.sourceId,query);
  if(format==='codex-native-sqlite-v1'){
   for(const row of rows('codex-native:codex_native_sessions')){capturedIdentity(row.id);text(row.owner);if(row.native_id!==null)text(row.native_id);facts.nativeSessions.push({id:row.id,owner:row.owner,nativeId:row.native_id as string|null,snapshot:snapshot(row.snapshot,row.id)});}
   facts.nativeSessions.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
   nativeIds.set(source.sourceId,new Set(facts.nativeSessions.map(row=>row.id)));
  }else{
   if(source.database.basename!=='codex-task-routes.sqlite')fail('routes_namespace');
   for(const row of rows('codex-routes:settings')){if(row.key!=='selected'||row.value!=='true'&&row.value!=='false'||facts.settings.length)fail('settings');facts.settings.push({key:row.key,value:row.value});}
   for(const row of rows('codex-routes:threads')){thread(row.id);capturedIdentity(row.native_id);facts.threads.push({threadId:row.id,nativeId:row.native_id});}
   const threadIds=new Set(facts.threads.map(row=>row.threadId));
   for(const row of rows('codex-routes:routes')){capturedIdentity(row.task_id);thread(row.thread_id);facts.routes.push({taskId:row.task_id,threadId:row.thread_id,threadPresent:threadIds.has(row.thread_id)});}
   facts.threads.sort((a,b)=>a.threadId<b.threadId?-1:a.threadId>b.threadId?1:0);facts.routes.sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0);
  }
  sources.push(facts);
 }
 for(const facts of sources){
  const source=descriptors.get(facts.sourceId)!;if(source.kind!=='sqlite-db'||source.snapshotFormat!=='codex-routes-sqlite-v1')continue;
  const peers=peerSources.get(directoryKey(source.directory))??[];
  if(peers.some(d=>d.kind!=='sqlite-db'||d.snapshotFormat!=='codex-native-sqlite-v1'))fail('pair_format');
  if(peers.length>1)fail('pair');
  const native=peers[0],ids=native?nativeIds.get(native.sourceId):undefined;
  if(native&&(!ids||facts.threads.some(t=>!ids.has(t.nativeId))))fail('native_reference');
  pairs.push({routesSourceId:source.sourceId,nativeSourceId:native?.sourceId??null,directory:source.directory,state:native?'paired':'native-source-absent'});
 }
 readProfileSourceCapture(owner,token);return freezeCapturedData({kind:'captured-sqlite-codex-declarations' as const,sources,pairs});
}
