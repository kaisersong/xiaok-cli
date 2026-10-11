#!/usr/bin/env node
import fs from 'node:fs/promises';
import {homedir} from 'node:os';
import {verifyRecipeEnvironment,selectRegisteredRecipeManifest} from './paired-environment.mjs';
import {constants,writeFileSync} from 'node:fs';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {resolve,join,dirname,delimiter} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {assessSleepEnvironment,validatePairedResult,summarizePaired,createPairedPlan,assertSameModel,assertFrozenContract,verifyPairedManifest,hashMap,contractAssets,formalPairedConfig} from './paired-core.mjs';
import {tasks,safeRead,strictJson,classifyWorkerExit,verifyInitialTaskDirectory} from './baseline-core.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runnerFiles=[...contractAssets,'paired-core.mjs','paired-run.mjs','paired-worker.mjs','paired-environment.mjs','paired-mechanism.mjs','paired-desktop.mjs'];
export async function tree(root,entries={},prefix=''){
 for(const item of (await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=join(root,item.name),key=prefix+item.name;
  if(item.isDirectory())await tree(path,entries,key+'/');
  else if(item.isFile())entries[key]=sha(await fs.readFile(path));
  else throw Error('nonregular-frozen-source');
 }return entries;
}
async function readonly(root){for(const item of await fs.readdir(root,{withFileTypes:true})){const path=join(root,item.name);if(item.isDirectory())await readonly(path);else{const stat=await fs.stat(path);await fs.chmod(path,stat.mode&0o111?0o555:0o444);}}await fs.chmod(root,0o555);}
async function json(path,value){await fs.writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
const dependencyMap=files=>Object.fromEntries(Object.entries(files).filter(([key])=>key==='bin/node'||key.startsWith('node_modules/')||key.startsWith('desktop/node_modules/')));
async function binding(source,config){
 const {tsImport}=await import(pathToFileURL(join(source,'node_modules/tsx/dist/esm/api/index.mjs')).href);
 const {loadConfig}=await tsImport(join(source,'src/utils/config.ts'),import.meta.url);
 const {createAdapter}=await tsImport(join(source,'src/ai/models.ts'),import.meta.url);
 const frozenConfig=formalPairedConfig(config??await loadConfig());const adapter=createAdapter(frozenConfig);
 const {resolveRuntimeModelBinding}=await tsImport(join(source,'src/ai/providers/control-plane.ts'),import.meta.url);
 const resolved=resolveRuntimeModelBinding(frozenConfig);
 const scheme=typeof resolved.baseUrl==='string'?new URL(resolved.baseUrl).protocol:null;
 const identity={providerId:resolved.providerId,modelId:resolved.modelId,wireModel:resolved.wireModel,protocol:resolved.protocol,baseUrl:resolved.baseUrl};
 return {config:frozenConfig,publicModel:{name:adapter.getModelName(),harness:adapter.getHarnessProfileId?.()??null},identity,scheme};
}
export async function preparePairedRun({output,legacyBaseline,candidateRoot=repo,recipeEnvironmentDirectory=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1')}){
 if(process.platform!=='darwin')throw Error('SOLPI_PAIRED_MACOS_ONLY');
 output=resolve(output);legacyBaseline=await fs.realpath(legacyBaseline);candidateRoot=await fs.realpath(candidateRoot);
 const manifestPath=await selectRegisteredRecipeManifest({sourceRoot:candidateRoot,environmentRoot:recipeEnvironmentDirectory});
 const recipe=await verifyRecipeEnvironment({sourceRoot:candidateRoot,environmentPath:join(recipeEnvironmentDirectory,'environment.json'),manifestPath});
 const historical=JSON.parse(await fs.readFile(join(legacyBaseline,'manifest.json'),'utf8'));
 const finished=JSON.parse(await fs.readFile(join(legacyBaseline,'finished.json'),'utf8'));
 if(finished.integrity!=='verified')throw Error('legacy-baseline-not-verified');
 const historicalSource=await fs.realpath(join(legacyBaseline,'snapshot'));
 const expectedLegacy=JSON.parse(await fs.readFile(join(legacyBaseline,'snapshot-files.json'),'utf8'));
 const legacyFiles=await tree(historicalSource);
 if(hashMap(legacyFiles)!==hashMap(expectedLegacy)||historical.snapshotSha256!==hashMap(legacyFiles))throw Error('legacy-source-drift');
 const localAssets=Object.fromEntries(await Promise.all(contractAssets.map(async name=>[name,sha(await fs.readFile(join(here,name)))])));
 const legacyAssets=Object.fromEntries(contractAssets.map(name=>[name,legacyFiles[`scripts/evals/sol-pi/${name}`]]));assertFrozenContract(legacyAssets,localAssets);
 await fs.mkdir(dirname(output),{recursive:true,mode:0o700});await fs.mkdir(output,{mode:0o700});output=await fs.realpath(output);
 const legacy=join(output,'sources/legacy'),candidate=join(output,'sources/candidate'),harness=join(output,'harness');await fs.mkdir(join(candidate,'bin'),{recursive:true,mode:0o700});await fs.mkdir(harness,{mode:0o700});
 await fs.copyFile(process.execPath,join(candidate,'bin/node'),constants.COPYFILE_FICLONE);await fs.chmod(join(candidate,'bin/node'),0o555);
 for(const path of ['src','desktop/electron','desktop/shared','package.json','tsconfig.json','desktop/package.json','desktop/tsconfig.json','node_modules','desktop/node_modules','package-lock.json','pnpm-lock.yaml','desktop/package-lock.json']){
  if(await fs.stat(join(candidateRoot,path)).catch(()=>null)){await fs.mkdir(dirname(join(candidate,path)),{recursive:true});await fs.cp(join(candidateRoot,path),join(candidate,path),{recursive:true,dereference:true,mode:constants.COPYFILE_FICLONE});}
 }
 // Freeze legacy production source separately; both arms use identical current dependency bytes.
 await fs.mkdir(legacy,{recursive:true});
 for(const name of ['src','desktop/electron','desktop/shared','package.json','tsconfig.json','desktop/package.json','desktop/tsconfig.json']){if(!await fs.stat(join(historicalSource,name)).catch(()=>null))continue;await fs.mkdir(dirname(join(legacy,name)),{recursive:true});await fs.cp(join(historicalSource,name),join(legacy,name),{recursive:true,dereference:true,mode:constants.COPYFILE_FICLONE});}
 for(const name of ['node_modules','desktop/node_modules','bin'])await fs.cp(join(candidate,name),join(legacy,name),{recursive:true,dereference:true,mode:constants.COPYFILE_FICLONE});
 for(const name of runnerFiles)await fs.copyFile(join(here,name),join(harness,name));
 const files={legacy:await tree(legacy),candidate:await tree(candidate),harness:await tree(harness)};
 if(Object.entries(files.legacy).some(([k,v])=>(k.startsWith('src/')||k.startsWith('desktop/electron/')||k.startsWith('desktop/shared/'))&&legacyFiles[k]!==v))throw Error('legacy-production-source-drift');
 if(hashMap(dependencyMap(files.legacy))!==hashMap(dependencyMap(files.candidate)))throw Error('node-or-dependency-mismatch');
 let a,b;try{b=await binding(candidate);a=await binding(legacy,b.config);}catch{throw Error('paired-model-binding-unavailable');}
 assertSameModel(a.publicModel,b.publicModel);
 if(JSON.stringify(a.identity)!==JSON.stringify(b.identity))throw Error('paired-model-binding-mismatch');
 if(a.scheme!=='https:'||b.scheme!=='https:')throw Error('candidate-disclosure-requires-https');
 const capacityIdentity={destination:b.identity.baseUrl.replace(/\/$/,'')+'/chat/completions',model:b.identity.wireModel,protocol:b.identity.protocol,profileId:b.publicModel.harness};
 await verifyRecipeEnvironment({sourceRoot:candidate,...recipe.identity,expected:recipe.identity,capacityIdentity});
 const salt=randomUUID();const fingerprint=createHmac('sha256',salt).update(JSON.stringify(b.config)).digest('hex');
 const manifest={schemaVersion:9,kind:'paired-author-visible-engineering-eval',createdAt:new Date().toISOString(),roundId:randomUUID(),legacyBaseline,
  recipeEnvironment:recipe.identity,capacityIdentity,historicalPublicModel:historical.publicModel,modelOverride:{kind:'current-model-wire-only-memory-and-private-desktop-case-copy',wireModel:'deepseek-flash'},historicalSourceHash:hashMap(legacyFiles),legacyProductionSourceHash:hashMap(Object.fromEntries(Object.entries(files.legacy).filter(([k])=>k.startsWith('src/')||k.startsWith('desktop/electron/')||k.startsWith('desktop/shared/')))),commonDependencyHash:hashMap(dependencyMap(files.candidate)),historicalDependencyDrift:[...new Set([...Object.keys(dependencyMap(legacyFiles)),...Object.keys(dependencyMap(files.candidate))])].filter(k=>legacyFiles[k]!==files.candidate[k]),dependencyMode:'same-current-frozen-dependencies-v9-common-main-taskhost',historicalDependencyMatch:hashMap(dependencyMap(legacyFiles))===hashMap(dependencyMap(files.candidate)),sourceRoots:{legacy,candidate},harnessRoot:harness,sourceHashes:{legacy:hashMap(files.legacy),candidate:hashMap(files.candidate)},harnessHash:hashMap(files.harness),
  contractAssets:localAssets,taskSpecHash:hashMap(tasks),schedule:createPairedPlan(),publicModel:b.publicModel,scheme:'https',configFingerprintSalt:salt,configFingerprint:fingerprint,
  historicalConfigMatch:createHmac('sha256',historical.configFingerprintSalt).update(JSON.stringify(b.config)).digest('hex')===historical.configFingerprint,
  limits:{maxIterations:10,runtimeDeadlineMs:110000,workerDeadlineMs:120000,repeats:3,armBudgetMs:84*60000},
  policy:{kind:'fixture-whole-file-scopes-v1',expiryAfterStartMs:180000,archiveAdapter:'native.read.v1',bashAdapter:'native.bash.v1'},
  missing:['formal-holdout','actual-cost','cli-and-child-wire-attempt-count','provider-cache-isolation','backend-revision-identity','semantic-compaction-executor','trusted-receipt','child-observation-availability']};
 await fs.copyFile(recipe.identity.manifestPath,join(output,'recipe-environment-manifest.json'),constants.COPYFILE_EXCL);
 await json(join(output,'manifest.json'),manifest);await fs.writeFile(join(output,'manifest.sha256'),sha(await fs.readFile(join(output,'manifest.json')))+'\n',{mode:0o400,flag:'wx'});await json(join(output,'frozen-files.json'),files);
 for(const entry of manifest.schedule)await writePairedFixture(join(output,entry.relativeDirectory),entry,tasks.find(t=>t.id===entry.taskId));
 await json(join(output,'ledger.json'),Object.fromEntries(manifest.schedule.map(e=>[e.key,{status:'not-run'}])));
 await readonly(legacy);await readonly(candidate);await readonly(harness);
 return {output,plannedPerArm:42,publicModel:b.publicModel,scheme:'https',harnessHash:manifest.harnessHash};
}
export async function writePairedFixture(dir,entry,task){
 await fs.mkdir(join(dir,'workspace'),{recursive:true,mode:0o700});await fs.mkdir(join(dir,'metrics'),{mode:0o700});
 await fs.writeFile(join(dir,'entry.json'),JSON.stringify(entry,null,2),{mode:0o600,flag:'wx'});
 for(const [name,content]of Object.entries(task.files))await fs.writeFile(join(dir,'workspace',name),content,{mode:0o600,flag:'wx'});
}
export async function checkPrepared(output){
 output=await fs.realpath(output);const manifestBytes=await fs.readFile(join(output,'manifest.json'));
 if(sha(manifestBytes)!==(await fs.readFile(join(output,'manifest.sha256'),'utf8')).trim())throw Error('prepared-manifest-drift');
 const manifest=JSON.parse(manifestBytes);
 if(await fs.stat(join(output,'started.json')).catch(()=>null))throw Error('round-already-started');
 await verifyRecipeEnvironment({sourceRoot:manifest.sourceRoots.candidate,...manifest.recipeEnvironment,expected:manifest.recipeEnvironment,capacityIdentity:manifest.capacityIdentity,manifestSnapshotPath:join(output,'recipe-environment-manifest.json')});
 const expected=JSON.parse(await fs.readFile(join(output,'frozen-files.json'),'utf8'));
 const files={legacy:await tree(manifest.sourceRoots.legacy),candidate:await tree(manifest.sourceRoots.candidate),harness:await tree(manifest.harnessRoot)};
 if(!verifyPairedManifest(manifest,files)||hashMap(files)!==hashMap(expected))throw Error('prepared-snapshot-drift');
 assertFrozenContract(manifest.contractAssets,Object.fromEntries(contractAssets.map(name=>[name,files.harness[name]])));
 if(hashMap(dependencyMap(files.legacy))!==hashMap(dependencyMap(files.candidate)))throw Error('node-or-dependency-mismatch');
 let a,b;try{b=await binding(manifest.sourceRoots.candidate);a=await binding(manifest.sourceRoots.legacy,b.config);}catch{throw Error('paired-model-binding-unavailable');}
 assertSameModel(manifest.publicModel,a.publicModel,b.publicModel);
 if(JSON.stringify(a.identity)!==JSON.stringify(b.identity)||a.scheme!=='https:'||b.scheme!=='https:')throw Error('paired-model-binding-mismatch');
 if(createHmac('sha256',manifest.configFingerprintSalt).update(JSON.stringify(b.config)).digest('hex')!==manifest.configFingerprint)throw Error('config-changed-since-prepare');
 for(const entry of manifest.schedule)if(!await verifyInitialTaskDirectory(join(output,entry.relativeDirectory),entry,tasks.find(t=>t.id===entry.taskId)))throw Error('fixture-not-pristine');
 return {manifest,config:b.config,files};
}
async function atomicJson(path,value){const temp=path+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temp,path);}
export async function report(output,manifest,records,integrity,comparison){
 const summary={...summarizePaired(records,comparison),integrity,knownMissing:manifest.missing};await atomicJson(join(output,'summary.json'),summary);
 await fs.writeFile(join(output,'summary.md'),['# SoL-Pi v9 正式模型同期配对工程评估','',`快照完整性：${integrity}。candidate CLI-main 与 Desktop 普通 main 共24项具备机制接线资格，其余18项保持not-ready；实际activation见原始机制事实。实际费用未知，模型名一致不证明后端 revision 一致。r19旧别名仅历史参考，不与其32/42计算提升。此结果不可宣称正式准入。`,'','| 臂 | 通过/原分母 | 完整通过桶 |','|---|---:|---:|',...['legacy','candidate'].map(a=>`| ${a} | ${summary[a].passed}/42 | ${summary[a].cells.filter(c=>c.allThreePassed).length}/14 |`),'',`比较环境有效：${summary.comparisonValid===null?'等待末尾检查':summary.comparisonValid}；限制：${summary.comparisonLimitation??'无新增环境限制'}。`,'','各桶明细、缺失/失败/超时、adapter calls 与原始 usage 见 summary.json。Desktop wire attempts 来自真实 fetch 旁观计数；CLI/child wire attempts 与所有费用仍未知，不将 token 相加推算费用。'].join('\n'),{mode:0o600});
}
export async function executePrepared(output){
 output=await fs.realpath(output);let {manifest,config,files}=await checkPrepared(output);
 if(await fs.realpath(fileURLToPath(import.meta.url))!==join(manifest.harnessRoot,'paired-run.mjs')||await fs.realpath(process.execPath)!==join(manifest.sourceRoots.candidate,'bin/node'))throw Error('execution-requires-frozen-runner-and-node');
 const environmentStart=Date.now(),assertions=execFileSync('/usr/bin/pmset',['-g','assertions'],{encoding:'utf8'}),sleepStart=execFileSync('/usr/bin/pmset',['-g','log'],{encoding:'utf8',maxBuffer:64*1024*1024});
 if(!assessSleepEnvironment(assertions,'',environmentStart,environmentStart).valid)throw Error('PreventSystemSleep-required');
 await json(join(output,'started.json'),{at:new Date(environmentStart).toISOString(),pid:process.pid});
 await fs.writeFile(join(output,'power-start.txt'),assertions+'\n'+sleepStart,{mode:0o600,flag:'wx'});
 const records=[],ledger=Object.fromEntries(manifest.schedule.map(e=>[e.key,{status:'not-run'}])),used={legacy:0,candidate:0};let integrity='verified';
 for(const entry of manifest.schedule){
  const dir=join(output,entry.relativeDirectory),source=manifest.sourceRoots[entry.arm];let r;
  if(used[entry.arm]>=manifest.limits.armBudgetMs)r={...entry,passed:false,status:'budget-exceeded',reasons:['budget-exceeded']};
  else if(!await verifyInitialTaskDirectory(dir,entry,tasks.find(t=>t.id===entry.taskId)))r={...entry,passed:false,status:'initial-state-invalid',reasons:['fixture-changed-before-run']};
  else{
   ledger[entry.key]={status:'running'};await atomicJson(join(output,'ledger.json'),ledger);const start=performance.now();let timedOut=false;
   const code=await new Promise(resolveExit=>{
    const child=spawn(join(source,'bin/node'),['--import',join(source,'node_modules/tsx/dist/loader.mjs'),join(manifest.harnessRoot,'paired-worker.mjs'),source,output,entry.relativeDirectory],{cwd:source,env:{...process.env,PATH:join(source,'bin')+delimiter+(process.env.PATH??''),TSX_DISABLE_CACHE:'1',XIAOK_MODEL_RECOVERY_WINDOW_MS:'0'},stdio:['pipe','ignore','pipe'],detached:true});
    if(child.pid)writeFileSync(join(dir,'worker-process.json'),JSON.stringify({pid:child.pid}),{mode:0o600,flag:'wx'});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(config));child.stderr.resume();
    const kill=()=>{if(!child.pid)return;try{const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/).map(Number));const descendants=[];const visit=p=>{for(const [pid,ppid]of rows)if(ppid===p){visit(pid);descendants.push(pid);}};visit(child.pid);for(const pid of descendants){try{process.kill(-pid,'SIGKILL');}catch{}try{process.kill(pid,'SIGKILL');}catch{}}}catch{}try{process.kill(-child.pid,'SIGKILL');}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill();},Math.max(1,Math.min(manifest.limits.workerDeadlineMs,manifest.limits.armBudgetMs-used[entry.arm])));
    child.on('error',()=>{clearTimeout(timer);kill();resolveExit(null);});child.on('close',code=>{clearTimeout(timer);kill();resolveExit(code);});
   });
   const exit=classifyWorkerExit(code,timedOut);
   try{const raw=await safeRead(dir,'result.json');r=validatePairedResult(entry,raw,exit);}catch{r={...entry,passed:false,status:exit==='timeout'?'timeout':'worker-error',reasons:['missing-or-invalid-result'],wallMs:null};}
   if(exit!=='completed'){r.passed=false;r.status=exit;}
   r.processWallMs=performance.now()-start;used[entry.arm]+=r.processWallMs;
  }
  records.push(r);ledger[entry.key]=r;await atomicJson(join(output,'ledger.json'),ledger);await report(output,manifest,records,integrity);console.log(`${records.length}/84 ${entry.key} ${r.status}`);
 }
 const after={legacy:await tree(manifest.sourceRoots.legacy),candidate:await tree(manifest.sourceRoots.candidate),harness:await tree(manifest.harnessRoot)};
 if(hashMap(after)!==hashMap(files)||sha(await fs.readFile(join(output,'manifest.json')))!==(await fs.readFile(join(output,'manifest.sha256'),'utf8')).trim())integrity='invalidated';
 if(integrity!=='verified')for(const r of records){r.passed=false;r.status='snapshot-invalidated';}
 const sleepEnd=execFileSync('/usr/bin/pmset',['-g','log'],{encoding:'utf8',maxBuffer:64*1024*1024});await fs.writeFile(join(output,'power-end.txt'),sleepEnd,{mode:0o600,flag:'wx'});
 let recipeEnvironmentValid=true;try{await verifyRecipeEnvironment({sourceRoot:manifest.sourceRoots.candidate,...manifest.recipeEnvironment,expected:manifest.recipeEnvironment,capacityIdentity:manifest.capacityIdentity,manifestSnapshotPath:join(output,'recipe-environment-manifest.json')});}catch{recipeEnvironmentValid=false;manifest={...manifest,missing:[...manifest.missing,'recipe-environment-invalid-not-candidate-regression']};}
 const environment={...assessSleepEnvironment(assertions,sleepEnd,environmentStart,Date.now()),recipeEnvironmentValid};await json(join(output,'environment.json'),{...environment,comparisonValid:environment.valid&&recipeEnvironmentValid,limitation:!recipeEnvironmentValid?'recipe-environment-invalid-not-candidate-regression':environment.valid?null:'sleep-invalidates-performance-comparison-not-candidate-regression'});if(!environment.valid)manifest={...manifest,missing:[...manifest.missing,'sleep-invalidates-performance-comparison']};
 await report(output,manifest,records,integrity,{comparisonValid:integrity==='verified'&&environment.valid&&recipeEnvironmentValid,limitation:integrity!=='verified'?'snapshot-invalidated':!recipeEnvironmentValid?'recipe-environment-invalid-not-candidate-regression':!environment.valid?'sleep-invalidates-performance-comparison-not-candidate-regression':null});await atomicJson(join(output,'ledger.json'),Object.fromEntries(records.map(r=>[r.key,r])));await json(join(output,'finished.json'),{at:new Date().toISOString(),integrity});
}

async function main(){
 const [output,mode,legacyBaseline]=process.argv.slice(2);if(!output)throw Error('usage: paired-run.mjs <new-output> --prepare-only <r19-baseline> | <prepared> --check-prepared');
 if(mode==='--prepare-only'){if(!legacyBaseline)throw Error('legacy-baseline-required');console.log(JSON.stringify(await preparePairedRun({output,legacyBaseline})));}
 else if(mode==='--check-prepared'){const {manifest}=await checkPrepared(output);console.log(JSON.stringify({verified:true,plannedPerArm:42,publicModel:manifest.publicModel,scheme:'https'}));}
 else if(mode==='--execute'){const root=await fs.realpath(output),runner=join(root,'harness/paired-run.mjs'),node=join(root,'sources/candidate/bin/node');if(await fs.realpath(fileURLToPath(import.meta.url))!==runner||await fs.realpath(process.execPath)!==node){const child=spawnSync(node,[runner,root,'--execute'],{cwd:dirname(node),env:process.env,stdio:'inherit'});process.exitCode=child.status??1;}else await executePrepared(root);}
 else throw Error('SOLPI_PAIRED_EXPLICIT_MODE_REQUIRED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
