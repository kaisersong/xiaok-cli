import {qualityContextSchema,qualityRecordSchema,frozenQualityDigest} from './quality-authorization.js';
import {assessCurrentAssistantQuality} from './quality-assessment-observation.js';
import {parseCapturedSourceJson} from '../verification/captured-source-json.js';
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
  let model:ReturnType<typeof readAssistantModelIdentity>|undefined;try{model=readAssistantModelIdentity();}catch{/* Unreadable identity cannot qualify, but remaining negative facts stay observable. */}
  // One original SQLite statement observes context/state/profile/latest report
  // consistently; this read-only connection never opens a writer savepoint.
  const quality=db.prepare("SELECT c.payload_json AS context_json,s.generation,p.status,p.updated_at,p.data_scopes_json,a.assessment_id,a.payload_json AS record_json FROM assistant_quality_context c JOIN assistant_quality_state s ON s.singleton=1 JOIN assistant_profiles p ON p.id=? LEFT JOIN assistant_quality_assessments a ON a.rowid=(SELECT MAX(rowid) FROM assistant_quality_assessments) WHERE c.singleton=1").get(envelope.profileId);
  let assessment:ReturnType<typeof assessCurrentAssistantQuality>;
  if(model&&quality&&quality.record_json&&quality.status==='active'){
   const context=qualityContextSchema.parse(parseCapturedSourceJson(String(quality.context_json))),record=qualityRecordSchema.parse(parseCapturedSourceJson(String(quality.record_json))),scopes=parseCapturedSourceJson(String(quality.data_scopes_json));
   if(Array.isArray(scopes)&&new Set(scopes).size===scopes.length&&JSON.stringify([...scopes].sort())===JSON.stringify([...context.scopes].sort())&&quality.updated_at===context.binding.grantEpoch&&quality.assessment_id===record.assessmentId&&record.digest===frozenQualityDigest(record)&&Number.isSafeInteger(quality.generation)&&Number(quality.generation)>=0)assessment=assessCurrentAssistantQuality({context,record,generation:Number(quality.generation),model,finalModel:readAssistantModelIdentity()});
  }
  const qualified=qualification?qualification():assessment?{qualityDigest:assessment.reportDigest,analysisContract:assessment.input.protocol.analysisContract}:undefined;const qualificationCurrent=!!qualified&&qualified.qualityDigest===policy.qualityDigest&&qualified.analysisContract===policy.analysisContract;
  return {envelope:actual,policy,qualificationCurrent,profileActive:profile.status==='active',sourceCurrent:!!sourceCurrent,budgetAdmitted};
 }catch{return undefined;}
 finally{db?.close();}
}
