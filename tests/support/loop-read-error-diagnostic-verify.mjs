import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyTranscript,HEALTH_PREFIX,LOADER_PREFIX} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-core.mjs';
import {TARGETS} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-loader.mjs';

const STEP='Test complete signed Loop controller paths and cleanup with temporary diagnostic';
const GUARD='Verify temporary Loop diagnostic guards';
const MODES=['terminal','lost-dispatch','publication-lost-ack','full-projection','desktop-service','timed-pending','timed-expired','output-consumer'];
/** Observation quality is separate from the original step's business result.
 * The supplied API response must be preserved and independently source-bound. */
export function verifyObservation(raw,job,head){
 const text=raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''),health=verifyTranscript(text),problems=[...health.problems];
 const lines=text.split(/\r?\n/),loader=[],finallyRows=[];let healthAt=-1;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],at=line.indexOf(LOADER_PREFIX),stage=line.indexOf('[loop-controller-stage] ');
  if(line.includes(HEALTH_PREFIX))healthAt=i;
  if(at>=0){try{loader.push(JSON.parse(line.slice(at+LOADER_PREFIX.length)));}catch{problems.push('loader_json');}}
  if(stage>=0){try{const value=JSON.parse(line.slice(stage+'[loop-controller-stage] '.length));if(value?.stage==='scenario-finally-complete')finallyRows.push({mode:value.mode,index:i});}catch{problems.push('stage_json');}}
 }
 if(loader.length!==3)problems.push('loader_count');
 for(const target of TARGETS){
  const rows=loader.filter(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&v.site===target.site);
  if(rows.some(v=>Object.keys(v).sort().join(',')!=='recorderModuleIdSha256,schemaVersion,site,sourceSha256,transformedSha256'))problems.push('loader_schema');
  if(rows.length!==1||rows[0].schemaVersion!==1||rows[0].sourceSha256!==target.sha256||!/^[a-f0-9]{64}$/.test(rows[0].transformedSha256)||rows[0].transformedSha256===target.sha256||rows[0].recorderModuleIdSha256!==health.receipt?.recorderModuleIdSha256)problems.push('loader_binding');
 }
 if(finallyRows.length!==8||MODES.some(mode=>finallyRows.filter(v=>v.mode===mode&&v.index<healthAt).length!==1))problems.push('original_finally_incomplete');
 const fileSummaries=lines.filter(line=>/\bTest Files\s+/.test(line));
 if(fileSummaries.length!==1||!fileSummaries[0].includes('(1)')||!/1 (passed|failed)/.test(fileSummaries[0])||/skipped|todo|filtered/.test(fileSummaries[0]))problems.push('original_file_population');
 let summaryFailed=null;
 const summaries=lines.filter(line=>/\bTests\s+/.test(line));
 if(summaries.length!==1)problems.push('original_summary_count');
 else{
  const summary=summaries[0],passed=Number(summary.match(/(\d+) passed/)?.[1]??0),failed=Number(summary.match(/(\d+) failed/)?.[1]??0);
  summaryFailed=failed;
  if(passed+failed!==8||!summary.includes('(8)')||/skipped|todo|filtered/.test(summary))problems.push('original_population');
 }
 if(/Hook timed out|hook timed out|Unhandled Errors|Unhandled Rejection|Uncaught Exception|Test timed out/.test(text))problems.push('hook_outer_or_unhandled');
 if(!Number.isSafeInteger(job?.id)||job.id<=0)problems.push('job_identity');
 if(!/^[a-f0-9]{40}$/.test(head??'')||job?.head_sha!==head||job?.status!=='completed'||!['success','failure'].includes(job?.conclusion)||job?.run_attempt!==1)problems.push('terminal_job_binding');
 const allSteps=Array.isArray(job?.steps)?job.steps:[];
 const guards=allSteps.filter(v=>v?.name===GUARD);
 if(guards.length!==1||guards[0].status!=='completed'||guards[0].conclusion!=='success')problems.push('diagnostic_guard_terminal');
 const steps=allSteps.filter(v=>v?.name===STEP);
 if(steps.length!==1||steps[0].status!=='completed'||!['success','failure'].includes(steps[0].conclusion))problems.push('original_step_terminal');
 if(steps.length===1&&summaryFailed!==null&&((summaryFailed>0)!==(steps[0].conclusion==='failure')||(job?.conclusion==='success'&&steps[0].conclusion!=='success')))problems.push('raw_api_conclusion_mismatch');
 return {schemaVersion:1,scope:'instrumented-observation-only',codeHead:head,jobId:job?.id,normalQualified:false,
  originalBusinessConclusion:steps[0]?.conclusion??'unknown',observationComplete:problems.length===0,problems,health};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [log,api,head,out]=process.argv.slice(2);
 const result=verifyObservation(readFileSync(log,'utf8'),JSON.parse(readFileSync(api,'utf8')),head);
 const encoded=JSON.stringify(result,null,2)+'\n';if(out)writeFileSync(out,encoded);else process.stdout.write(encoded);
 if(!result.observationComplete)process.exitCode=1;
}
