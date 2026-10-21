#!/usr/bin/env node
import fs from 'node:fs/promises';
import { constants, writeFileSync } from 'node:fs';
import { resolve, join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
if(process.platform!=='darwin'){console.error('SOLPI_BASELINE_MACOS_ONLY: no tasks executed');process.exit(2);}
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
let output=resolve(process.argv[2]??'');
if(process.argv.includes('--execute-prepared')||process.argv.includes('--finalize-interrupted'))output=await fs.realpath(output);
if(!process.argv[2])throw Error('usage: node baseline-run.mjs <new-output-dir> [--prepare-only]');
const sha=data=>createHash('sha256').update(data).digest('hex');
if(process.argv.includes('--execute-prepared')||process.argv.includes('--finalize-interrupted')){
 const frozenRunner=join(output,'snapshot/scripts/evals/sol-pi/baseline-run.mjs');
 if(await fs.realpath(fileURLToPath(import.meta.url))!==frozenRunner){
  const child=spawnSync(join(output,'snapshot/bin/node'),[frozenRunner,output,process.argv.includes('--execute-prepared')?'--execute-prepared':'--finalize-interrupted'],{cwd:join(output,'snapshot'),env:process.env,stdio:'inherit'});
  process.exit(child.status??1);
 }
}

if(process.argv.includes('--finalize-interrupted')){
 process.umask(0o077);
 const child=spawnSync('/usr/bin/lockf',['-k','-t','0',join(output,'finalizing.lock'),process.execPath,fileURLToPath(import.meta.url),output,'--finalize-locked'],{stdio:'inherit'});process.exit(child.status??1);
}
const {tasks,plan,summarize,verifyInitialTaskDirectory,strictJson,safeRead,verifyFrozenManifest,classifyWorkerExit}=await import(new URL('./baseline-core.mjs',import.meta.url));
async function json(path,data){const tmp=path+'.tmp';await fs.writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});await fs.rename(tmp,path);}
async function tree(root,entries={},prefix=''){
 for(const d of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=join(root,d.name),key=prefix+d.name;
  if(d.isDirectory())await tree(path,entries,key+'/');
  else if(d.isFile())entries[key]=sha(await fs.readFile(path));
  else throw Error('snapshot contains non-regular file: '+key);
 }
 return entries;
}
async function readonly(root){for(const d of await fs.readdir(root,{withFileTypes:true})){const p=join(root,d.name);if(d.isDirectory())await readonly(p);else{const s=await fs.stat(p);await fs.chmod(p,(s.mode&0o111)?0o555:0o444);}}await fs.chmod(root,0o555);}
async function report(manifest,records,integrity){
 const summary=summarize(records);summary.integrity=integrity;
 await json(join(output,'summary.json'),{...summary,records,knownMissing:manifest.missing});
 const lines=['# SoL-Pi 基础 eval 实测', '',`计划 ${summary.planned} 次；通过 ${summary.passed}；未记录 ${summary.missing}。完整三次通过桶 ${summary.cells.filter(c=>c.allThreePassed).length}/14。`, '',`快照一致性：${integrity}。来源簇：3；作者可见工程任务，非独立holdout，admission: inconclusive。`, '', '| 入口/任务 | 通过 | 进程中位 ms | 进程 P95 ms | Runtime缺失 / 超时 | 状态 |','|---|---:|---:|---:|---:|---|',...summary.cells.map(c=>`| ${c.id} | ${c.passed}/3 | ${c.processMedianMs?.toFixed(1)??'—'} | ${c.processP95Ms?.toFixed(1)??'—'} | ${c.runtimeMissingCount} / ${c.timeoutCount} | ${c.statuses.join(', ')} |`),'','主表使用包含失败/硬超时的processWallMs；任何一个样本缺失时不输出整桶分位数。Runtime分位数同样要求3个观测齐全，缺失/超时另列。P95 每桶仅3次，是描述值，不能推断稳定尾延迟。wallMs计实际Runtime执行及指标收尾，不含进程导入、材料准备、独立评分、快照校验。每条另记processWallMs，包含进程启动与独立评分。','','## 采集指标（按桶累计；非wire账单）','','| 桶 | adapter调用 | 请求中工具结果 bytes | registry cap前 / 返回 / history bytes | usage缺失请求 | 指标缺失任务 / 不完整报告 / 请求计数不符 / 工具计数不符 |','|---|---:|---:|---|---:|---:|',...summary.cells.map(c=>`| ${c.id} | ${c.metrics.adapterRequests??'—'} | ${c.metrics.requestToolBytes??'—'} | ${c.metrics.registryVisibleBytes??'—'} / ${c.metrics.registryReturnBytes??'—'} / ${c.metrics.historyBytes??'—'} | ${c.metrics.usageMissingRequests??'—'} | ${c.metrics.missingRuns} / ${c.metrics.incompleteReports} / ${c.metrics.requestCountMismatchRuns} / ${c.metrics.toolCountMismatchRuns} |`),'','usage仅保留provider报告的原始chunk，不将潜在估算/累计chunk加总；零输出token不证明零计费，缓存未知为null。','','## 已知缺口','',...manifest.missing.map(x=>'- '+x),'','## 失败验收理由','',...records.filter(r=>!r.passed).map(r=>`- ${r.key}: ${(r.reasons??[r.status]).join(', ')}`),'','## 复跑与比较','',`本轮 manifest.json 冻结42项顺序、源码/依赖/runner/任务/评分器。results 逐条记录，任务输入和输出位于各key子目录。后续臂复用本轮任务/评分器和预算；任务fixture/runner版本改变须另建基线。模型远端revision未知，异时差异不可单独归因于代码。`];
 await fs.writeFile(join(output,'summary.md'),lines.join('\n'),{mode:0o600});
}
if(process.argv.includes('--finalize-locked')){
 const manifest=JSON.parse(await fs.readFile(join(output,'manifest.json'),'utf8'));
 const frozenFiles=JSON.parse(await fs.readFile(join(output,'snapshot-files.json'),'utf8')),provenance=JSON.parse(await fs.readFile(join(output,'snapshot/snapshot-provenance.json'),'utf8'));if(!verifyFrozenManifest(manifest,frozenFiles,provenance))throw Error('manifest-or-snapshot-mismatch');
 if(!await fs.stat(join(output,'started.json')).catch(()=>null)||await fs.stat(join(output,'finished.json')).catch(()=>null))throw Error('only started unfinished runs may be finalized');
 if(await fs.stat(join(output,'closed.json')).catch(()=>null))throw Error('run already closed');
 const started=JSON.parse(await fs.readFile(join(output,'started.json'),'utf8'));
 const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
 if(alive(started.pid))throw Error('runner still active; cannot finalize');
 for(const entry of plan){const worker=JSON.parse(await fs.readFile(join(output,entry.key,'worker-process.json'),'utf8').catch(()=>'{"pid":null}'));if(alive(worker.pid))throw Error('worker still active; cannot finalize');if(Number.isSafeInteger(worker.pid)){try{process.kill(-worker.pid,0);throw Error('worker process group still active');}catch(e){if(e.code!=='ESRCH')throw e;}}}
 if(JSON.stringify(manifest.plan)!==JSON.stringify(plan))throw Error('frozen-plan-mismatch');
 const ledger=strictJson(await fs.readFile(join(output,'ledger.json'),'utf8'));
 if(Object.keys(ledger).some(key=>!plan.some(e=>e.key===key)))throw Error('unknown-ledger-key');
 const records=[];
 for(const entry of plan){
  const r=ledger[entry.key];
  if(!r?.key){records.push({...entry,passed:false,status:r?.status==='running'?'interrupted':'not-run',reasons:['interrupted-run-no-replay']});continue;}
  try{
   const raw=await safeRead(join(output,entry.key),'result.json'),result=strictJson(raw);
   if(typeof r.resultSha256!=='string'||sha(raw)!==r.resultSha256||Object.keys(entry).some(k=>result[k]!==entry[k]||r[k]!==entry[k])||typeof result.passed!=='boolean')throw Error('invalid-result-evidence');
   records.push({...result,...entry,passed:result.passed&&r.passed===true,status:r.status,reasons:r.reasons??result.reasons,processWallMs:r.processWallMs,resultSha256:r.resultSha256});
  }catch{records.push({...entry,passed:false,status:'unverified-result',reasons:['missing-or-invalid-result-evidence']});}
 }
 summarize(records);
 if(await fs.stat(join(output,'closed.json')).catch(()=>null))throw Error('run already closed');
 await report(manifest,records,'interrupted-not-admitted');
 await fs.writeFile(join(output,'closed.json'),JSON.stringify({at:new Date().toISOString(),kind:'interrupted'}),{flag:'wx',mode:0o600});
 console.log('Interrupted run reconciled without re-executing any task');
}else if(process.argv.includes('--execute-prepared')){
 const manifest=JSON.parse(await fs.readFile(join(output,'manifest.json'),'utf8'));
 if(await fs.stat(join(output,'closed.json')).catch(()=>null)||await fs.stat(join(output,'finished.json')).catch(()=>null)||await fs.stat(join(output,'started.json')).catch(()=>null))throw Error('run already started; no replay');
 const snapshot=join(output,'snapshot'),frozen=JSON.parse(await fs.readFile(join(output,'snapshot-files.json'),'utf8')),initial=await tree(snapshot),provenance=JSON.parse(await fs.readFile(join(snapshot,'snapshot-provenance.json'),'utf8'));
 if(sha(JSON.stringify(initial))!==sha(JSON.stringify(frozen))||!verifyFrozenManifest(manifest,initial,provenance))throw Error('manifest-or-snapshot-mismatch');
 await fs.writeFile(join(output,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid}),{flag:'wx',mode:0o600});
 const {tsImport}=await import('tsx/esm/api');const {loadConfig}=await tsImport(join(snapshot,'src/utils/config.ts'),import.meta.url);
 const frozenConfig=await loadConfig();
 if(createHmac('sha256',manifest.configFingerprintSalt).update(JSON.stringify(frozenConfig)).digest('hex')!==manifest.configFingerprint)throw Error('configuration changed since preparation; use a new round');
 const records=[],budgetEnd=Date.now()+84*60000;let integrity='verified';
 const ledger=Object.fromEntries(plan.map(e=>[e.key,{status:'not-run'}]));
 for(const entry of plan){
  if(integrity!=='verified'||Date.now()>budgetEnd){const r={...entry,passed:false,status:integrity==='verified'?'budget-exceeded':'snapshot-invalidated',reasons:[integrity==='verified'?'budget-exceeded':'snapshot-invalidated']};records.push(r);ledger[entry.key]=r;await json(join(output,'ledger.json'),ledger);continue;}
  const dir=join(output,entry.key);
  const pristine=await verifyInitialTaskDirectory(dir,entry,tasks.find(t=>t.id===entry.taskId));
  if(!pristine){const r={...entry,passed:false,status:'initial-state-invalid',reasons:['fixture-changed-before-run']};records.push(r);ledger[entry.key]=r;await json(join(output,'ledger.json'),ledger);continue;}
  ledger[entry.key]={status:'running',startedAt:new Date().toISOString()};await json(join(output,'ledger.json'),ledger);
  const start=performance.now();let timedOut=false;
  const code=await new Promise(resolveExit=>{
   const child=spawn(process.execPath,['--import','tsx',join(snapshot,'scripts/evals/sol-pi/baseline-worker.mjs'),snapshot,output,entry.key],{cwd:snapshot,env:{...process.env,PATH:join(snapshot,'bin')+delimiter+(process.env.PATH??''),TSX_DISABLE_CACHE:'1',XIAOK_MODEL_RECOVERY_WINDOW_MS:'0'},stdio:['pipe','ignore','pipe'],detached:true});
   if(child.pid)writeFileSync(join(dir,'worker-process.json'),JSON.stringify({pid:child.pid}),{mode:0o600,flag:'wx'});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(frozenConfig));
   child.stderr.resume();const kill=()=>{
    // Also reap bash's deliberately detached process groups, deepest descendants first.
    try{const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));const descendants=[];const visit=p=>{for(const [pid,ppid]of rows)if(ppid===p){visit(pid);descendants.push(pid);}};visit(child.pid);for(const pid of descendants){try{process.kill(-pid,'SIGKILL');}catch{}try{process.kill(pid,'SIGKILL');}catch{}}}catch{}
    try{process.kill(-child.pid,'SIGKILL');}catch{}
   };
   const timer=setTimeout(()=>{timedOut=true;kill();},Math.max(1,Math.min(120000,budgetEnd-Date.now())));
   child.on('error',()=>{clearTimeout(timer);kill();resolveExit(null);});child.on('close',exit=>{clearTimeout(timer);kill();resolveExit(exit);});
  });
  const exitStatus=classifyWorkerExit(code,timedOut);
  let r;try{const raw=await fs.readFile(join(dir,'result.json'),'utf8');r=JSON.parse(raw);r.resultSha256=sha(raw);}catch{r={...entry,passed:false,status:exitStatus==='timeout'?'timeout':'worker-error',reasons:['no-result'],wallMs:null};}
  if(exitStatus!=='completed'){r.passed=false;r.status=exitStatus;r.reasons=[...(r.reasons??[]),'process-not-clean'];}
  r.processWallMs=performance.now()-start;records.push(r);ledger[entry.key]=r;
  await json(join(output,'ledger.json'),ledger);await report(manifest,records,integrity);
  console.log(`${records.length}/${plan.length} ${entry.key} ${r.status} ${Math.round(r.processWallMs)}ms`);
 }
 const final=await tree(snapshot);if(sha(JSON.stringify(final))!==sha(JSON.stringify(frozen)))integrity='invalidated';
 if(integrity!=='verified')for(const r of records){r.passed=false;r.status='snapshot-invalidated';}
 await report(manifest,records,integrity);await json(join(output,'finished.json'),{at:new Date().toISOString(),integrity});
}else{
 await fs.mkdir(dirname(output),{recursive:true,mode:0o700});await fs.mkdir(output,{mode:0o700});output=await fs.realpath(output);
 const snapshot=join(output,'snapshot');await fs.mkdir(snapshot,{mode:0o700});await fs.mkdir(join(snapshot,'bin'));await fs.copyFile(process.execPath,join(snapshot,'bin/node'),constants.COPYFILE_FICLONE);await fs.chmod(join(snapshot,'bin/node'),0o555);
 const paths=['src','desktop/electron','desktop/shared','scripts/evals/sol-pi','package.json','tsconfig.json','desktop/package.json','desktop/tsconfig.json','node_modules','desktop/node_modules'];
 for(const path of paths){if(await fs.stat(join(repo,path)).catch(()=>null)){await fs.mkdir(dirname(join(snapshot,path)),{recursive:true});await fs.cp(join(repo,path),join(snapshot,path),{recursive:true,dereference:true,mode:constants.COPYFILE_FICLONE});}}
 for(const path of ['package-lock.json','pnpm-lock.yaml','desktop/package-lock.json'])if(await fs.stat(join(repo,path)).catch(()=>null))await fs.copyFile(join(repo,path),join(snapshot,path));
 const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:64*1024*1024});
 const provenance={roundId:randomUUID(),head:git(['rev-parse','HEAD']).toString().trim(),dirtyDiffSha256:sha(git(['diff','HEAD']))};
 const {tsImport}=await import('tsx/esm/api');const {loadConfig}=await tsImport(join(snapshot,'src/utils/config.ts'),import.meta.url);const {createAdapter}=await tsImport(join(snapshot,'src/ai/models.ts'),import.meta.url);
 const config=await loadConfig(),adapter=createAdapter(config),caps=adapter.getCapabilities?.()??{};
 const publicModel={name:adapter.getModelName(),harness:adapter.getHarnessProfileId?.()??null,contextLimit:caps.contextLimit??null,compactThreshold:caps.compactThreshold??null,supportsPromptCaching:caps.supportsPromptCaching??null,supportsImageInput:caps.supportsImageInput??null};
 const configFingerprintSalt=randomUUID(),configFingerprint=createHmac('sha256',configFingerprintSalt).update(JSON.stringify(config)).digest('hex');
 const missing=['真实用户分布与独立密封holdout未覆盖','完整Desktop UI/host策略、外部状态、审批取消桶未覆盖','provider revision、远端缓存与OS page cache不可冻结；异时比较不可归因','真实费用与wire transport attempts未知，不能证明费用和5%收益门槛','全局配置仅在worker记录安全adapter元数据；完整配置与外部服务不是可重建快照','3个作者可见来源簇，不能满足v15正式非劣与多重检验准入'];
 Object.assign(provenance,{publicModel,configFingerprintSalt,configFingerprint,missing});await json(join(snapshot,'snapshot-provenance.json'),provenance);
 const files=await tree(snapshot);await json(join(output,'snapshot-files.json'),files);await readonly(snapshot);
 const manifest={schemaVersion:1,publicModel,configFingerprintSalt,configFingerprint,kind:'author-visible-engineering-baseline',createdAt:new Date().toISOString(),...provenance,snapshotSha256:sha(JSON.stringify(files)),nodeSha256:files['bin/node'],node:process.version,os:{platform:process.platform,release:os.release(),arch:process.arch},seed:'0x501918',plan,taskSpecSha256:sha(JSON.stringify(tasks)),runnerFiles:Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith('scripts/evals/sol-pi/baseline-'))),limits:{maxIterations:10,workerDeadlineMs:120000,runtimeDeadlineMs:110000,repeats:3,budgetMinutes:84},missing};
 await json(join(output,'manifest.json'),manifest);
 for(const entry of plan){const dir=join(output,entry.key);await fs.mkdir(join(dir,'workspace'),{recursive:true,mode:0o700});await fs.mkdir(join(dir,'metrics'),{mode:0o700});await json(join(dir,'entry.json'),entry);for(const [name,content]of Object.entries(tasks.find(t=>t.id===entry.taskId).files))await fs.writeFile(join(dir,'workspace',name),content,{mode:0o600});}
 await json(join(output,'ledger.json'),Object.fromEntries(plan.map(e=>[e.key,{status:'not-run'}])));
 console.log('Prepared immutable snapshot: '+output);
 if(!process.argv.includes('--prepare-only'))throw Error('Review frozen snapshot, then run --execute-prepared');
}
