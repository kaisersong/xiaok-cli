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
test('original Main cold control reconciliation imports the actual B head without retransmission',{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const headers=process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,pricing=process.env.XIAOK_DSH_TEST_PRICING_HTML;
 assert.ok(headers,'isolated Electron headers required');assert.ok(pricing,'captured official pricing page required');
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-native-pipeline-')),domain=join(root,'domain'),addon=join(root,'root_resource_authority_main.node'),bundle=join(root,'pipeline.mjs');mkdirSync(domain);mkdirSync(join(root,'business'));
 const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),headers,addon,domain,'embedded'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr||build.stdout);
 const bootstrap=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-bootstrap.mjs'),headers,join(root,'main_bootstrap.node')],{encoding:'utf8'});assert.equal(bootstrap.status,0,bootstrap.stderr||bootstrap.stdout);
 for(const name of ['harness-optimization-store-worker.mjs','harness-dsh-budget-data.mjs','harness-dsh-budget-ledger.mjs','harness-dsh-work-escrow.mjs','harness-dsh-source-read-budget.mjs','harness-dsh-budget-conservative.mjs','harness-dsh-account-revision.mjs','harness-dsh-account-epoch.mjs','harness-dsh-draft-usage.mjs'])copyFileSync(join(repo,'desktop/electron',name),join(root,name));
 copyFileSync(join(repo,'native/harness-optimization-owner-lock/build/Release/harness_owner_lock.node'),join(root,'harness_owner_lock.node'));
 // Keep real ESM dynamic-import namespaces. A single-file bundle replaces
 // trusted exports with getter shells, which the production reader rejects.
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/dsh-pipeline-entry.ts')],outdir:root,entryNames:'pipeline',chunkNames:'chunk-[hash]',outExtension:{'.js':'.mjs'},splitting:true,bundle:true,platform:'node',format:'esm',packages:'external',banner:{js:"import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);"}});
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 const electron=await getNativeTestElectronExecutable(repo),result=join(root,'facts.json'),env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 for(const key of Object.keys(env))if(/(?:DEEPSEEK.*(?:KEY|TOKEN|URL)|(?:KEY|TOKEN|URL).*DEEPSEEK)/i.test(key))delete env[key];
 const negative=process.env.XIAOK_DSH_COLD_CONTROL_NEGATIVE==='1';
 const factsByStage=[];
 for(const stage of negative?['control_cold_prepare_unsent','control_cold_reject']:['control_cold_prepare','control_cold_settle']){
  env.XIAOK_DSH_PIPELINE_CASE=stage;
  const args=[join(repo,'tests/native/fixtures/dsh-pipeline-main.cjs'),bundle,root,repo,pricing,result];
  const child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']});
  const row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:''};
  writeFileSync(join(root,stage+'-birth.json'),JSON.stringify(row,null,2));
  child.stdout.on('data',value=>{row.stdout+=value;});child.stderr.on('data',value=>{row.stderr+=value;});
  const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');}},60000);
  try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});}
  finally{clearTimeout(timer);writeFileSync(join(root,stage+'-run.json'),JSON.stringify(row,null,2));}
  console.log(JSON.stringify({root,stage,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);
  const facts=JSON.parse(readFileSync(result,'utf8'));writeFileSync(join(root,stage+'-facts.json'),JSON.stringify(facts,null,2));
  assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));assert.equal(facts.notInstalledP4Qualification,true);assert.equal(facts.remainingSockets,0);factsByStage.push(facts);
 }
 assert.equal(factsByStage[0].coldControl.leasedWithoutAReceipt,true);
 assert.equal(factsByStage[1].modelCalls,0);assert.deepEqual(factsByStage[1].paths,[]);
 assert.equal(factsByStage[1].coldControl.clockUnverified,true);
 assert.equal(factsByStage[1].coldControl.leasedReadOnlyReconciled,!negative);if(negative){assert.equal(factsByStage[0].coldControl.neverTransmitted,true);assert.equal(factsByStage[1].coldControl.unconfirmedControlNotAcknowledged,true);}
 assert.equal(factsByStage[1].coldControl.operationId,factsByStage[0].coldControl.operationId);

});
