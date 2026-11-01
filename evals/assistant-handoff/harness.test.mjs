import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {makePlan,prepare,summarize,readJson,digest} from './harness.mjs';
import {attachMainHarness} from './main-harness.mjs';
import {makeReview,auditReview} from './review.mjs';
import {captureProviderResponse} from './provider-capture.mjs';

test('freeze 10 matched triplets and 20 additional admissions; no inferred observations',()=>{
 const plan=makePlan();assert.equal(plan.rows.length,50);assert.equal(new Set(plan.rows.map(r=>r.id)).size,50);
 for(const caseId of new Set(plan.rows.map(r=>r.caseId))){const triplet=plan.rows.filter(r=>r.caseId===caseId&&r.cohort==='abc');assert.deepEqual(triplet.map(r=>r.path),['A','B','C']);assert.equal(new Set(triplet.map(r=>r.instructionDigest)).size,1);}
 assert.equal(plan.rows.filter(r=>r.cohort==='handoff').length,20);
 assert(plan.rows.every(r=>r.status==='not_run'));
});
test('private snapshot has original file hashes and empty evidence stays unmeasured',()=>{
 const parent=mkdtempSync(join(tmpdir(),'handoff-unit-'));try{const root=prepare(parent),manifest=readJson(join(root,'source-manifest.json'));
 assert.equal(manifest.length,10);for(const item of manifest)assert.equal(digest(readFileSync(join(root,'workspace',item.path))),item.sha256);
 const report=summarize(root);assert.equal(report.notRun,50);assert.equal(report.realCompletedReviewed,0);assert.equal(report.uiEfficiencyBenefit,null);
 assert.equal(readJson(join(root,'session.json')).credentialsCopied,false);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('missing real read-only owner blocks before constructing services or launching anything',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'handoff-denial-'));try{const root=prepare(parent);
 await assert.rejects(attachMainHarness({sessionRoot:root}),/foreground_readonly_ceiling_missing/);
 const events=readFileSync(join(root,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert(events.some(e=>e.type==='blocked'&&e.modelCalls===0));assert(!events.some(e=>e.type==='admission_started'));
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('manual review initializes no labels and cannot convert missing evidence to reviewed',()=>{
 const parent=mkdtempSync(join(tmpdir(),'handoff-review-'));try{const root=prepare(parent),doc=makeReview(root),empty=auditReview(doc);
 assert.equal(empty.reviewed,0);assert.equal(empty.unreviewed,50);assert.equal(empty.p3Default,'off');assert(doc.rows.every(r=>r.first===null&&r.second===null));
 doc.rows[0].first={reviewerId:'human-one',reviewedAt:'2026-11-01',verdict:'pass',evidenceNotes:'synthetic validation only'};
 doc.rows[0].second={...doc.rows[0].first,reviewerId:'human-two'};
 assert.equal(auditReview(doc).reviewed,0);
 doc.rows[0].second.reviewerId='human-one';assert.throws(()=>auditReview(doc),/independent_reviewers_required/);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('transport evidence preserves partial SSE and never invents usage after a stream error',async()=>{
 const parent=mkdtempSync(join(tmpdir(),'handoff-capture-'));try{
  let read=0;const response={clone:()=>({body:new ReadableStream({pull(controller){if(read++===0)controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));else controller.error(Error('synthetic_transport_abort'));}})})};
  const file=join(parent,'partial.sse'),result=await captureProviderResponse(response,{file});assert.equal(result.capture,'incomplete');assert.equal(result.usage,null);assert.match(readFileSync(file,'utf8'),/partial/);
  const full=await captureProviderResponse(new Response('data: {"usage":{"prompt_tokens":11,"completion_tokens":2},"choices":[{"finish_reason":"stop"}]}\n\n'),{file:join(parent,'full.sse')});assert.equal(full.capture,'complete');assert.deepEqual(full.usage,{prompt_tokens:11,completion_tokens:2});
 }finally{rmSync(parent,{recursive:true,force:true});}
});
