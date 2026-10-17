import test from 'node:test';
import {createHash} from 'node:crypto';
import {spawnSync as spawnForTest} from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tasks, plan, score, strictJson, summarize, safeRead, allowedTool, metricTotals, verifyInitialTaskDirectory, verifyFrozenManifest, createFinalReplyCapture, classifyExecution, classifyWorkerExit } from '../../scripts/evals/sol-pi/baseline-core.mjs';

test('frozen plan keeps 14 cells, 3 independent repeats, 3 source clusters', () => {
 assert.equal(plan.length,42); assert.equal(new Set(plan.map(p=>p.key)).size,42);
 assert.equal(new Set(plan.map(p=>p.taskId)).size,4); assert.equal(new Set(plan.map(p=>p.cluster)).size,3);
 for (const surface of ['desktop','cli']) assert.equal(plan.filter(p=>p.surface===surface).length,12);
 for (const surface of ['desktop-child','cli-child']) assert.equal(plan.filter(p=>p.surface===surface).length,9);
});
test('strict JSON rejects duplicate keys, prose, fences and malformed inputs',()=>{
 for(const text of ['{"a":1,"a":2}','{"a":{"b":1,"b":2}}','prefix {"a":1}','```json\n{}\n```','{"a": NaN}'])assert.throws(()=>strictJson(text));
 assert.deepEqual(strictJson(' {"x":["a:b",1]} '),{x:['a:b',1]});
});
test('acceptance verifies semantics, exact schema and no false completion',()=>{
 for(const task of tasks.filter(t=>t.id!=='code')){
  const correct=JSON.stringify(task.expected);
  assert.equal(score(task.id,{readFiles:Object.keys(task.files),reply:task.id==='artifact'?'{"artifact":"answer.json"}':correct,artifact:correct,unchanged:true,execution:'resolved'}).passed,true);
  for(const bad of ['{}','完成了',JSON.stringify({...task.expected,extra:true})]){
   assert.equal(score(task.id,{readFiles:Object.keys(task.files),reply:bad,artifact:bad,unchanged:true,execution:'resolved'}).passed,false);
  }
  assert.equal(score(task.id,{readFiles:Object.keys(task.files),reply:task.id==='artifact'?'{"artifact":"answer.json"}':correct,artifact:correct,unchanged:false,execution:'resolved'}).passed,false);
  assert.equal(score(task.id,{readFiles:Object.keys(task.files),reply:task.id==='artifact'?'{"artifact":"answer.json"}':correct,artifact:correct,unchanged:true,execution:'timeout'}).passed,false);
 }
 assert.equal(score('code',{reply:'已修复并验证。',readFiles:Object.keys(tasks.find(t=>t.id==='code').files),unchanged:true,execution:'resolved',visibleVerified:false,hiddenVerified:true}).passed,false);
 assert.equal(score('code',{reply:'已修复并验证。',readFiles:Object.keys(tasks.find(t=>t.id==='code').files),unchanged:true,execution:'resolved',visibleVerified:true,hiddenVerified:false}).passed,false);
 assert.equal(score('code',{reply:'已修复并验证。',readFiles:Object.keys(tasks.find(t=>t.id==='code').files),unchanged:true,execution:'resolved',visibleVerified:true,hiddenVerified:true}).passed,true);
});
test('summary retains missing runs in denominator and requires all three',()=>{
 const summary=summarize([{...plan[0],passed:true,wallMs:10,status:'passed'}]);
 assert.equal(summary.planned,42);assert.equal(summary.passed,1);assert.equal(summary.missing,41);
 assert.equal(summary.cells.every(c=>!c.allThreePassed),true);
 assert.equal(summary.admission,'inconclusive');
});
test('artifact reads reject symlinks and oversized content; tool allowlist fails closed',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'solpi-test-')));
 try{
  await writeFile(join(root,'ok'),'{}');await symlink(join(root,'ok'),join(root,'link'));
  await assert.rejects(()=>safeRead(root,'link'));await writeFile(join(root,'large'),'x'.repeat(1024*1024+1));
  await assert.rejects(()=>safeRead(root,'large'));assert.equal(await safeRead(root,'ok'),'{}');
  const spec={root,readable:['input.json'],writable:['answer.json'],command:'exact'};
  assert.equal(allowedTool('read',{file_path:join(root,'input.json')},spec),true);
  for(const [name,input] of [['read',{file_path:'/etc/passwd'}],['write',{file_path:join(root,'input.json')}],['bash',{command:'exact; evil',workdir:root}],['bash',{command:'exact',workdir:'/'}]])assert.equal(allowedTool(name,input,spec),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('real Seatbelt code evaluator passes pure fix and rejects exit, tampering, escape and infinite loops', {skip:process.platform!=='darwin'},async()=>{
 const {sandboxEvaluate}=await import('../../scripts/evals/sol-pi/baseline-sandbox.mjs');
 const root=await realpath(await mkdtemp(join(tmpdir(),'solpi-code-')));const source=join(root,'invoice.cjs');
 try{
  await writeFile(source,'module.exports = rows => { const seen=new Set(); return rows.reduce((sum,r)=>{if(seen.has(r.id))return sum;seen.add(r.id);return sum+(r.status === "paid" ? Math.max(0,r.amount-r.discount):0)},0); };');
  assert.equal((await sandboxEvaluate(source)).verified,true);
  for(const code of ['module.exports=()=>new Uint8Array(1024*1024*1024).fill(1)[0]','const j=JSON.stringify;module.exports=rows=>{module.rows=rows;return 0};JSON.stringify=()=>j((()=>{const seen=new Set();return module.rows.reduce((s,r)=>{if(seen.has(r.id))return s;seen.add(r.id);return s+(r.status==="paid"?Math.max(0,r.amount-r.discount):0)},0)})());','module.exports=rows=>{if(rows.length===6)return 1600;const seen=new Set();return rows.reduce((s,r)=>{if(seen.has(r.id))return s;seen.add(r.id);return s+(r.status==="paid"?Math.max(0,r.amount-r.discount):0)},0)}','module.exports=()=>0','module.exports=rows=>{const seen=new Set();return rows.reduce((s,r)=>{if(seen.has(r.id))return s;seen.add(r.id);return s+(r.status!=="cancelled"?Math.max(0,r.amount-r.discount):0)},0)}','process.exit(0)','module.exports=()=>{while(true){}}','module.exports=()=>module.constructor.constructor("return process")().exit(0)']){
   await writeFile(source,code);assert.equal((await sandboxEvaluate(source)).verified,false);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('duplicate and unknown result IDs invalidate aggregation',()=>{assert.throws(()=>summarize([{...plan[0],passed:false},{...plan[0],passed:true}]));assert.throws(()=>summarize([{key:'unknown',passed:true}]));});

test('Seatbelt independently denies private reads, all writes and network even with Node APIs', {skip:process.platform!=='darwin'},async()=>{
 const {profileFor}=await import('../../scripts/evals/sol-pi/baseline-sandbox.mjs');
 const {execFileSync}=await import('node:child_process');
 const root=await realpath(await mkdtemp(join(tmpdir(),'solpi-isolation-'))),outside=await realpath(await mkdtemp(join(tmpdir(),'solpi-private-')));
 try{
  const source=join(root,'invoice.cjs'),secret=join(outside,'private.txt');await writeFile(source,'module.exports=()=>0');await writeFile(secret,'fixture-only');
  const program=`const fs=require('fs');let denied=0;for(const fn of [()=>fs.readFileSync(${JSON.stringify(secret)}),()=>fs.writeFileSync(${JSON.stringify(join(root,'bad'))},'x'),()=>fs.writeFileSync(${JSON.stringify(join(outside,'bad'))},'x')]){try{fn()}catch{denied++}};const net=require('net');const s=net.connect({host:'127.0.0.1',port:9});s.on('error',e=>{console.log(JSON.stringify({denied,networkDenied:e.code==='EPERM'||e.code==='EACCES'}));});`;
  const result=JSON.parse(execFileSync('/usr/bin/sandbox-exec',['-p',await profileFor(source),process.execPath,'-e',program],{cwd:root,env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:3000}));
  assert.deepEqual(result,{denied:3,networkDenied:true});
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('interrupted finalization refuses never-started, completed and already-closed rounds',async()=>{
 const {execFileSync}=await import('node:child_process');const {readFile}=await import('node:fs/promises');
 const root=await realpath(await mkdtemp(join(tmpdir(),'solpi-ledger-'))),runner=new URL('../../scripts/evals/sol-pi/baseline-run.mjs',import.meta.url).pathname;
 try{
  const frozen=join(root,'snapshot/scripts/evals/sol-pi');await mkdir(frozen,{recursive:true});await mkdir(join(root,'snapshot/bin'),{recursive:true});await symlink(process.execPath,join(root,'snapshot/bin/node'));await writeFile(join(frozen,'baseline-run.mjs'),await readFile(runner));await writeFile(join(frozen,'baseline-core.mjs'),await readFile(new URL('../../scripts/evals/sol-pi/baseline-core.mjs',import.meta.url)));
  const provenance={roundId:'test-round',head:'test-head',dirtyDiffSha256:'test-diff',missing:[]},files={'bin/node':'test-node','snapshot-provenance.json':'test-provenance'};await writeFile(join(root,'snapshot/snapshot-provenance.json'),JSON.stringify(provenance));await writeFile(join(root,'snapshot-files.json'),JSON.stringify(files));await writeFile(join(root,'manifest.json'),JSON.stringify({...manifestFixture(files,provenance),missing:[]}));await writeFile(join(root,'ledger.json'),JSON.stringify(Object.fromEntries(plan.map(e=>[e.key,{status:'not-run'}]))));
  const run=()=>execFileSync(process.execPath,[runner,root,'--finalize-interrupted'],{stdio:'pipe'});
  assert.throws(run);await writeFile(join(root,'started.json'),'{}');await writeFile(join(root,'finished.json'),'{}');assert.throws(run);
  await rm(join(root,'finished.json'));await writeFile(join(root,'started.json'),JSON.stringify({pid:process.pid}));assert.throws(run);await writeFile(join(root,'started.json'),JSON.stringify({pid:99999999}));await mkdir(join(root,plan[0].key));await writeFile(join(root,plan[0].key,'worker-process.json'),JSON.stringify({pid:process.pid}));assert.throws(run);await rm(join(root,plan[0].key,'worker-process.json'));const goodLedger=await readFile(join(root,'ledger.json'));await writeFile(join(root,'ledger.json'),'invalid');assert.throws(run);await assert.rejects(()=>readFile(join(root,'closed.json')));await writeFile(join(root,'finalizing.json'),JSON.stringify({pid:99999999}));const forged=JSON.parse(goodLedger);forged[plan[0].key]={...plan[0],passed:true,status:'passed',resultSha256:'a'.repeat(64)};await writeFile(join(root,'ledger.json'),JSON.stringify(forged));const {spawn}=await import('node:child_process');const concurrent=()=>new Promise(resolve=>{const child=spawn(process.execPath,[runner,root,'--finalize-interrupted'],{stdio:'ignore'});child.on('exit',resolve);});const exits=await Promise.all([concurrent(),concurrent()]);assert.equal(exits.filter(c=>c===0).length,1);const first=await readFile(join(root,'summary.json'),'utf8');assert.equal(JSON.parse(first).planned,42);assert.equal(JSON.parse(first).passed,0);
  assert.throws(run);assert.equal(await readFile(join(root,'summary.json'),'utf8'),first);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unsupported platform exits before filesystem or macOS process actions',()=>{
 const {status,stderr}=requireForTest();assert.equal(status,2);assert.match(stderr,/SOLPI_BASELINE_MACOS_ONLY/);
});
function requireForTest(){return spawnForTest(process.execPath,['--input-type=module','-e',`Object.defineProperty(process,'platform',{value:'win32'});await import(${JSON.stringify(new URL('../../scripts/evals/sol-pi/baseline-run.mjs',import.meta.url).href)});`],{encoding:'utf8'});}


test('metrics distinguish missing reports/usage and preserve individual chunks',()=>{
 assert.equal(metricTotals([undefined]).adapterRequests,null);
 const m=metricTotals([{toolCalls:1,registryReturned:0,bashObserved:0,adapterStreamCalls:2,metrics:[{complete:true,events:[{kind:'adapter_request',requestId:1,toolResultBytes:50,toolResultCount:1,unknownResults:0,surface:'cli-chat-task'},{kind:'adapter_request',requestId:2,toolResultBytes:80,toolResultCount:1,unknownResults:0,surface:'cli-chat-task'},{kind:'provider_usage',requestId:1,inputTokens:12,outputTokens:0,cacheReadTokens:null,cacheWriteTokens:null,ordinal:1},{kind:'provider_usage',requestId:1,inputTokens:18,outputTokens:5,cacheReadTokens:null,cacheWriteTokens:null,ordinal:2},{kind:'provider_end',requestId:1,status:'completed',durationMs:1},{kind:'provider_end',requestId:2,status:'completed',durationMs:1},{kind:'registry_visible',bytes:200,units:200,toolId:1,family:'read'}]}]}]);
 assert.equal(m.adapterRequests,2);assert.equal(m.requestToolBytes,130);assert.equal(m.registryVisibleBytes,200);assert.equal(m.usageMissingRequests,1);assert.equal(m.usageChunks.length,2);assert.equal(m.missingRuns,0);
 const incomplete=metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:false,events:[{kind:'adapter_request'}]}]}]);assert.equal(incomplete.requestToolBytes,null);assert.equal(incomplete.adapterRequests,null);assert.equal(incomplete.incompleteReports,1);
 const invalid=metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:true,events:[{kind:'adapter_request'}]}]}]);assert.equal(invalid.requestToolBytes,null);
 assert.equal(metricTotals([undefined,{metrics:[{complete:true,events:[]}]}]).adapterRequests,null);
});

test('Desktop baseline uses the production model-result projection',async()=>{
 const {tsImport}=await import('tsx/esm/api');
 const {projectDesktopToolResultForModel}=await tsImport(new URL('../../desktop/electron/desktop-tool-result.ts',import.meta.url).pathname,import.meta.url);
 const output='界'.repeat(50001);assert.equal(projectDesktopToolResultForModel(output).length,50000);assert.equal(projectDesktopToolResultForModel('short'),'short');
});


test('zero-read correct answer and empty complete metrics do not pass acceptance',()=>{
 assert.equal(score('qa',{readFiles:[],execution:'resolved',unchanged:true,reply:JSON.stringify(tasks.find(t=>t.id==='qa').expected)}).passed,false);
 const m=metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:true,events:[]}]}]);assert.equal(m.adapterRequests,null);assert.equal(m.requestToolBytes,null);assert.equal(m.incompleteReports,1);
});


test('initial state rejects forged metrics, result/process artifacts and altered entry',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'solpi-initial-'))),entry=plan.find(e=>e.taskId==='qa'),task=tasks.find(t=>t.id==='qa');
 try{
  await mkdir(join(root,'workspace'));await mkdir(join(root,'metrics'));await writeFile(join(root,'entry.json'),JSON.stringify(entry,null,2));
  for(const [name,content]of Object.entries(task.files))await writeFile(join(root,'workspace',name),content);
  assert.equal(await verifyInitialTaskDirectory(root,entry,task),true);
  for(const path of ['metrics/metrics-deadbeef.json','result.json','result.tmp','worker-process.json','workspace/answer.json']){await writeFile(join(root,path),'{}');assert.equal(await verifyInitialTaskDirectory(root,entry,task),false);await rm(join(root,path));}
  await writeFile(join(root,'entry.json'),JSON.stringify({...entry,surface:'forged'},null,2));assert.equal(await verifyInitialTaskDirectory(root,entry,task),false);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('invalid IDs, orphan/duplicate ends, unknown events and null events invalidate metrics',()=>{
 const request={kind:'adapter_request',requestId:1,surface:'cli-chat-task',toolResultBytes:0,toolResultCount:0,unknownResults:0},end={kind:'provider_end',requestId:1,status:'completed',durationMs:1};
 for(const events of [[{...request,requestId:null},{...end,requestId:null}],[request,end,{...end,requestId:2}],[request,end,end],[request,end,{kind:'unknown'}],[request,null,end],[end,request],[request,{...end,durationMs:null}]]){
  const m=metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:true,events}]}]);assert.equal(m.adapterRequests,null);assert.equal(m.requestToolBytes,null);assert.equal(m.incompleteReports,1);
 }
 assert.equal(metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:true,events:[request,end]}]}]).adapterRequests,1);
});


function manifestFixture(files,provenance){const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');return {...provenance,snapshotSha256:hash(files),nodeSha256:files['bin/node'],taskSpecSha256:hash(tasks),plan,runnerFiles:Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith('scripts/evals/sol-pi/baseline-'))),seed:'0x501918',limits:{maxIterations:10,workerDeadlineMs:120000,runtimeDeadlineMs:110000,repeats:3,budgetMinutes:84}};}
test('manifest is bound to snapshot identity, bytes, plan, tasks, runner and budget',()=>{
 const files={'bin/node':'node','scripts/evals/sol-pi/baseline-core.mjs':'core'},provenance={roundId:'A',head:'head',dirtyDiffSha256:'diff'},m=manifestFixture(files,provenance);
 assert.equal(verifyFrozenManifest(m,files,provenance),true);
 for(const mutation of [{publicModel:{name:'forged'}},{configFingerprintSalt:'forged'},{configFingerprint:'forged'},{missing:[]},{roundId:'B'},{head:'other'},{snapshotSha256:'other'},{nodeSha256:'other'},{plan:[]},{taskSpecSha256:'other'},{runnerFiles:{}},{limits:{...m.limits,workerDeadlineMs:1}}])assert.equal(verifyFrozenManifest({...m,...mutation},files,provenance),false);
 assert.equal(verifyFrozenManifest(m,{...files,'bin/node':'changed'},provenance),false);
});
test('hard timeouts remain in process latency; missing Runtime durations never look faster',()=>{
 const entries=plan.filter(e=>e.surface===plan[0].surface&&e.taskId===plan[0].taskId);
 const records=entries.map((e,i)=>({...e,passed:i===0,status:i===0?'passed':'timeout',wallMs:i===0?100:null,processWallMs:i===0?101:120000}));
 const cell=summarize(records).cells.find(c=>c.id===`${plan[0].surface}/${plan[0].taskId}`);
 assert.equal(cell.medianMs,null);assert.equal(cell.p95Ms,null);assert.equal(cell.runtimeMissingCount,2);assert.equal(cell.timeoutCount,2);assert.equal(cell.processP95Ms,120000);
});


for(const surface of ['cli','desktop','desktop-child'])test(`${surface} actual production loop captures final JSON after intermediate commentary`,async()=>{
 const {tsImport}=await import('tsx/esm/api');const repo=new URL('../../',import.meta.url).pathname;const source=p=>tsImport(join(repo,p),import.meta.url);
 const [{ToolRegistry},{createReadTool},{AgentRuntime},{AgentSessionState},{AgentRunController},{runDesktopToolLoop},{DesktopManagedAgentSession}]=await Promise.all([source('src/ai/tools/index.ts'),source('src/ai/tools/read.ts'),source('src/ai/runtime/agent-runtime.ts'),source('src/ai/runtime/session.ts'),source('src/ai/runtime/controller.ts'),source('desktop/electron/desktop-services.ts'),source('desktop/electron/desktop-managed-agent-session.ts')]);
 const root=await realpath(await mkdtemp(join(tmpdir(),'solpi-final-text-'))),capture=createFinalReplyCapture();await writeFile(join(root,'facts.txt'),'42');
 const registry=new ToolRegistry({autoMode:true,hooksRunner:{runPreHooks:async()=>{capture.beforeTool();return {ok:true};},runPostHooks:async()=>[],runHooks:async()=>({ok:true})}},[createReadTool({cwd:root})]);
 let calls=0;const adapter={getModelName:()=> 'regression-fixture',async *stream(){if(++calls===1){yield {type:'text',delta:'我先读取文件'};yield {type:'tool_use',id:'read-one',name:'read',input:{file_path:'facts.txt'}};}else yield {type:'text',delta:'{"answer":42}'};}};
 const signal=new AbortController().signal;let session;
 try{
  if(surface==='cli')await new AgentRuntime({adapter,registry,session:new AgentSessionState(),controller:new AgentRunController(),systemPrompt:'test',maxIterations:3}).run('read then answer',capture.onCliEvent,signal);
  else if(surface==='desktop')await runDesktopToolLoop({adapter,registry,allToolDefs:registry.getToolDefinitions(),systemPrompt:'test',messages:[{role:'user',content:[{type:'text',text:'read then answer'}]}],signal,taskDeadline:Date.now()+10000,sessionId:'s',turnId:'t',intentId:'i',stepId:'step',taskId:'task',materials:[],emitRuntimeEvent:capture.onDesktopEvent,skillInvocation:null,skillCatalog:{},dataRoot:root,taskStartTime:Date.now(),maxIterations:3,strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:m=>m,processToolResult:s=>s,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});
  else {session=new DesktopManagedAgentSession({adapter,systemPrompt:'test',forkContext:false,getTurnContext:()=>({groupId:'g',agentId:'a',turn:1,turnId:'t',cwd:root,signal,effectiveDeadline:Date.now()+10000}),createRegistry:()=>({registry,dispose:()=>{}}),dataRoot:root,materials:[],skillCatalog:{},emitRuntimeEvent:capture.onDesktopEvent,maxIterations:3});await session.run('read then answer',signal);}
  assert.equal(capture.getText(),'{"answer":42}');assert.equal(calls,2);
 }finally{await session?.dispose?.();registry.dispose();await rm(root,{recursive:true,force:true});}
});


test('late successful return is timeout and watchdog exit 124 is counted as timeout',()=>{
 assert.equal(classifyExecution(true,false,111000,110000),'timeout');assert.equal(classifyExecution(true,true,100,110000),'timeout');assert.equal(classifyExecution(true,false,100,110000),'resolved');assert.equal(classifyExecution(false,false,100,110000),'rejected');
 assert.equal(classifyWorkerExit(124,false),'timeout');assert.equal(classifyWorkerExit(null,true),'timeout');assert.equal(classifyWorkerExit(1,false),'worker-error');assert.equal(classifyWorkerExit(0,false),'completed');
});


test('code success requires a nonempty final reply as well as verified artifacts',()=>{
 const base={readFiles:Object.keys(tasks.find(t=>t.id==='code').files),unchanged:true,execution:'resolved',visibleVerified:true,hiddenVerified:true};
 for(const reply of [undefined,null,'','  \n '])assert.equal(score('code',{...base,reply}).passed,false);
 assert.equal(score('code',{...base,reply:'已修复paid过滤、去重和折扣，并通过验证。'}).passed,true);
});

test("duplicate metric stages invalidate totals",()=>{const events=[{kind:"adapter_request",requestId:1,surface:"desktop-task",toolResultBytes:0,toolResultCount:0,unknownResults:0},{kind:"registry_visible",toolId:1,family:"read",bytes:4,units:4},{kind:"provider_end",requestId:1,status:"completed",durationMs:1}];assert.equal(metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:true,events}]}]).incompleteReports,0);assert.equal(metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics:[{complete:true,events:[...events,events[1]]}]}]).incompleteReports,1);});

test("missing entire request pair is caught by independent adapter counter",()=>{const metrics=[{complete:true,events:[{kind:"adapter_request",requestId:1,surface:"desktop-task",toolResultBytes:0,toolResultCount:0,unknownResults:0},{kind:"provider_end",requestId:1,status:"completed",durationMs:1}]}];for(const adapterStreamCalls of [undefined,0,2]){const r=metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls,metrics}]);assert.equal(r.adapterRequests,null);assert.equal(r.requestToolBytes,null);assert.equal(r.requestCountMismatchRuns,1);}assert.equal(metricTotals([{toolCalls:0,registryReturned:0,bashObserved:0,adapterStreamCalls:1,metrics}]).adapterRequests,1);});

test("independent tool counters reject missing stage observations",()=>{const metrics=[{complete:true,events:[{kind:"adapter_request",requestId:1,surface:"desktop-task",toolResultBytes:0,toolResultCount:0,unknownResults:0},{kind:"provider_end",requestId:1,status:"completed",durationMs:1}]}];for(const counters of [{toolCalls:3,registryReturned:3,bashObserved:0},{toolCalls:0,registryReturned:0,bashObserved:1}]){const r=metricTotals([{...counters,adapterStreamCalls:1,metrics}]);assert.equal(r.registryVisibleBytes,null);assert.equal(r.historyBytes,null);assert.equal(r.collectorBytes,null);assert.equal(r.toolCountMismatchRuns,1);}});
