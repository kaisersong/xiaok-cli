import {assistantOwnedRun,assistantOwnedExec} from './assistant-owned-sqlite.js';
import {assistantOwnedGet,assistantOwnedAll} from './assistant-owned-sqlite.js';
import {assistantOwnedSqlite} from './assistant-owned-sqlite.js';
import {readOriginalLoopMigrationLease,type LoopDatabaseLease} from './loop-database-owner.js';
import {assistantDigestReceiptSchema,type AssistantDigestReceipt} from '../../src/runtime/assistant/digest-receipts.js';
import type {TimedActionService} from './timed-action-service.js';
import {ASSISTANT_CHECK_LOOP_ID} from './assistant-types.js';
import {randomUUID,createHash} from 'node:crypto';import type {DatabaseSync} from 'node:sqlite';
import {assistantPeriodicConfigurationSchema,assistantPeriodicPolicySchema,assistantDigestEnvelopeSchema,assistantRevisionSchema,type AssistantPeriodicPolicy,type AssistantDigestEnvelope} from '../../src/runtime/assistant/notification-policy.js';
import type {LoopStore} from './loop-store.js';
type Source='user'|'agent'|'scheduler';
export function migrateAssistantPeriodicPolicy(db:DatabaseSync, original: LoopDatabaseLease){assistantOwnedExec(db,original,`CREATE TABLE IF NOT EXISTS assistant_periodic_policy(profile_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_digest_clock(id INTEGER PRIMARY KEY CHECK(id=1),logical_now INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS assistant_digest_deliveries(id TEXT PRIMARY KEY,source_run_id TEXT UNIQUE NOT NULL,committed_at INTEGER NOT NULL,policy_revision INTEGER NOT NULL,envelope_json TEXT NOT NULL,scope_hash TEXT,dispatch_state TEXT NOT NULL DEFAULT 'pending',receipt_json TEXT);
 CREATE TABLE IF NOT EXISTS assistant_notification_revision_ledger(work_identity TEXT NOT NULL,notifiable_revision TEXT NOT NULL,delivery_id TEXT NOT NULL,PRIMARY KEY(work_identity,notifiable_revision));`);
 const columns=new Set(assistantOwnedAll(db,original,'PRAGMA table_info(assistant_digest_deliveries)').map(row=>row.name));
 if(!columns.has('scope_hash'))assistantOwnedExec(db,original,'ALTER TABLE assistant_digest_deliveries ADD COLUMN scope_hash TEXT');
 if(!columns.has('dispatch_state'))assistantOwnedExec(db,original,"ALTER TABLE assistant_digest_deliveries ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'pending'");
 if(!columns.has('receipt_json'))assistantOwnedExec(db,original,'ALTER TABLE assistant_digest_deliveries ADD COLUMN receipt_json TEXT');
}
export function getAssistantPeriodicPolicy(db:DatabaseSync, original: LoopDatabaseLease):AssistantPeriodicPolicy|undefined{
 const row=assistantOwnedGet(db,original,'SELECT payload_json FROM assistant_periodic_policy WHERE profile_id=?','default-personal-assistant');return row?assistantPeriodicPolicySchema.parse(JSON.parse(String(row.payload_json))):undefined;
}
export function setAssistantPeriodicPolicy(db:DatabaseSync, original: LoopDatabaseLease,value:AssistantPeriodicPolicy,expectedRevision:number){
 const old=getAssistantPeriodicPolicy(db, original);if((old?.revision??0)!==expectedRevision)throw Error('assistant_periodic_policy_conflict');
 const next=assistantPeriodicPolicySchema.parse({...value,revision:expectedRevision+1});
 assistantOwnedRun(db,original,'INSERT INTO assistant_periodic_policy(profile_id,revision,payload_json) VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json',next.profileId,next.revision,JSON.stringify(next));return next;
}
export function prepareAssistantDigest(db:DatabaseSync, original: LoopDatabaseLease,input:{runId:string;revisions:AssistantDigestEnvelope['revisions'];now:number;isCurrent:()=>boolean}){
 if(typeof input.runId!=='string'||!input.runId||input.runId.length>256||!Number.isSafeInteger(input.now)||input.now<0)throw Error('assistant_digest_input');
 const revisions=assistantRevisionSchema.array().max(3).parse(input.revisions),policy=getAssistantPeriodicPolicy(db, original);
 if(!policy?.enabled||!policy.notificationsEnabled||!policy.qualityDigest||!policy.analysisContract)return {status:'disabled' as const};
 const source=assistantOwnedGet(db,original,"SELECT 1 FROM assistant_source_runs s JOIN loop_runs r ON r.id=s.run_id WHERE s.run_id=? AND s.profile_id=? AND s.analysis_status='complete' AND r.loop_id='personal-assistant-transaction-check' AND r.status='success'",input.runId,policy.profileId);
 if(!source)throw Error('assistant_digest_source_unknown');
 const now=Math.max(input.now,Number(assistantOwnedGet(db,original,'SELECT logical_now FROM assistant_digest_clock WHERE id=1')?.logical_now??0));
 assistantOwnedRun(db,original,'INSERT INTO assistant_digest_clock(id,logical_now) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET logical_now=excluded.logical_now',now);
 if(!input.isCurrent())throw Error('assistant_digest_source_stale');
 const prior=assistantOwnedGet(db,original,'SELECT envelope_json FROM assistant_digest_deliveries WHERE source_run_id=?',input.runId);
 if(prior)return {status:'prepared' as const,envelope:assistantDigestEnvelopeSchema.parse(JSON.parse(String(prior.envelope_json)))};
 const seen=new Set<string>();const difference=revisions.filter(ref=>{const key=ref.workItemIdentity+ref.notifiableRevision;if(seen.has(key))return false;seen.add(key);return !assistantOwnedGet(db,original,'SELECT 1 FROM assistant_notification_revision_ledger WHERE work_identity=? AND notifiable_revision=?',ref.workItemIdentity,ref.notifiableRevision);});
 if(!difference.length)return {status:'no_difference' as const};
 const recent=assistantOwnedAll(db,original,'SELECT committed_at FROM assistant_digest_deliveries WHERE committed_at>?',now-86400000);
 if(recent.length>=2||recent.some(row=>now-Number(row.committed_at)<4*3600000))return {status:'budget_exhausted' as const};
 const scopes=assistantOwnedGet(db,original,'SELECT data_scopes_json FROM assistant_profiles WHERE id=?',policy.profileId);
 const scopeHash=createHash('sha256').update(JSON.stringify(JSON.parse(String(scopes?.data_scopes_json??'[]')))).digest('hex');
 const envelope=assistantDigestEnvelopeSchema.parse({profileId:policy.profileId,deliveryId:randomUUID(),policyRevision:policy.revision,revisions:difference});
 assistantOwnedRun(db,original,'INSERT INTO assistant_digest_deliveries(id,source_run_id,committed_at,policy_revision,envelope_json,scope_hash) VALUES(?,?,?,?,?,?)',envelope.deliveryId,input.runId,now,policy.revision,JSON.stringify(envelope),scopeHash);
 for(const ref of difference)assistantOwnedRun(db,original,'INSERT INTO assistant_notification_revision_ledger(work_identity,notifiable_revision,delivery_id) VALUES(?,?,?)',ref.workItemIdentity,ref.notifiableRevision,envelope.deliveryId);
 if(!input.isCurrent())throw Error('assistant_digest_source_stale');return {status:'prepared' as const,envelope};
}
export function getAssistantDigestDelivery(db:DatabaseSync, original: LoopDatabaseLease,id:string){
 const row=assistantOwnedGet(db,original,'SELECT envelope_json,dispatch_state,receipt_json FROM assistant_digest_deliveries WHERE id=?',id);return row?{envelope:assistantDigestEnvelopeSchema.parse(JSON.parse(String(row.envelope_json))),state:String(row.dispatch_state),receipt:row.receipt_json?assistantDigestReceiptSchema.parse(JSON.parse(String(row.receipt_json))):undefined}:undefined;
}
export function claimAssistantDigestDispatch(db:DatabaseSync, original: LoopDatabaseLease,envelope:AssistantDigestEnvelope){
 const actual=getAssistantDigestDelivery(db, original,envelope.deliveryId);if(!actual||JSON.stringify(actual.envelope)!==JSON.stringify(envelope))throw Error('assistant_digest_dispatch_conflict');
 return assistantOwnedRun(db,original,"UPDATE assistant_digest_deliveries SET dispatch_state='sent' WHERE id=? AND dispatch_state='pending'",envelope.deliveryId).changes===1;
}
export function finishAssistantDigestDelivery(db:DatabaseSync, original: LoopDatabaseLease,raw:AssistantDigestReceipt){
 const receipt=assistantDigestReceiptSchema.parse(raw),actual=getAssistantDigestDelivery(db, original,receipt.deliveryId);if(!actual||actual.state!=='sent')throw Error('assistant_digest_dispatch_missing');
 if(actual.receipt&&actual.receipt.status!=='unknown'){if(receipt.status==='unknown')return actual.receipt;if(JSON.stringify(actual.receipt)!==JSON.stringify(receipt))throw Error('assistant_digest_ack_conflict');return actual.receipt;}
 assistantOwnedRun(db,original,"UPDATE assistant_digest_deliveries SET receipt_json=? WHERE id=? AND (receipt_json IS NULL OR json_extract(receipt_json,'$.status')='unknown')",JSON.stringify(receipt),receipt.deliveryId);return receipt;
}
export function listAssistantDigestRecovery(db:DatabaseSync, original: LoopDatabaseLease):AssistantDigestEnvelope[]{return assistantOwnedAll(db,original,"SELECT envelope_json FROM assistant_digest_deliveries WHERE receipt_json IS NULL OR json_extract(receipt_json,'$.status')='unknown' ORDER BY committed_at LIMIT 100").map(row=>assistantDigestEnvelopeSchema.parse(JSON.parse(String(row.envelope_json))));}
export class AssistantPeriodicPolicyService {
 private readonly now:()=>number;
 constructor(private readonly options:{store:LoopStore;timeZone:string;now?:()=>number;timedActionService?:TimedActionService;globalEnabled?:()=>boolean;onCommitted?:()=>void;delivery?:{available():Promise<boolean>;send(envelope:AssistantDigestEnvelope):Promise<AssistantDigestReceipt>;lookup(id:string):Promise<AssistantDigestReceipt|undefined>};qualification?:()=>{qualityDigest:string;analysisContract:string}|undefined}){this.now=options.now??Date.now;new Intl.DateTimeFormat('en',{timeZone:options.timeZone});}
 status():AssistantPeriodicPolicy{return this.options.store.getAssistantPeriodicPolicy()??{profileId:'default-personal-assistant',revision:0,enabled:false,notificationsEnabled:false,intervalMinutes:240,timeZone:this.options.timeZone,quietHours:{start:'22:00',end:'08:00'},qualityDigest:null,analysisContract:null};}
 configure(raw:{enabled:boolean;notificationsEnabled:boolean;intervalMinutes:number;expectedRevision:number;requestSource:Source;quietHours?:{start:string;end:string}}){
  if(raw?.requestSource!=='user')throw Error('assistant_periodic_user_only');
  const input=assistantPeriodicConfigurationSchema.parse(raw);
  const qualification=this.options.qualification?.();if(input.enabled&&!qualification)throw Error('assistant_periodic_quality_unverified');
  const current=this.status();const updated=this.options.store.setAssistantPeriodicPolicy({...current,enabled:input.enabled,notificationsEnabled:input.notificationsEnabled,intervalMinutes:input.intervalMinutes,quietHours:input.quietHours??current.quietHours,qualityDigest:qualification?.qualityDigest??null,analysisContract:qualification?.analysisContract??null},input.expectedRevision);
  this.options.onCommitted?.();this.syncSchedule({requestSource:'scheduler'});return updated;
 }
 syncSchedule(input:{requestSource:Source}){
  if(input?.requestSource!=='scheduler')throw Error('assistant_periodic_schedule_denied');
  const timed=this.options.timedActionService;if(!timed)return;
  const policy=this.status(),qualification=this.options.qualification?.(),profile=this.options.store.getAssistantProfile('default-personal-assistant');
  const active=policy.enabled&&!!qualification&&qualification.qualityDigest===policy.qualityDigest&&qualification.analysisContract===policy.analysisContract&&profile?.status==='active'&&this.options.globalEnabled?.()!==false;
  this.options.store.setLoopStatus(ASSISTANT_CHECK_LOOP_ID,active?'active':'paused',this.now());
  if(active||timed.getActions().some(action=>action.id==='assistant:default-personal-assistant:check'))timed.ensureAssistantPeriodicSchedule({intervalMinutes:policy.intervalMinutes,status:active?'active':'paused'},{requestSource:'scheduler',ownerId:'default-personal-assistant'});
 }
 async dispatchDigest(envelope:AssistantDigestEnvelope,input:{requestSource:Source}):Promise<AssistantDigestReceipt>{
  if(input?.requestSource!=='scheduler')throw Error('assistant_digest_dispatch_denied');
  envelope=assistantDigestEnvelopeSchema.parse(envelope);const actual=this.options.store.getAssistantDigestDelivery(envelope.deliveryId);if(!actual||JSON.stringify(actual.envelope)!==JSON.stringify(envelope))throw Error('assistant_digest_dispatch_conflict');
  if(actual.receipt&&actual.receipt.status!=='unknown')return actual.receipt;
  const unknown:AssistantDigestReceipt={deliveryId:envelope.deliveryId,status:'unknown'};
  if(actual.state==='sent'){
   try{const receipt=await this.options.delivery?.lookup(envelope.deliveryId);if(receipt)return this.options.store.finishAssistantDigestDelivery(receipt);}catch{}return unknown;
  }
  const qualification=this.options.qualification?.(),policy=this.status();
  let suppression:AssistantDigestReceipt['suppressionReason'];
  if(!policy.enabled||!policy.notificationsEnabled||!qualification)suppression='disabled';
  else if(policy.revision!==envelope.policyRevision||qualification.qualityDigest!==policy.qualityDigest||qualification.analysisContract!==policy.analysisContract)suppression='stale_policy';
  else{try{if(!await this.options.delivery?.available())suppression='platform_unavailable';}catch{suppression='platform_unavailable';}}
  if(!this.options.store.claimAssistantDigestDispatch(envelope))return this.dispatchDigest(envelope,input);
  if(suppression)return this.options.store.finishAssistantDigestDelivery({deliveryId:envelope.deliveryId,status:'suppressed',suppressionReason:suppression});
  try{const receipt=await this.options.delivery!.send(envelope);if(receipt.deliveryId!==envelope.deliveryId)throw Error('assistant_digest_ack_conflict');return this.options.store.finishAssistantDigestDelivery(receipt);}catch{return unknown;}
 }
 async recoverDeliveries(input:{requestSource:Source}){if(input?.requestSource!=='scheduler')throw Error('assistant_digest_dispatch_denied');for(const envelope of this.options.store.listAssistantDigestRecovery())await this.dispatchDigest(envelope,input);}
 prepareDigest(input:{runId:string;revisions:AssistantDigestEnvelope['revisions'];isCurrent:()=>boolean;requestSource:Source}){
  if(input?.requestSource!=='scheduler')throw Error('assistant_digest_source_denied');
  const qualification=this.options.qualification?.(),policy=this.status();
  if(!qualification||qualification.qualityDigest!==policy.qualityDigest||qualification.analysisContract!==policy.analysisContract)return {status:'disabled' as const};
  return this.options.store.prepareAssistantDigest({runId:input.runId,revisions:input.revisions,isCurrent:input.isCurrent,now:this.now()});
 }
}
