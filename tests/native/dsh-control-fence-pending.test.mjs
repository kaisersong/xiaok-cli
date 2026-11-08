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
test('original Main refuses permissive overwrite before the original B control fence',{skip:process.platform!=='darwin',timeout:90000},async()=>{
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
 for(const key of Object.keys(env))if(/(?:DEEPSEEK.*(?:KEY|TOKEN|URL)|(?:KEY|TOKEN|URL).*DEEPSEEK)/i.test(key))delete env[key];
 const caseName=process.env.XIAOK_DSH_CONTROL_FENCE_CASE??'fence_pending';
 assert.ok(caseName==='fence_pending'||caseName==='fence_pending_work');
 env.XIAOK_DSH_PIPELINE_CASE=caseName;
 const args=[join(repo,'tests/native/fixtures/dsh-pipeline-main.cjs'),bundle,root,repo,pricing,result],child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:''};
 writeFileSync(join(root,'birth.json'),JSON.stringify(row,null,2));child.stdout.on('data',value=>{row.stdout+=value;});child.stderr.on('data',value=>{row.stderr+=value;});
 const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');}},60000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});}finally{clearTimeout(timer);writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2));}
 console.log(JSON.stringify({root,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);
 const facts=JSON.parse(readFileSync(result,'utf8'));assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));assert.equal(facts.notInstalledP4Qualification,true);assert.equal(facts.modelCalls,caseName==='fence_pending_work'?1:0);assert.equal(facts.fence.unconfirmedFenceBlocksAuto,true);assert.equal(facts.fence.originalOffDelivered,true);assert.equal(facts.fence.explicitAutoAfterFence,true);assert.deepEqual(facts.fence.policyAxes,['mandate','egress','privacy','readonly']);assert.equal(facts.fence.egressEnableWaitsForFence,true);if(caseName==='fence_pending_work')assert.equal(facts.fence.realWorkStoppedAndNotRevived,true);
});
