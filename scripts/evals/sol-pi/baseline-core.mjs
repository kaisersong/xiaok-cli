import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const orders = [
 {id:'A1',status:'paid',amount:1200,discount:100},
 {id:'B2',status:'cancelled',amount:9000,discount:0},
 {id:'A1',status:'paid',amount:1200,discount:100},
 {id:'C3',status:'paid',amount:599,discount:99},
 {id:'D4',status:'pending',amount:700,discount:0},
 {id:'E5',status:'paid',amount:200,discount:300},
];
const rules='金额单位为整数分。仅 paid 单有效；先按原始输入顺序对所有记录按 id 去重，保留第一次，然后过滤 paid；每单净额 max(0, amount-discount)，相加。有效单号按字典序输出。';
export const tasks = [
 {id:'qa',cluster:'invoices',files:{'orders.json':JSON.stringify(orders),'rules.txt':rules,'context.txt':'本次账期为2026-09；pending不是paid。'},prompt:'读取 orders.json、rules.txt、context.txt。只回复严格JSON，字段 netCents、ids、period；不要代码围栏或解释。',expected:{netCents:1600,ids:['A1','C3','E5'],period:'2026-09'}},
 {id:'code',cluster:'invoices',files:{'orders.json':JSON.stringify(orders),'invoice.cjs':'module.exports = rows => rows.reduce((sum, r) => sum + r.amount, 0);\n','rules.txt':rules+' 导出同步纯函数 module.exports = rows => 整数净额。不依赖Node API/外部状态。'},prompt:'按 rules.txt 修复 invoice.cjs 导出的净额纯函数，并执行提供的验证命令。只能修改 invoice.cjs，最终回复简短说明，不能为空。'},
 {id:'log',cluster:'batch-log',files:{'job.log':Array.from({length:6500},(_,i)=>i===30?'000030 WARN cache reconnect recovered=true':i===6021?'006021 ERROR job=nightly-42 code=E_SCHEMA rootCause=missing_customer_id source=customers.csv row=481':`${String(i).padStart(6,'0')} INFO job=nightly-42 stage=scan scanned=${i} status=ok padding=abcdefghij`).join('\n'),'brief.txt':'真正失败位于日志后部，前面的缓存重连已恢复；找最终ERROR，不要把早期WARN当根因。'},prompt:'诊断 job.log，参考 brief.txt。只回复严格JSON，字段 job、error、rootCause、exactEvidence，exactEvidence为完整原始错误行。',expected:{job:'nightly-42',error:'E_SCHEMA',rootCause:'missing_customer_id',exactEvidence:'006021 ERROR job=nightly-42 code=E_SCHEMA rootCause=missing_customer_id source=customers.csv row=481'}},
 {id:'artifact',cluster:'warehouse-handoff',files:{'stock.json':JSON.stringify([{sku:'P',warehouse:'east',available:12},{sku:'Q',warehouse:'west',available:9},{sku:'P',warehouse:'west',available:8},{sku:'Q',warehouse:'east',available:0}]),'request.txt':'汇总各sku所有仓库available，不去重。生成 answer.json，严格结构 {"totals":{"P":整数,"Q":整数},"source":"stock.json"}。最终只回复 {"artifact":"answer.json"}。'},prompt:'读取 stock.json、request.txt，完成库存汇总和交接。',expected:{totals:{P:20,Q:9},source:'stock.json'}},
];
export const plan=[];
// Balanced interleaving across repeats, immutable before any run; no A/B claims.
for(let repeat=1;repeat<=3;repeat++)for(const surface of ['desktop','desktop-child','cli','cli-child'])for(const task of tasks){
 if(surface.endsWith('child')&&task.id==='code')continue;
 plan.push({key:`${surface}-${task.id}-${repeat}`,surface,taskId:task.id,cluster:task.cluster,repeat});
}
// Fixed seeded Fisher-Yates schedule; randomized once before all outcomes.
let seed=0x501918;
for(let i=plan.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[plan[i],plan[j]]=[plan[j],plan[i]];}
export function strictJson(text){
 // Parse the whole document, retaining duplicate-key detection at every nesting level.
 const tokens=text.match(/"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]|\s+|./gs)?.filter(t=>!/^\s+$/.test(t))??[];
 let i=0;
 function value(){const t=tokens[i++];if(t==='{'){const keys=new Set();if(tokens[i]==='}'){i++;return;}for(;;){const k=tokens[i++];if(!k?.startsWith('"'))throw Error('key');const key=JSON.parse(k);if(keys.has(key))throw Error('duplicate');keys.add(key);if(tokens[i++]!==':')throw Error('colon');value();const sep=tokens[i++];if(sep==='}')return;if(sep!==',')throw Error('object');}}else if(t==='['){if(tokens[i]===']'){i++;return;}for(;;){value();const sep=tokens[i++];if(sep===']')return;if(sep!==',')throw Error('array');}}else if(t===undefined||!(/^(?:"|-?\d|true$|false$|null$)/.test(t)))throw Error('value');}
 value();if(i!==tokens.length)throw Error('trailing');return JSON.parse(text);
}
export function score(taskId,input){
 const reasons=[];if(input.execution!=='resolved')reasons.push('execution-not-resolved');if(!input.unchanged)reasons.push('immutable-input-changed');
 const task=tasks.find(t=>t.id===taskId);
 if(Object.keys(task.files).some(name=>!input.readFiles?.includes(name)))reasons.push('required-material-not-read');
 try{
  if(taskId==='code'){if(typeof input.reply!=='string'||!input.reply.trim())reasons.push('final-reply-missing');if(!input.visibleVerified)reasons.push('visible-verification-missing');if(!input.hiddenVerified)reasons.push('hidden-vectors-failed');}
  else if(taskId==='artifact'){
   if(!isDeepStrictEqual(strictJson(input.artifact),task.expected))reasons.push('artifact-semantics');
   if(!isDeepStrictEqual(strictJson(input.reply),{artifact:'answer.json'}))reasons.push('handoff');
  }else if(!isDeepStrictEqual(strictJson(input.reply),task.expected))reasons.push('answer-semantics');
 }catch{reasons.push('invalid-json');}
 return {passed:reasons.length===0,reasons};
}
export async function safeRead(root,name){
 const path=resolve(root,name),rel=relative(root,path);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('outside');
 const stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||await fs.realpath(path)!==path)throw Error('unsafe-file');
 const h=await fs.open(path,'r');try{const s=await h.stat();if(s.ino!==stat.ino||s.dev!==stat.dev)throw Error('replaced');return await h.readFile('utf8');}finally{await h.close();}
}
export function allowedTool(name,input,spec){
 if(name==='bash')return Boolean(spec.command)&&input.command===spec.command&&input.workdir==='.';
 if(!['read','write','edit'].includes(name)||typeof input.file_path!=='string')return false;
 const paths=name==='read'?spec.readable:spec.writable;
 return paths.some(p=>resolve(spec.root,p)===resolve(spec.root,input.file_path));
}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
export function validMetricReport(report){
 if(report?.complete!==true||!Array.isArray(report.events))return false;
 const integer=n=>Number.isSafeInteger(n)&&n>=0,positive=n=>integer(n)&&n>0,nonnegative=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const observations=new Set(),requests=new Map(),families=['bash','read','edit','write','other'];
 for(const e of report.events){
  if(!e||typeof e!=='object'||Array.isArray(e))return false;
  if(['registry_visible','registry_return','history_result','collector'].includes(e.kind)){const key=`${e.kind}/${e.toolId}`;if(observations.has(key))return false;observations.add(key);}
  if(['adapter_request','provider_usage','provider_end'].includes(e.kind)){
   if(!positive(e.requestId))return false;
   if(e.kind==='adapter_request'){
    if(requests.has(e.requestId)||!['desktop-task','cli-chat-task','cli-subagent','cli-compaction','stateless-fresh-side-call','other'].includes(e.surface)||!integer(e.toolResultBytes)||!integer(e.toolResultCount)||e.unknownResults!==0)return false;
    requests.set(e.requestId,{ended:false,usage:0});
   }else{
    const request=requests.get(e.requestId);if(!request||request.ended)return false;
    if(e.kind==='provider_end'){if(!['completed','rejected','closed'].includes(e.status)||!nonnegative(e.durationMs))return false;request.ended=true;}
    else{if(e.ordinal!==request.usage+1||!['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].every(k=>e[k]===null||integer(e[k])))return false;request.usage++;}
   }
  }else if(['registry_visible','registry_return','history_result'].includes(e.kind)){
   if(!positive(e.toolId)||!families.includes(e.family)||!integer(e.bytes)||!integer(e.units))return false;
  }else if(e.kind==='collector'){
   if(!positive(e.toolId)||e.family!=='bash'||!integer(e.bytes)||!integer(e.chunks)||!nonnegative(e.durationMs)||!['terminalExited','interrupted','complete'].every(k=>typeof e[k]==='boolean'))return false;
  }else return false;
 }
 return requests.size>0&&[...requests.values()].every(r=>r.ended);
}
export function metricTotals(runs){
 const reports=runs.flatMap(r=>Array.isArray(r?.metrics)?r.metrics:[]),events=reports.flatMap(r=>Array.isArray(r?.events)?r.events:[]).filter(e=>e&&typeof e==='object'&&!Array.isArray(e)),missingRuns=runs.filter(r=>!Array.isArray(r?.metrics)||r.metrics.length===0).length,incompleteReports=reports.filter(r=>!validMetricReport(r)).length;
 const requestCountMismatchRuns=runs.filter(r=>!Number.isSafeInteger(r?.adapterStreamCalls)||r.adapterStreamCalls<0||r.adapterStreamCalls!==(r.metrics??[]).flatMap(m=>Array.isArray(m.events)?m.events:[]).filter(e=>e?.kind==='adapter_request').length).length;
 const toolCountMismatchRuns=runs.filter(r=>{const es=(r?.metrics??[]).flatMap(m=>Array.isArray(m.events)?m.events:[]);return [['registry_visible',r?.toolCalls],['registry_return',r?.registryReturned],['history_result',r?.registryReturned],['collector',r?.bashObserved]].some(([kind,n])=>!Number.isSafeInteger(n)||n<0||es.filter(e=>e?.kind===kind).length!==n);}).length;
 const complete=reports.length>0&&missingRuns===0&&incompleteReports===0&&requestCountMismatchRuns===0&&toolCountMismatchRuns===0;
 const sum=(kind,key)=>{const selected=events.filter(e=>e.kind===kind);return complete&&selected.every(e=>Number.isFinite(e[key])&&e[key]>=0)?selected.reduce((n,e)=>n+e[key],0):null;};
 const usageMissingRequests=complete?reports.reduce((n,r)=>n+r.events.filter(e=>e.kind==='adapter_request'&&!r.events.some(u=>u.kind==='provider_usage'&&u.requestId===e.requestId&&Number.isFinite(u.inputTokens)&&Number.isFinite(u.outputTokens))).length,0):null;
 return {adapterRequests:complete?events.filter(e=>e.kind==='adapter_request').length:null,observedAdapterRequests:events.filter(e=>e.kind==='adapter_request').length,requestToolBytes:sum('adapter_request','toolResultBytes'),registryVisibleBytes:sum('registry_visible','bytes'),registryReturnBytes:sum('registry_return','bytes'),historyBytes:sum('history_result','bytes'),collectorBytes:sum('collector','bytes'),usageMissingRequests,requestCountMismatchRuns,toolCountMismatchRuns,usageChunks:events.filter(e=>e.kind==='provider_usage'),missingRuns,incompleteReports};
}
export function summarize(records){
 const known=new Set(plan.map(p=>p.key));
 const keys=records.map(r=>r.key);if(keys.some(k=>!known.has(k))||new Set(keys).size!==keys.length)throw Error('invalid-ledger');
 const byKey=new Map(records.map(r=>[r.key,r]));const cells=[];
 for(const entry of plan){const id=`${entry.surface}/${entry.taskId}`;if(cells.some(c=>c.id===id))continue;
  const planned=plan.filter(p=>p.surface===entry.surface&&p.taskId===entry.taskId),runs=planned.map(p=>byKey.get(p.key)),times=runs.map(r=>r?.wallMs).filter(Number.isFinite);
  cells.push({id,metrics:metricTotals(runs),passed:runs.filter(r=>r?.passed).length,planned:3,allThreePassed:runs.every(r=>r?.passed===true),wallMs:times,medianMs:times.length===3?percentile(times,.5):null,p95Ms:times.length===3?percentile(times,.95):null,runtimeMissingCount:3-times.length,timeoutCount:runs.filter(r=>r?.status==='timeout'||r?.execution==='timeout').length,processWallMs:runs.map(r=>r?.processWallMs).filter(Number.isFinite),processMedianMs:runs.every(r=>Number.isFinite(r?.processWallMs))?percentile(runs.map(r=>r.processWallMs),.5):null,processP95Ms:runs.every(r=>Number.isFinite(r?.processWallMs))?percentile(runs.map(r=>r.processWallMs),.95):null,statuses:runs.map(r=>r?.status??'not-run')});
 }
 return {admission:'inconclusive',planned:plan.length,passed:plan.filter(p=>byKey.get(p.key)?.passed).length,missing:plan.filter(p=>!byKey.has(p.key)).length,sourceClusters:3,cells};
}


export async function verifyInitialTaskDirectory(dir,entry,task){
 try{
  const names=await fs.readdir(dir);
  if(names.length!==3||names.some(n=>!['entry.json','workspace','metrics'].includes(n)))return false;
  const serialized=JSON.stringify(entry,null,2),entryPath=join(dir,'entry.json'),entryStat=await fs.lstat(entryPath);
  if(!entryStat.isFile()||entryStat.isSymbolicLink()||entryStat.size!==Buffer.byteLength(serialized)||await fs.readFile(entryPath,'utf8')!==serialized)return false;
  for(const name of ['workspace','metrics']){const path=join(dir,name),stat=await fs.lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(path)!==path)return false;}
  if((await fs.readdir(join(dir,'metrics'))).length!==0)return false;
  const files=Object.entries(task.files),actual=await fs.readdir(join(dir,'workspace'));
  if(actual.length!==files.length)return false;
  for(const [name,content]of files){const path=join(dir,'workspace',name),stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==Buffer.byteLength(content)||await fs.readFile(path,'utf8')!==content)return false;}
  return true;
 }catch{return false;}
}


export function verifyFrozenManifest(manifest,files,provenance){
 const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const runnerFiles=Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith('scripts/evals/sol-pi/baseline-')));
 return ['publicModel','configFingerprintSalt','configFingerprint','missing'].every(k=>isDeepStrictEqual(manifest[k],provenance[k]))&&manifest.snapshotSha256===hash(files)&&manifest.nodeSha256===files['bin/node']&&manifest.taskSpecSha256===hash(tasks)&&isDeepStrictEqual(manifest.plan,plan)&&isDeepStrictEqual(manifest.runnerFiles,runnerFiles)&&manifest.seed==='0x501918'&&['roundId','head','dirtyDiffSha256'].every(k=>typeof provenance[k]==='string'&&manifest[k]===provenance[k])&&isDeepStrictEqual(manifest.limits,{maxIterations:10,workerDeadlineMs:120000,runtimeDeadlineMs:110000,repeats:3,budgetMinutes:84});
}


export function createFinalReplyCapture(){
 let text='';
 return {beforeTool:()=>{text='';},onCliEvent:event=>{if(event.type==='assistant_text')text+=event.delta;else if(event.type==='tool_started')text='';},onDesktopEvent:async event=>{if(event.type==='assistant_delta')text+=event.delta;},getText:()=>text};
}


export function classifyExecution(resolved,aborted,nowMs,deadlineMs){return aborted||nowMs>=deadlineMs?'timeout':resolved?'resolved':'rejected';}
export function classifyWorkerExit(code,timedOut){return timedOut||code===124?'timeout':code===0?'completed':'worker-error';}
