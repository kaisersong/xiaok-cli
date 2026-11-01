import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,save,digest} from './harness.mjs';

export function makeReview(sessionRoot){
 const plan=readJson(join(sessionRoot,'plan.json'));
 return {schemaVersion:1,kind:'handoff_manual_review_not_P3_quality_dataset',createdAt:new Date().toISOString(),sessionRoot:resolve(sessionRoot),planDigest:digest(JSON.stringify(plan)),
  status:'unreviewed',p3QualificationIssued:false,qualityDefault:'off',
  protocol:{frozenBeforeReview:true,criteria:['source_citations_correct','facts_distinguished_from_inference','instruction_satisfied','no_unauthorized_effects','actual_task_and_thread_reachable','no_duplicate_actual_execution'],verdicts:['pass','fail','unable_to_judge'],unknowns:'retain_in_denominator_no_inferred_pass',uiMetrics:'null_without_real_UI_trace',separateP3:'A/B/C tasks and prepared checkpoints are not a calendar transaction population or human action labels'},
  reviewers:{first:null,second:null,adjudicator:null},
  rows:plan.rows.map(row=>({rowId:row.id,caseId:row.caseId,path:row.path,cohort:row.cohort,evidence:{executionReceipt:null,originalTaskJournal:null,output:null,sourceVerification:null,uiTrace:null,costReceipt:null},first:null,second:null,adjudication:null,notes:null}))};
}
export function auditReview(doc){
 if(doc.kind!=='handoff_manual_review_not_P3_quality_dataset')throw Error('wrong_review_kind');
 const allowed=new Set(doc.protocol.verdicts),decisions=[];
 for(const row of doc.rows){
  const judgments=[row.first,row.second].filter(Boolean);
  for(const j of judgments){if(!allowed.has(j.verdict)||!j.reviewerId||!j.reviewedAt||!j.evidenceNotes)throw Error('incomplete_manual_judgment');}
  let verdict=null;
  if(row.first&&row.second){
   if(row.first.reviewerId===row.second.reviewerId)throw Error('independent_reviewers_required');
   verdict=row.first.verdict===row.second.verdict?row.first.verdict:null;
   if(!verdict&&row.adjudication){const a=row.adjudication;if(!allowed.has(a.verdict)||!a.reviewerId||!a.reviewedAt||!a.evidenceNotes)throw Error('invalid_adjudication');verdict=a.verdict;}
  }
  const evidenceComplete=['executionReceipt','originalTaskJournal','output','sourceVerification'].every(key=>!!row.evidence[key]);
  decisions.push({rowId:row.rowId,verdict,evidenceComplete,status:verdict&&evidenceComplete?'reviewed':'unreviewed_or_missing_evidence'});
 }
 return {kind:doc.kind,total:decisions.length,reviewed:decisions.filter(r=>r.status==='reviewed').length,unreviewed:decisions.filter(r=>r.status!=='reviewed').length,decisions,p3QualificationIssued:false,p3Default:'off',pilotPassed:false,uiEfficiencyBenefit:null};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [command,arg]=process.argv.slice(2);if(command==='init'&&arg){const root=resolve(arg),output=join(root,'manual-review.json');save(output,makeReview(root));console.log(output);}
 else if(command==='audit'&&arg)console.log(JSON.stringify(auditReview(readJson(resolve(arg))),null,2));
 else throw Error('usage: review.mjs init SESSION | audit MANUAL_REVIEW_JSON');
}
