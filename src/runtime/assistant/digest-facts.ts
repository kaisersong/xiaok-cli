import {readCurrentAssistantQualityAssessment} from './quality-authorization.js';
import {readAssistantModelIdentity} from './model-identity.js';
import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {assistantDigestEnvelopeSchema,assistantPeriodicPolicySchema,type AssistantDigestEnvelope,type AssistantDigestFacts} from './notification-policy.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';import {completionConsumerOwner} from '../verification/completion-consumer-owner.js';
/** Read-only facts in the fixed Desktop data root. No caller-selected SQL/path. */
export function readAssistantDigestFacts(dataRoot:string,raw:AssistantDigestEnvelope,qualification?:()=>{qualityDigest:string;analysisContract:string}|undefined):AssistantDigestFacts|undefined{
 let db:DatabaseSync|undefined;
 try{
  const envelope=assistantDigestEnvelopeSchema.parse(raw),file=join(dataRoot,'loop-evidence.sqlite');if(!existsSync(file))return undefined;
  const wal=existsSync(file+'-wal');if(wal&&!existsSync(file+'-shm'))return undefined;
  db=new DatabaseSync(wal?file:`${pathToFileURL(file).href}?immutable=1`,{readOnly:true});
  const intent=db.prepare('SELECT * FROM assistant_digest_deliveries WHERE id=?').get(envelope.deliveryId);
  const policyRow=db.prepare('SELECT payload_json FROM assistant_periodic_policy WHERE profile_id=?').get(envelope.profileId);
  const profile=db.prepare('SELECT status,data_scopes_json FROM assistant_profiles WHERE id=?').get(envelope.profileId);
  if(!intent||!policyRow||!profile||!intent.scope_hash)return undefined;
  const actual=assistantDigestEnvelopeSchema.parse(JSON.parse(String(intent.envelope_json))),policy=assistantPeriodicPolicySchema.parse(JSON.parse(String(policyRow.payload_json)));
  const source=db.prepare('SELECT analysis_status,payload_json FROM assistant_source_runs WHERE run_id=? AND profile_id=?').get(String(intent.source_run_id),envelope.profileId);
  const run=db.prepare('SELECT status,loop_id FROM loop_runs WHERE id=?').get(String(intent.source_run_id));
  const scopes=createHash('sha256').update(JSON.stringify(JSON.parse(String(profile.data_scopes_json)))).digest('hex');
  const now=Date.now(),coverage=source?JSON.parse(String(source.payload_json)).coverage:undefined;
  const active=Array.isArray(coverage)?coverage.filter((row:{status?:string})=>row.status!=='disabled'):[];
  const coverageCurrent=active.length>0&&active.every((row:{status?:string;freshUntil?:number})=>row.status==='checked'&&Number(row.freshUntil)>now);
  const proposalsCurrent=actual.revisions.every(ref=>{const row=db!.prepare('SELECT payload_json FROM assistant_action_proposals WHERE profile_id=? AND work_identity=?').get(envelope.profileId,ref.workItemIdentity);if(!row)return false;const proposal=JSON.parse(String(row.payload_json));return proposal.decision==='open'&&proposal.originRunId===intent.source_run_id&&proposal.validUntil>now;});
  const loopActive=run&&db.prepare('SELECT status FROM loop_definitions WHERE id=?').get(String(run.loop_id))?.status==='active';
  const sourceCurrent=intent.dispatch_state==='sent'&&loopActive&&coverageCurrent&&proposalsCurrent&&source?.analysis_status==='complete'&&run?.status==='success'&&scopes===intent.scope_hash&&readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:String(intent.source_run_id)})).kind==='ordinary';
  const budgetRow=db.prepare('SELECT a.payload_json FROM assistant_analysis_runs r JOIN assistant_analysis_attempts a ON a.attempt_id=r.attempt_id WHERE r.run_id=?').get(String(intent.source_run_id));
  const attempt=budgetRow?JSON.parse(String(budgetRow.payload_json)):undefined;
  const analysisAdmitted=attempt?.state==='settled'&&Number.isSafeInteger(attempt.inputTokens)&&Number.isSafeInteger(attempt.outputTokens)&&attempt.inputTokens>0&&attempt.inputTokens<=48000&&attempt.outputTokens>0&&attempt.outputTokens<=6000&&attempt.providerContract===policy.analysisContract&&Number.isSafeInteger(attempt.chargedInput)&&Number.isSafeInteger(attempt.chargedOutput)&&attempt.chargedInput>=0&&attempt.chargedOutput>=0&&attempt.chargedInput<=attempt.inputTokens&&attempt.chargedOutput<=attempt.outputTokens;
  const committedAt=Number(intent.committed_at);
  const slots=Number(db.prepare('SELECT COUNT(*) AS n FROM assistant_digest_deliveries WHERE committed_at>? AND committed_at<=?').get(committedAt-86400000,committedAt)?.n??0);
  const overlaps=db.prepare('SELECT 1 FROM assistant_digest_deliveries WHERE id<>? AND committed_at>? AND committed_at<=? LIMIT 1').get(envelope.deliveryId,committedAt-4*3600000,committedAt);
  const budgetAdmitted=!!analysisAdmitted&&Number.isSafeInteger(committedAt)&&slots>=1&&slots<=2&&!overlaps;
  const assessment=qualification?undefined:readCurrentAssistantQualityAssessment(db,readAssistantModelIdentity);
  const qualified=qualification?qualification():assessment?{qualityDigest:assessment.reportDigest,analysisContract:assessment.input.protocol.analysisContract}:undefined;const qualificationCurrent=!!qualified&&qualified.qualityDigest===policy.qualityDigest&&qualified.analysisContract===policy.analysisContract;
  return {envelope:actual,policy,qualificationCurrent,profileActive:profile.status==='active',sourceCurrent:!!sourceCurrent,budgetAdmitted};
 }catch{return undefined;}
 finally{db?.close();}
}
