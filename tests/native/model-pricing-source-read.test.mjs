import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(join(repo,'package.json'));
async function actual(mode){
 const headers=process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,pricing=process.env.XIAOK_DSH_TEST_PRICING_HTML;
 assert.ok(headers,'isolated Electron headers required');assert.ok(pricing,'captured official pricing page required');
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-native-pipeline-')),domain=join(root,'domain'),addon=join(root,'root_resource_authority_main.node'),bundle=join(root,'pipeline.mjs');mkdirSync(domain);mkdirSync(join(root,'business'));
 const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),headers,addon,domain,'embedded'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr||build.stdout);
 const bootstrap=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-bootstrap.mjs'),headers,join(root,'main_bootstrap.node')],{encoding:'utf8'});assert.equal(bootstrap.status,0,bootstrap.stderr||bootstrap.stdout);
 for(const name of ['harness-optimization-store-worker.mjs','harness-dsh-budget-data.mjs','harness-dsh-budget-ledger.mjs','harness-dsh-work-escrow.mjs','harness-dsh-source-read-budget.mjs','harness-dsh-budget-conservative.mjs','harness-dsh-account-revision.mjs','harness-dsh-account-epoch.mjs','harness-dsh-draft-usage.mjs','harness-dsh-worker-initialize.mjs'])copyFileSync(join(repo,'desktop/electron',name),join(root,name));
 copyFileSync(join(repo,'native/harness-optimization-owner-lock/build/Release/harness_owner_lock.node'),join(root,'harness_owner_lock.node'));
 // Keep real ESM dynamic-import namespaces. A single-file bundle replaces
 // trusted exports with getter shells, which the production reader rejects.
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/dsh-pipeline-entry.ts')],outdir:root,entryNames:'pipeline',chunkNames:'chunk-[hash]',outExtension:{'.js':'.mjs'},splitting:true,bundle:true,platform:'node',format:'esm',packages:'external',banner:{js:"import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);"}});
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 const electron=await getNativeTestElectronExecutable(repo),result=join(root,'facts.json'),env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 delete env.XIAOK_DSH_PIPELINE_CASE;
 for(const key of Object.keys(env))if(/(?:DEEPSEEK.*(?:KEY|TOKEN|URL)|(?:KEY|TOKEN|URL).*DEEPSEEK)/i.test(key))delete env[key];
 const originalFixture=readFileSync(join(repo,'tests/native/fixtures/dsh-pipeline-main.cjs'),'utf8');
 const anchor=" const completion={workClosed:true";
 assert.equal(originalFixture.split(anchor).length,2,'exact original full pipeline fixture anchor');
 const meterAssert=` const sourceDb=new(require('node:sqlite').DatabaseSync)(path.join(root,'budget/harness-optimization.sqlite'),{readOnly:true});
 let sourceMeter;
 try{const total=sourceDb.prepare('SELECT sum(spent_requests) AS requests,sum(spent_bytes) AS bytes FROM dsh_budget_source_scans').get();
 const expectedRequests=paths.filter(value=>value!=='/chat/completions').length;
 const priceRequests=paths.filter(value=>value.startsWith('/quick_start/pricing/')).length;
 assert.equal(priceRequests,1,'actual fixed pricing GET must really have happened');
 sourceMeter={expectedRequests,priceRequests,bookedRequests:total.requests,bookedBytes:total.bytes};
 assert.equal(total.requests,expectedRequests,'every actual Source GET including public pricing must be booked');
 assert.ok(total.bytes>=fs.statSync(pricingFile).size,'actual public pricing bytes must be booked');
 }finally{sourceDb.close();}
`;
 let fixtureSource=originalFixture.replace(anchor,meterAssert+anchor);
 if(mode==='request-tail'){
  fixtureSource=fixtureSource.replace('const cleanup=[],children=[]',"let releasePricingTail;const pricingTail=new Promise(yes=>{releasePricingTail=yes;}),pricingTailCuts=[];const cleanup=[],children=[]");
  const rawRequest='return nativeRequest.call(https,new URL(url.pathname+url.search,origin),{...options,ca:cert},callback);';
  assert.equal(fixtureSource.split(rawRequest).length,2,'original actual request seam');
  fixtureSource=fixtureSource.replace(rawRequest,`const raw=nativeRequest.call(https,new URL(url.pathname+url.search,origin),{...options,ca:cert},callback);
   if(url.origin==='https://api-docs.deepseek.com'){
    Object.defineProperty(raw,Symbol('actual-pricing-request-sdk-tail'),{value:pricingTail});
    raw.once('close',()=>setTimeout(()=>{const db=new(require('node:sqlite').DatabaseSync)(path.join(root,'budget/harness-optimization.sqlite'),{readOnly:true});try{pricingTailCuts.push(db.prepare("SELECT state FROM dsh_budget_source_attempts WHERE attempt_id LIKE 'model-pricing:%'").all().map(row=>row.state));}finally{db.close();releasePricingTail();}},200));
   }return raw;`);
  fixtureSource=fixtureSource.replace(anchor," assert.deepEqual(pricingTailCuts,[['prepared']],'actual original ClientRequest own tail must finish before Source money settlement');\n"+anchor);
 }
 if(mode==='pre-sdk-revoke'){
  const birth=" const api=await import(pathToFileURL(bundle).href),dataRoot=";
  assert.equal(fixtureSource.split(birth).length,2);
  fixtureSource=fixtureSource.replace(birth,`Error.stackTraceLimit=80;let probeSourceOwner,probeHits=0;const probeStacks=[];setInterval(()=>{if(probeSourceOwner)fs.writeFileSync(path.join(root,'probe-tick.json'),JSON.stringify({probeHits,paths,modelCalls,stacks:probeStacks.slice(-2)}));},1000).unref();
 const Module=require('node:module'),loadNode=Module._extensions['.node'];
 Module._extensions['.node']=function(module,filename){loadNode(module,filename);if(path.basename(filename)==='main_bootstrap.node'){
 const row=Object.getOwnPropertyDescriptor(module.exports,'assertOriginalMainIssuerCurrent');if(row&&typeof row.value==='function'){const original=row.value;Object.defineProperty(module.exports,'assertOriginalMainIssuerCurrent',{...row,value:function(...args){const result=Reflect.apply(original,this,args),stack=new Error('actual-role-after-original-native').stack;if(/beforeTransport/.test(stack)&&/at gate/.test(stack)&&probeSourceOwner&&!probeHits&&fs.existsSync(path.join(root,'budget/harness-optimization.sqlite'))){const db=new(require('node:sqlite').DatabaseSync)(path.join(root,'budget/harness-optimization.sqlite'),{readOnly:true});let prepared;try{prepared=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='dsh_budget_source_attempts'").get().n?db.prepare("SELECT count(*) n FROM dsh_budget_source_attempts WHERE attempt_id LIKE 'model-pricing:%' AND state='prepared'").get().n:0;}finally{db.close();}if(prepared){probeStacks.push(stack);fs.writeFileSync(path.join(root,'probe-role-live.json'),JSON.stringify({probeHits,stack}));if(/at gate[0-9]* \\(/.test(stack)&&/beforeTransport/.test(stack)){probeHits++;fs.writeFileSync(path.join(root,'probe-role-hit.json'),JSON.stringify({probeHits,stack}));probeSourceOwner.stopAccepting();}}}return result;}});}}
 };
`+birth);
  const prepared=" const service=api.createKSwarmService(";assert.equal(fixtureSource.split(prepared).length,2,'exact genuine prepared Sources seam');
  fixtureSource=fixtureSource.replace(prepared," probeSourceOwner=lease.sourcePopulation;\n"+prepared);
  const stage=" if(process.env.XIAOK_DSH_PIPELINE_CASE==='draft_http_negative'){";
  assert.equal(fixtureSource.split(stage).length,2);
  fixtureSource=fixtureSource.replace(stage,` {
  let rejected=false;try{await window.webContents.executeJavaScript("window.pipeline('new-input')");}catch{rejected=true;}
  const db=new(require('node:sqlite').DatabaseSync)(path.join(root,'budget/harness-optimization.sqlite'),{readOnly:true});let rows;try{rows=db.prepare("SELECT state,actual_bytes,request_sent FROM dsh_budget_source_attempts WHERE attempt_id LIKE 'model-pricing:%'").all();}finally{db.close();}
  fs.writeFileSync(path.join(root,'negative-pricing-probe.json'),JSON.stringify({probeHits,probeStacks,rejected,rows,paths,modelCalls},null,2));
  assert.equal(probeHits,1,'genuine role SDK gate must really revoke this original Source');assert.equal(rejected,true);assert.equal(modelCalls,0);assert.equal(paths.filter(value=>value.startsWith('/quick_start/pricing/')).length,0);
  assert.deepEqual(rows.map(row=>({...row})),[{state:'not_sent',actual_bytes:0,request_sent:0}],'accepted original cap needs negative accounting even after positive Source revoked');
  return{actualMain:true,actualAAndBudgetAndB:true,notInstalledP4Qualification:true,probeHits,paths,modelCalls};
 }
`+stage);
 }
 const fixture=join(root,'pricing-meter-main.cjs');writeFileSync(fixture,fixtureSource);
 const args=[fixture,bundle,root,repo,pricing,result],child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:''};
 writeFileSync(join(root,'birth.json'),JSON.stringify(row,null,2));child.stdout.on('data',value=>{row.stdout+=value;});child.stderr.on('data',value=>{row.stderr+=value;});
 const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');}},60000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});}finally{clearTimeout(timer);writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2));}
 console.log(JSON.stringify({root,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);
 const facts=JSON.parse(readFileSync(result,'utf8'));assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));assert.equal(facts.notInstalledP4Qualification,true);
}
test('actual public pricing GET is booked in the same original SourceRead ledger before model dispatch',{skip:process.platform!=='darwin',timeout:90000},()=>actual('normal'));
test('actual public pricing request SDK own tail keeps its original reservation prepared',{skip:process.platform!=='darwin',timeout:90000},()=>actual('request-tail'));

test('genuine Source revoke after cap take and before original HTTPS still settles its exact cap',{skip:process.platform!=='darwin',timeout:90000},()=>actual('pre-sdk-revoke'));
