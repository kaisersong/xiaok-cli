import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
import { createSingleRequestHttpsFetch } from './single-request-https.js';

// Reviewed English/USD document, fetched 2026-09-19. Fail closed on changes,
// including pricing notes, model order and currencies; no numeric HTML guessing.
const articleDigest = '2182441dcbc23a5d030b185b717ac8d636034ba3459479b22906dbc8eac9f6bf';
const destination = 'https://api-docs.deepseek.com/quick_start/pricing/';
export interface SemanticPriceBinding {
 operationId:string; serializedBody:string; model:string; priceRevision:string;
 inputTokenUpperBound:number; outputTokenUpperBound:number; expiresAt:number;
}
export interface SemanticPriceQualification {readonly opaqueSemanticPriceQualification:never}
const qualifications=new WeakMap<object,{digest:string;until:number;started:number}>();
const digest=(binding:SemanticPriceBinding)=>createHash('sha256').update(JSON.stringify([
 binding.operationId,binding.serializedBody,binding.model,binding.priceRevision,
 binding.inputTokenUpperBound,binding.outputTokenUpperBound,binding.expiresAt,
])).digest('hex');
const unavailable=()=>Error('SEMANTIC_PRICE_UNAVAILABLE');
export function assertSemanticPriceQualification(value:SemanticPriceQualification,binding:SemanticPriceBinding):void{
 const record=qualifications.get(value),now=Date.now();
 if(!record||record.digest!==digest(binding)||now>=record.until||performance.now()-record.started>=60000)throw unavailable();
}
/** Public fixed-origin GET: no credentials, caller headers, redirects, proxy or body. */
export function semanticPriceEvidenceRevision(value:SemanticPriceQualification,binding:SemanticPriceBinding):string{
 assertSemanticPriceQualification(value,binding);
 return createHash('sha256').update(JSON.stringify([binding.priceRevision,articleDigest])).digest('hex');
}
export async function qualifySemanticPrice(binding:SemanticPriceBinding,lease:SessionExecutionLease,signal?:AbortSignal):Promise<SemanticPriceQualification>{
 lease.assertCurrent();signal?.throwIfAborted();
 const started=performance.now(),now=Date.now();
 // Both peak and off-peak are bounded, but also expire at every documented hour
 // boundary to avoid carrying an authorization into another pricing period.
 const until=Math.min(now+60000,(Math.floor(now/3600000)+1)*3600000,binding.expiresAt);
 const fetch=createSingleRequestHttpsFetch({destination,method:'GET',expectedBody:'',timeoutMs:10000,
  maxResponseBytes:256*1024,signal,trackPhysicalDrain:work=>{lease.trackInFlight(work);}});
 const response=await fetch(destination,{method:'GET',headers:{accept:'text/html'}});
 if(response.status!==200||!response.headers.get('content-type')?.startsWith('text/html')){
  await response.body?.cancel();throw unavailable();
 }
 const html=await response.text();
 const articles=[...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)];
 if(articles.length!==1||createHash('sha256').update(articles[0][1]).digest('hex')!==articleDigest
  ||binding.model!=='deepseek-flash')throw unavailable();
 const qualification=Object.freeze(Object.create(null)) as SemanticPriceQualification;
 qualifications.set(qualification,{digest:digest(binding),until,started});
 assertSemanticPriceQualification(qualification,binding);return qualification;
}
