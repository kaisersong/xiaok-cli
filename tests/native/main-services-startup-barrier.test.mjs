import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';import {spawn,spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(join(repo,'package.json'));
test('original Services constructor holds recovery until fixed completion',{skip:process.platform!=='darwin',timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-main-composition-')),domain=join(root,'domain');mkdirSync(domain);
 const headers=process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS;assert.ok(headers,'explicit Electron headers required');
 for(const [script,args] of [['build-main-session.mjs',[headers,join(root,'root_resource_authority_main.node'),domain,'embedded']],['build-main-bootstrap.mjs',[headers,join(root,'main_bootstrap.node')]]]){
  const built=spawnSync(process.execPath,[join(repo,'native/root-resource-authority',script),...args],{encoding:'utf8'});assert.equal(built.status,0,built.stderr||built.stdout);
 }
 for(const name of ['harness-optimization-store-worker.mjs','harness-dsh-budget-data.mjs','harness-dsh-budget-ledger.mjs','harness-dsh-work-escrow.mjs','harness-dsh-source-read-budget.mjs','harness-dsh-budget-conservative.mjs','harness-dsh-account-revision.mjs','harness-dsh-account-epoch.mjs','harness-dsh-draft-usage.mjs'])copyFileSync(join(repo,'desktop/electron',name),join(root,name));
 copyFileSync(join(repo,'native/harness-optimization-owner-lock/build/Release/harness_owner_lock.node'),join(root,'harness_owner_lock.node'));
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/main-services-startup-barrier-entry.ts')],outdir:root,entryNames:'component',chunkNames:'chunk-[hash]',outExtension:{'.js':'.mjs'},splitting:true,bundle:true,platform:'node',format:'esm',packages:'external',banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"}});
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 const executable=await getNativeTestElectronExecutable(repo),env={...process.env,XIAOK_CONFIG_DIR:join(root,'config')};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 const args=[join(repo,'tests/native/fixtures/main-services-startup-barrier.cjs'),join(root,'component.mjs'),root],child=spawn(executable,args,{env,stdio:['ignore','pipe','pipe']});
 const run={pid:child.pid,argv:[executable,...args],stdout:'',stderr:'',signals:[]};writeFileSync(join(root,'birth.json'),JSON.stringify(run));child.stdout.on('data',v=>run.stdout+=v);child.stderr.on('data',v=>run.stderr+=v);
 let kill;const timer=setTimeout(()=>{run.signals.push('SIGTERM');child.kill('SIGTERM');kill=setTimeout(()=>{run.signals.push('SIGKILL');child.kill('SIGKILL');},2000);},25000);
 await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(run,{code,signal,reaped:true});yes();});});clearTimeout(timer);clearTimeout(kill);writeFileSync(join(root,'run.json'),JSON.stringify(run));console.log(JSON.stringify({root,...run}));
 const facts=JSON.parse(readFileSync(join(root,'facts.json'),'utf8'));assert.equal(run.code,0,JSON.stringify(facts));assert.deepEqual(run.signals,[]);assert.equal(facts.ok,true);assert.equal(facts.constructionReady,true);assert.equal(facts.recoveryHeldUntilCompletion,true);assert.equal(facts.closedBeforeStart,true);
});
