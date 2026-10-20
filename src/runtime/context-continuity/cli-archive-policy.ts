import {definitivePolicyDenial,ContinuityPolicyUnavailable} from './policy-denial.js';
import {createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
const digest=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
/** Shared readonly policy for original main-claimed CLI archives, never live execution. */
export function assertCliArchiveSource(sourceId:string,options:{db:Pick<DatabaseSync,'prepare'>;scope(id:string):'readable'|'blocked'|'deleted'}):void{
 const db=options.db,bindings=db.prepare("SELECT * FROM source_bindings WHERE kind='cli_session' AND id=?").all(sourceId);if(!bindings.length&&!sourceId.startsWith('cli_archive_'))return;
 const r=db.prepare('SELECT * FROM cli_archive_sources WHERE source_id=?').get(sourceId),profile=db.prepare("SELECT value FROM continuity_meta WHERE key='profileId'").get()?.value;
 if(bindings.length!==1||!r||r.profile_id!==profile||r.mode!=='standalone_legacy_v1'||r.domain!=='local-cli-file-v1'||bindings[0].epoch!==r.file_hash||bindings[0].conversation_id!==r.conversation_id)throw definitivePolicyDenial();
 const scope:unknown=options.scope(String(r.conversation_id));if(scope!=='readable'){if(scope==='blocked'||scope==='deleted')throw definitivePolicyDenial();if(scope instanceof Promise)void scope.catch(()=>{});throw new ContinuityPolicyUnavailable('invalid_scope_result');}
 const c=db.prepare('SELECT deleted FROM conversations WHERE id=?').get(String(r.conversation_id)),claim=db.prepare('SELECT * FROM legacy_claims WHERE preview_id=?').get(String(r.claim_id));
 if(!c||c.deleted||!claim||claim.profile_id!==profile||claim.conversation_id!==r.conversation_id||claim.manifest_hash!==r.manifest_hash||!Number.isSafeInteger(r.message_count)||Number(r.message_count)<1||Number(r.message_count)>5000)throw definitivePolicyDenial();
 const projected:unknown[]=[];let total=0;
 for(const row of db.prepare('SELECT a.*,v.revision,v.source_revision,v.record FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision WHERE a.source_id=? ORDER BY a.sequence LIMIT 5001').iterate(sourceId)){
  if(row.deleted||row.conversation_id!==r.conversation_id||row.source_kind!=='cli_session'||row.source_epoch!==r.file_hash||row.latest_revision!==1||row.source_revision!==1||Buffer.byteLength(String(row.record))>8*1024*1024)throw definitivePolicyDenial();const m=JSON.parse(String(row.record)),visible=db.prepare('SELECT * FROM archive_visibilities WHERE message_id=? AND revision=1').get(String(row.id));
  if(!m||!['user','assistant'].includes(m.role)||m.messageId!==row.id||m.revision!==1||m.sourceId!==sourceId||m.sourceKind!=='cli_session'||m.sourceMessageId!==row.source_message_id||typeof m.text!=='string'||digest(m.text)!==m.contentHash||m.executionState!=='unknown'||!visible||visible.claim_id!==r.claim_id||visible.source_epoch!==r.file_hash||visible.content_hash!==m.contentHash||(total+=Buffer.byteLength(m.text))>4*1024*1024)throw definitivePolicyDenial();
  projected.push({sourceMessageId:m.sourceMessageId,role:m.role,text:m.text,observedAt:m.observedAt});
 }
 if(projected.length!==r.message_count||digest(projected)!==r.projection_hash)throw definitivePolicyDenial();
}
