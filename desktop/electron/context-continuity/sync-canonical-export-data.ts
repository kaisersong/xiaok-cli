import {createHash} from 'node:crypto';
import type {ContinuityActor,ContinuityService} from './service.js';
import type {TaskSnapshot} from '../../shared/task-types.js';
import type {ContinuityMessage} from '../../shared/context-continuity-types.js';
import {projectPublicTaskMessages} from '../../shared/context-continuity-projection.js';
import {readPreparedTaskPresentationForCanonicalExport} from './task-presentation.js';
import {captureCanonicalStoreState} from './sync-canonical-state.js';
import {canonicalVersionDigest,validateCanonicalBundle,type CanonicalSyncBatch,type CanonicalSyncScope} from './sync-canonical-codec.js';
import {digest} from './store.js';

// DATA adapter only. No object returned here is an authenticated source lease,
// a publication/AEAD permit, a private Store COMMIT or a physical receipt.
// The fixed original runtime must supply its own snapshots before minting a
// separate lease and revalidate that lease at the actual final sinks.
// Per-version dependency/origin manifests still need original durable freezing;
// recomputing this data adapter is not permission to rewrite an old origin.
type Message=CanonicalSyncBatch['messages'][number];
type Version=Message['versions'][number];
type Dependency=Version['dependencies'][number];
type Node={batch:CanonicalSyncBatch;message:Message;version:Version;state:0|1|2};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
const unavailable=(reason='canonical_dependency_unavailable')=>new Error(reason);
const sourceKey=(kind:string,id:string,epoch:string)=>stable([kind,id,epoch]);

/** Exact original SQL rows + caller-supplied snapshot DATA, never authentication.
 * Native/Room/imported sources and tombstones require their original complete
 * adapters/protocol; they are rejected here, never silently omitted. Own-scope
 * reference edges also require an explicit codec authority basis. */
export function captureCanonicalExportData(service:ContinuityService,actor:ContinuityActor,scopes:readonly CanonicalSyncScope[],snapshots:readonly TaskSnapshot[]):ReadonlyArray<Readonly<CanonicalSyncBatch>>{
 service.assertActor(actor,true);const db=service.store.db;if(db.isTransaction)throw unavailable('canonical_export_write_in_progress');
 const before=captureCanonicalStoreState(db),raw=new Map<string,TaskSnapshot>();for(const snapshot of snapshots){if(raw.has(snapshot.taskId))throw unavailable();raw.set(snapshot.taskId,snapshot);}
 if(scopes.length<1||scopes.length>16)throw unavailable();
 const scopeByConversation=new Map<string,CanonicalSyncScope>();for(const scope of scopes){if(scopeByConversation.has(scope.conversationId))throw unavailable();scopeByConversation.set(scope.conversationId,scope);}
 const batches:CanonicalSyncBatch[]=[],nodes=new Map<string,Node>(),sources=new Map<string,Node[]>(),verifiedTasks=new Set<string>();
 const nodeKey=(scope:CanonicalSyncScope,id:string,revision:number)=>stable([scope,id,revision]);
 const verifyTask=(id:string,conversationId:string,epoch:string)=>{
  const snapshot=raw.get(id);if(!snapshot||snapshot.context?.threadId!==conversationId||snapshot.sessionId!==epoch)throw unavailable();
  if(verifiedTasks.has(id))return;
  const bindings=db.prepare('SELECT kind,epoch,conversation_id FROM source_bindings WHERE id=?').all(id);
  if(bindings.length!==1||bindings[0].kind!=='desktop_task'||bindings[0].epoch!==epoch||bindings[0].conversation_id!==conversationId)throw unavailable('canonical_source_binding_mismatch');
  service.assertTaskReadableForCanonicalExport(id);service.assertHistorySourceClosedForCanonicalExport(id,snapshot);
  const presentation=readPreparedTaskPresentationForCanonicalExport(service,snapshot).presentation;
  if(!presentation||presentation.basis==='claimed_archive')throw unavailable('canonical_source_partial');
  const cursor=db.prepare("SELECT * FROM source_cursors WHERE source_kind='desktop_task' AND source_id=? AND source_epoch=?").get(id,epoch),settled=db.prepare('SELECT * FROM source_settlements WHERE task_id=?').get(id);
  if(!cursor||!settled||settled.source_epoch!==epoch||cursor.event_count!==snapshot.events.length||settled.event_count!==snapshot.events.length||settled.prefix_hash!==digest(snapshot.events)||!['completed','failed','cancelled'].includes(String(cursor.terminal_status))||db.prepare('SELECT 1 FROM projection_failures WHERE task_id=?').get(id))throw unavailable('canonical_source_partial');
  const eventRows=db.prepare("SELECT sequence,event_hash FROM source_event_digests WHERE source_kind='desktop_task' AND source_id=? AND source_epoch=? ORDER BY sequence").all(id,epoch);
  if(eventRows.length!==snapshot.events.length||eventRows.some((row,i)=>row.sequence!==i||row.event_hash!==digest(snapshot.events[i])))throw unavailable('canonical_source_projection_mismatch');
  const expected=projectPublicTaskMessages({taskId:id,prompt:presentation.prompt,events:snapshot.events}).filter(message=>message.role!=='user'||presentation.includeUser),actual=db.prepare("SELECT * FROM message_anchors WHERE conversation_id=? AND source_kind='desktop_task' AND source_id=? AND source_epoch=? ORDER BY sequence").all(conversationId,id,epoch);
  if(expected.length!==actual.length)throw unavailable('canonical_source_projection_mismatch');
  for(const [index,anchor]of actual.entries()){const message=expected[index],versions=db.prepare('SELECT * FROM message_versions WHERE message_id=? ORDER BY revision').all(String(anchor.id));
   // The original desktop adapter emits immutable event-coordinate messages at
   // sourceRevision=1. Do not guess missing historic adapter semantics.
   if(anchor.deleted||anchor.latest_revision!==1||anchor.execution_state!=='settled'||versions.length!==1||versions[0].revision!==1||versions[0].source_revision!==1||!message||message.sourceMessageId!==anchor.source_message_id)throw unavailable('canonical_source_projection_mismatch');
   const value=JSON.parse(String(versions[0].record))as ContinuityMessage;
   if(value.messageId!==anchor.id||value.revision!==1||value.sequence!==anchor.sequence||value.sourceKind!=='desktop_task'||value.sourceId!==id||value.sourceMessageId!==message.sourceMessageId||value.role!==message.role||value.text!==message.text||value.contentHash!==digest(message.text))throw unavailable('canonical_source_projection_mismatch');
  }
  verifiedTasks.add(id);
 };
 for(const scope of scopes){
  const conversation=service.requireConversationForCanonicalExport(actor,scope.conversationId);if(conversation.coverage==='unclaimed'||db.prepare('SELECT 1 FROM sync_scopes WHERE conversation_id=?').get(conversation.id))throw unavailable('canonical_source_partial');
  const anchors=db.prepare('SELECT * FROM message_anchors WHERE conversation_id=? ORDER BY sequence').all(conversation.id);
  if(anchors.some(row=>row.deleted))throw unavailable('canonical_export_tombstones_required');
  for(const task of db.prepare('SELECT t.task_id,t.revoked,p.source_kind,s.source_epoch FROM task_bindings t LEFT JOIN task_public_inputs p ON p.task_id=t.task_id LEFT JOIN task_presentation_sources s ON s.task_id=t.task_id WHERE t.conversation_id=?').all(conversation.id)){
   if(task.revoked||task.source_kind!=='desktop_task'||typeof task.source_epoch!=='string')throw unavailable('canonical_source_partial');verifyTask(String(task.task_id),conversation.id,task.source_epoch);
  }
  const batch:CanonicalSyncBatch={schemaVersion:1,kind:'canonical-batch-v1',scope:{...scope},conversation:{title:conversation.title,mode:conversation.mode,createdAt:conversation.createdAt,updatedAt:conversation.updatedAt,revision:conversation.revision,coverage:conversation.coverage},messages:[],references:[],grants:[],coverage:{firstSequence:anchors.length?1:0,lastSequence:anchors.length,anchorCount:anchors.length,versionCount:0},inputProjection:{state:'unavailable'},checkpointProjection:{state:'unavailable'},decisionProjection:{state:'unavailable'},manifestHash:''};
  for(const anchor of anchors){
   if(anchor.source_kind!=='desktop_task')throw unavailable('canonical_source_partial');verifyTask(String(anchor.source_id),conversation.id,String(anchor.source_epoch));
   const message:Message={messageId:String(anchor.id),sequence:Number(anchor.sequence),sourceKind:'desktop_task',sourceId:String(anchor.source_id),sourceEpoch:String(anchor.source_epoch),sourceMessageId:String(anchor.source_message_id),versions:[]};
   for(const row of db.prepare('SELECT * FROM message_versions WHERE message_id=? ORDER BY revision').all(String(anchor.id))){const record=JSON.parse(String(row.record))as ContinuityMessage,version:Version={revision:Number(row.revision),sourceRevision:Number(row.source_revision),role:record.role,text:record.text,contentHash:record.contentHash,originHash:'',dependencies:[],observedAt:record.observedAt,executionObservation:'settled'};message.versions.push(version);batch.coverage.versionCount++;const node:Node={batch,message,version,state:0};nodes.set(nodeKey(scope,message.messageId,version.revision),node);const key=sourceKey(message.sourceKind,message.sourceId,message.sourceEpoch);sources.set(key,[...(sources.get(key)??[]),node]);}
   batch.messages.push(message);
  }
  for(const ref of db.prepare('SELECT * FROM context_refs WHERE conversation_id=? ORDER BY id').all(conversation.id)){
   const entries=db.prepare('SELECT e.message_id,e.revision,v.record FROM context_ref_entries e JOIN message_versions v ON v.message_id=e.message_id AND v.revision=e.revision WHERE e.ref_id=? ORDER BY e.position').all(String(ref.id)).map(row=>({messageId:String(row.message_id),revision:Number(row.revision),contentHash:(JSON.parse(String(row.record))as ContinuityMessage).contentHash}));
   if(digest(entries.map(entry=>[entry.messageId,entry.revision,entry.contentHash]))!==ref.content_hash)throw unavailable();
   batch.references.push({refId:String(ref.id),snapshotRevision:Number(ref.snapshot_revision),contentHash:String(ref.content_hash),entries});
   for(const grant of db.prepare('SELECT * FROM read_grants WHERE ref_id=? ORDER BY id').all(String(ref.id)))batch.grants.push({grantId:String(grant.id),refId:String(ref.id),targetConversationId:String(grant.target_conversation),revision:Number(grant.revision),revoked:grant.revoked===1});
  }
  batches.push(batch);
 }
 const resolve=(node:Node):void=>{
  if(node.state===2)return;if(node.state===1)throw unavailable();node.state=1;const id=node.message.sourceId,deps:Dependency[]=[];
  const append=(kind:'history'|'reference',values:Node[],reference?:Extract<Dependency,{kind:'reference'}>['reference'])=>{
   if(!values.length)throw unavailable();const first=values[0];for(const value of values){if(value.message.sourceId!==first.message.sourceId||value.message.sourceEpoch!==first.message.sourceEpoch||stable(value.batch.scope)!==stable(first.batch.scope))throw unavailable();resolve(value);}
   const base={scope:{...first.batch.scope},sourceKind:first.message.sourceKind,sourceId:first.message.sourceId,sourceEpoch:first.message.sourceEpoch,versions:values.map(value=>({messageId:value.message.messageId,revision:value.version.revision,contentHash:value.version.contentHash,originHash:value.version.originHash}))};
   deps.push(kind==='reference'?{kind,...base,reference:reference!}:{kind,...base});
  };
  for(const edge of db.prepare('SELECT * FROM context_dependencies WHERE task_id=? ORDER BY ref_id').all(id)){
   if(!edge.valid)throw unavailable();const ref=db.prepare('SELECT * FROM context_refs WHERE id=?').get(String(edge.ref_id)),scope=ref&&scopeByConversation.get(String(ref.conversation_id));if(!ref||!scope)throw unavailable();
   if(!edge.grant_id)throw unavailable(ref.conversation_id===node.batch.scope.conversationId?'canonical_same_scope_reference_unavailable':'canonical_dependency_unavailable');
   const grant=db.prepare('SELECT * FROM read_grants WHERE id=?').get(String(edge.grant_id));if(!grant||grant.revoked||grant.revision!==edge.grant_revision||grant.ref_id!==ref.id||grant.target_conversation!==node.batch.scope.conversationId)throw unavailable();
   const groups=new Map<string,Node[]>();for(const entry of db.prepare('SELECT message_id,revision FROM context_ref_entries WHERE ref_id=? ORDER BY position').all(String(ref.id))){const value=nodes.get(nodeKey(scope,String(entry.message_id),Number(entry.revision)));if(!value)throw unavailable();const key=sourceKey(value.message.sourceKind,value.message.sourceId,value.message.sourceEpoch);groups.set(key,[...(groups.get(key)??[]),value]);}
   for(const values of groups.values())append('reference',values,{refId:String(ref.id),snapshotRevision:Number(ref.snapshot_revision),contentHash:String(ref.content_hash),grantId:String(grant.id),grantRevision:Number(grant.revision)});
  }
  for(const table of ['task_history_dependencies','effect_history_dependencies'])for(const edge of db.prepare(`SELECT * FROM ${table} WHERE task_id=? ORDER BY source_task_id`).all(id)){
   if(!edge.valid)throw unavailable();const values=sources.get(sourceKey('desktop_task',String(edge.source_task_id),String(edge.source_epoch)));if(!values)throw unavailable();append('history',values);
  }
  node.version.dependencies=[...new Map(deps.map(dep=>[stable(dep),dep])).values()].sort((a,b)=>stable(a)<stable(b)?-1:stable(a)>stable(b)?1:0);
  node.version.originHash=canonicalVersionDigest(node.batch.scope,node.message,node.version);node.state=2;
 };
 for(const node of nodes.values())resolve(node);
 for(const batch of batches){const {manifestHash:_ignored,...body}=batch;batch.manifestHash=hash(['xiaok/canonical-batch/v1',body]);}
 const result=validateCanonicalBundle(batches),after=captureCanonicalStoreState(db);
 if(db.isTransaction||before.policyHash!==after.policyHash||before.publicationHash!==after.publicationHash)throw unavailable('canonical_source_rows_changed');
 return result;
}
