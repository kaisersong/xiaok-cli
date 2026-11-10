import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContinuityActor, ContinuityService } from './service.js';
import { digest } from './store.js';
import type { HistorySearchHit, HistorySearchInput, HistorySearchResult } from '../../shared/context-continuity-types.js';

export const historySearchInput = z.object({query:z.string().trim().min(1).max(256),limit:z.number().int().min(1).max(20).optional(),
  sourceKinds:z.array(z.enum(['desktop_task','cli_session','native_codex'])).min(1).max(3).optional(),
  after:z.number().int().min(0).max(8640000000000000).optional(),before:z.number().int().min(0).max(8640000000000000).optional(),
}).strict().refine(v=>v.after===undefined||v.before===undefined||v.after<=v.before);
interface Consent { enabled:boolean; revision:number }
interface EntryProof { refId:string; messageId:string; revision:number; contentHash:string; messageHash:string; conversationId:string; title:string|null; titleAuthorized:boolean; managedRevision?:number }
interface Proof { actor:ContinuityActor; actorHash:string; hash:string; targetId?:string; targetHash?:string; consent?:Consent; entries:EntryProof[] }
interface Candidate { message_id:string; revision:number; conversation_id:string; ref_id:string|null; observed_at:number }
const lowerAscii=(s:string)=>s.replace(/[A-Z]/g,c=>c.toLowerCase());
const policyDenials=new Set(['not_readable','blocked_unsettled','snapshot_unavailable','stale_revision','native_context_frozen']);
class SearchBudgetReached extends Error {}

/** Canonical keyword evidence, with no model-supplied grants or principal. */
export class HistorySearch {
  private readonly proofs=new WeakMap<HistorySearchResult,Proof>();
  constructor(private readonly service:ContinuityService){}
  private get db(){return this.service.store.db;}
  private user(actor:ContinuityActor):ContinuityActor{return {...actor,requestSource:'user',taskId:undefined};}
  private privateOrigin(id:string):boolean{
    return !!this.db.prepare("SELECT 1 FROM operations WHERE kind='createConversation' AND json_extract(result,'$.id')=? LIMIT 1").get(id)
      || !!this.db.prepare('SELECT 1 FROM legacy_claims WHERE conversation_id=? AND profile_id=? LIMIT 1').get(id,this.service.store.profileId)
      || !!this.db.prepare('SELECT 1 FROM sync_scopes WHERE conversation_id=?').get(id);
  }
  private requirePrivate(actor:ContinuityActor,id:string){
    const c=this.service.requireConversation(this.user(actor),id);
    if(!this.privateOrigin(id)||this.db.prepare("SELECT 1 FROM message_anchors WHERE conversation_id=? AND source_kind='room' LIMIT 1").get(id))throw new Error('not_readable');
    return c;
  }
  private consent(id:string):Consent{
    const row=this.db.prepare('SELECT enabled,revision FROM history_search_consents WHERE conversation_id=?').get(id);
    if(!row)return {enabled:false,revision:0};
    if(![0,1].includes(Number(row.enabled))||!Number.isSafeInteger(row.revision)||Number(row.revision)<1)throw new Error('not_readable');
    return {enabled:row.enabled===1,revision:Number(row.revision)};
  }
  getConsent(actor:ContinuityActor,id:string):Consent{this.service.assertActor(actor,true);this.requirePrivate(actor,id);return this.consent(id);}
  setConsent(actor:ContinuityActor,input:{conversationId:string;enabled:boolean}):Consent{
    this.service.assertActor(actor,true);
    if(!input||Object.keys(input).some(k=>!['conversationId','enabled'].includes(k))||typeof input.enabled!=='boolean')throw new Error('invalid_argument');
    return this.service.store.transaction(()=>{
      this.service.requireConversationMetadata(this.user(actor),input.conversationId);if(!this.privateOrigin(input.conversationId)||this.db.prepare("SELECT 1 FROM message_anchors WHERE conversation_id=? AND source_kind='room' LIMIT 1").get(input.conversationId))throw new Error('not_readable');const previous=this.consent(input.conversationId);
      if(previous.enabled===input.enabled)return previous;
      const next={enabled:input.enabled,revision:previous.revision+1};
      this.db.prepare('INSERT INTO history_search_consents VALUES (?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision').run(input.conversationId,input.enabled?1:0,next.revision);
      if(!input.enabled)this.db.prepare('UPDATE read_grants SET revoked=1,revision=revision+1 WHERE revoked=0 AND id IN (SELECT grant_id FROM history_search_managed_grants WHERE target_conversation=?)').run(input.conversationId);
      return next;
    });
  }
  /** Promotion follows explicit attachment COMMIT and has its own policy mutation. */
  promote(actor:ContinuityActor,input:{refId:string;targetConversationId:string},grantId:string):void{
    const actual=this.service.getReferenceGrant(actor,input);
    if(!actual||actual.grantId!==grantId)throw new Error('not_readable');
    this.service.store.policyMutation(()=>{this.db.prepare('DELETE FROM history_search_managed_grants WHERE grant_id=? AND target_conversation=?').run(grantId,input.targetConversationId);});
  }
  private target(actor:ContinuityActor):{id:string;hash:string;consent:Consent}|undefined{
    this.service.assertActor(actor);this.db.prepare('SELECT 1').get();
    if(actor.requestSource!=='agent')return;
    this.service.assertTaskReadable(actor.taskId!);
    const row=this.db.prepare('SELECT t.*,c.policy_revision FROM task_bindings t JOIN conversations c ON c.id=t.conversation_id AND c.deleted=0 WHERE t.task_id=? AND t.revoked=0').get(actor.taskId!);
    if(!row)throw new Error('not_readable');
    this.service.requireConversation(actor,String(row.conversation_id));
    const consent=this.consent(String(row.conversation_id));
    if(consent.enabled)this.requirePrivate(actor,String(row.conversation_id));
    return {id:String(row.conversation_id),hash:digest(row),consent};
  }
  search(actor:ContinuityActor,input:HistorySearchInput):HistorySearchResult{
    const parsed=historySearchInput.safeParse(input);if(!parsed.success)throw new Error('invalid_argument');
    const query=parsed.data,limit=query.limit??20,target=this.target(actor),broad=!target||target.consent.enabled;
    const result:HistorySearchResult={mode:'keyword',coverage:'canonical_only',scope:broad?'private_history':'own_and_attached',hits:[]};
    const proof:Proof={actor,actorHash:digest(actor),hash:'',targetId:target?.id,targetHash:target?.hash,consent:target?.consent,entries:[]};
    const kinds=query.sourceKinds??['desktop_task','cli_session','native_codex'];
    const conditions=`a.deleted=0 AND a.source_kind IN (${kinds.map(()=>'?').join(',')}) AND instr(lower(json_extract(v.record,'$.text')),lower(?))>0
      AND json_extract(v.record,'$.observedAt')>=? AND json_extract(v.record,'$.observedAt')<=?`;
    const parameters=[...kinds,query.query,query.after??0,query.before??8640000000000000];
    // Detach only identity metadata before creating refs on this connection.
    // Message bodies are read only after exact current authority is established.
    const latest=this.db.prepare(`SELECT a.id AS message_id,a.latest_revision AS revision,a.conversation_id,NULL AS ref_id,json_extract(v.record,'$.observedAt') AS observed_at
      FROM message_anchors a JOIN conversations c ON c.id=a.conversation_id AND c.deleted=0 JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision
      WHERE ${conditions}${broad?'':' AND a.conversation_id=?'}`).all(...parameters,...(!broad?[target!.id]:[]));
    const attached=target?this.db.prepare(`SELECT a.id AS message_id,e.revision,a.conversation_id,e.ref_id,json_extract(v.record,'$.observedAt') AS observed_at
      FROM read_grants g JOIN context_ref_entries e ON e.ref_id=g.ref_id JOIN message_anchors a ON a.id=e.message_id JOIN conversations c ON c.id=a.conversation_id AND c.deleted=0
      JOIN message_versions v ON v.message_id=e.message_id AND v.revision=e.revision WHERE g.target_conversation=? AND g.revoked=0 AND ${conditions}`).all(target.id,...parameters):[];
    const candidates=[...attached,...latest] as unknown as Candidate[];
    candidates.sort((a,b)=>Number(b.observed_at)-Number(a.observed_at)||String(a.message_id).localeCompare(String(b.message_id))||Number(b.revision)-Number(a.revision));
    const seen=new Set<string>();
      for(const candidate of candidates){
        if(result.hits.length>=limit)break;
        const identity=JSON.stringify([candidate.message_id,candidate.revision]);if(seen.has(identity))continue;
        try{
          const pair=(()=>{
            let refId=candidate.ref_id,title:string|null=null,managedRevision:number|undefined;
            const titleAuthorized=!refId;
            if(refId){
              const managed=this.db.prepare('SELECT m.consent_revision FROM history_search_managed_grants m JOIN read_grants g ON g.id=m.grant_id WHERE g.ref_id=? AND g.target_conversation=? AND g.revoked=0').get(refId,target!.id);
              if(managed){
                if(!target!.consent.enabled||managed.consent_revision!==target!.consent.revision)throw new Error('not_readable');
                this.requirePrivate(actor,candidate.conversation_id);managedRevision=Number(managed.consent_revision);
              }
            }else{
              const source=this.requirePrivate(actor,String(candidate.conversation_id));title=source.title;
              if(target&&source.id!==target.id&&!target.consent.enabled)throw new Error('not_readable');
              this.service.store.policyMutation(()=>{
              refId=this.service.createReference(this.user(actor),{conversationId:source.id,expectedRevision:source.revision,firstMessageId:candidate.message_id,lastMessageId:candidate.message_id,operationId:randomUUID()}).refId;
              if(target&&source.id!==target.id){
                const grant=this.service.attachSearchReference(this.user(actor),{refId,targetConversationId:target.id,operationId:randomUUID()});
                this.db.prepare('INSERT INTO history_search_managed_grants VALUES (?,?,?)').run(grant.grantId,target.id,target.consent.revision);managedRevision=target.consent.revision;
              }
              });
            }
            if(!refId)throw new Error('not_readable');
            const message=this.service.readSearchReferenceMessage(actor,refId,candidate.message_id,Number(candidate.revision));
            if(message.executionState!=='settled'&&message.visibilityBasis!=='user_claimed_archive'&&message.visibilityBasis!=='authenticated_sync')throw new Error('not_readable');
            if(!kinds.includes(message.sourceKind as typeof kinds[number]))throw new Error('not_readable');
            const hit:HistorySearchHit={refId,url:`xiaok://context/v1/${refId}`,conversationId:candidate.conversation_id,title,messageId:message.messageId,revision:message.revision,
              contentHash:message.contentHash,sourceKind:message.sourceKind,observedAt:message.observedAt,executionState:message.executionState,...(message.visibilityBasis?{visibilityBasis:message.visibilityBasis}:{}),excerpt:''};
            const remaining=24000-Buffer.byteLength(JSON.stringify(result))-2;
            const share=Math.floor(remaining/(limit-result.hits.length));
            const overhead=Buffer.byteLength(JSON.stringify(hit))+2;
            const minimum=Buffer.byteLength(JSON.stringify(query.query));
            if(remaining-overhead<minimum)throw new SearchBudgetReached();
            const bodyBudget=Math.min(remaining-overhead,Math.max(minimum,share-overhead));
            hit.excerpt=excerpt(message.text,query.query,bodyBudget);
            const entry:EntryProof={refId,messageId:hit.messageId,revision:hit.revision,contentHash:hit.contentHash,messageHash:digest(message),conversationId:hit.conversationId,title,titleAuthorized,managedRevision};
            return {hit,entry};
          })();
          result.hits.push(pair.hit);proof.entries.push(pair.entry);seen.add(identity);
        }catch(error){if(error instanceof SearchBudgetReached)break;if(!(error instanceof Error)||!policyDenials.has(error.message))throw error;}
      }
    proof.hash=digest(result);this.proofs.set(result,proof);this.assertCurrent(result,actor);
    for(const hit of result.hits)Object.freeze(hit);Object.freeze(result.hits);Object.freeze(result);
    return result;
  }
  assertCurrent(result:HistorySearchResult,actor:ContinuityActor):void{
    const proof=this.proofs.get(result);
    if(!proof||proof.actor!==actor||proof.actorHash!==digest(actor)||proof.hash!==digest(result))throw new Error('not_readable');
    const target=this.target(actor);
    if(target?.id!==proof.targetId||target?.hash!==proof.targetHash||digest(target?.consent??null)!==digest(proof.consent??null))throw new Error('not_readable');
    for(const entry of proof.entries){
      if(entry.titleAuthorized&&this.requirePrivate(actor,entry.conversationId).title!==entry.title)throw new Error('not_readable');
      if(entry.managedRevision!==undefined){
        this.requirePrivate(actor,entry.conversationId);
        if(!target?.consent.enabled||target.consent.revision!==entry.managedRevision)throw new Error('not_readable');
        const managed=this.db.prepare('SELECT m.consent_revision FROM history_search_managed_grants m JOIN read_grants g ON g.id=m.grant_id WHERE g.ref_id=? AND g.target_conversation=? AND g.revoked=0').get(entry.refId,target.id);
        // Promotion removes only the managed association; explicit current access
        // remains independently checked below. It never widens a frozen entry.
        if(managed&&managed.consent_revision!==entry.managedRevision)throw new Error('not_readable');
      }
      const actual=this.service.readSearchReferenceMessageCurrent(actor,entry.refId,entry.messageId,entry.revision);
      if(actual.contentHash!==entry.contentHash||digest(actual)!==entry.messageHash
        ||actual.executionState!=='settled'&&actual.visibilityBasis!=='user_claimed_archive'&&actual.visibilityBasis!=='authenticated_sync')throw new Error('not_readable');
    }
    if(Buffer.byteLength(JSON.stringify(result))>24000)throw new Error('budget_exceeded');
  }
}

function excerpt(text:string,query:string,budget:number):string{
  const position=lowerAscii(text).indexOf(lowerAscii(query));if(position<0)throw new Error('not_readable');
  const slice=(length:number)=>{
    let start=Math.max(0,position-Math.floor((length-query.length)/2));let end=Math.min(text.length,start+length);
    if(start>0&&/[\uDC00-\uDFFF]/u.test(text[start]))start++;
    if(end>0&&/[\uD800-\uDBFF]/u.test(text[end-1]))end--;
    return text.slice(start,end);
  };
  let low=query.length,high=Math.min(800,text.length);
  if(Buffer.byteLength(JSON.stringify(slice(low)))>budget)throw new Error('budget_exceeded');
  while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(slice(mid)))<=budget)low=mid;else high=mid-1;}
  return slice(low);
}
