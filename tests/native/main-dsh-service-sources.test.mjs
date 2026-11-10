import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
for(const scenario of ['unclaimed','prepare_close','partial_bind','services'])test('original Sources startup lifetime: '+scenario,{skip:process.platform!=='darwin',timeout:40000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-services-birth-'));
 const executable=await getNativeTestElectronExecutable(repo);
 const env={...process.env,XIAOK_CONFIG_DIR:join(root,'config')};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 const args=[join(repo,'tests/native/fixtures/main-dsh-service-sources.cjs'),repo,root,scenario];
 const child=spawn(executable,args,{env,stdio:['ignore','pipe','pipe']});
 const run={pid:child.pid,argv:[executable,...args],stdout:'',stderr:'',signals:[]};
 writeFileSync(join(root,'birth.json'),JSON.stringify(run));
 child.stdout.on('data',raw=>run.stdout+=raw);child.stderr.on('data',raw=>run.stderr+=raw);
 let escalation;const timer=setTimeout(()=>{run.signals.push('SIGTERM');child.kill('SIGTERM');escalation=setTimeout(()=>{run.signals.push('SIGKILL');child.kill('SIGKILL');},2000);},25000);
 await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(run,{code,signal,reaped:true});yes();});});
 clearTimeout(timer);clearTimeout(escalation);writeFileSync(join(root,'run.json'),JSON.stringify(run));
 console.log(JSON.stringify({root,...run}));
 const facts=JSON.parse(readFileSync(join(root,'facts.json'),'utf8'));
 assert.equal(run.code,0,JSON.stringify(facts));assert.deepEqual(run.signals,[]);assert.equal(facts.ok,true);
 assert.equal(facts.workerBirths,1);assert.equal(facts.workersRemaining,0);assert.equal(facts.fakeDisposeCalls,0);
 assert.equal(facts.secondPrepareRejected,true);assert.equal(facts.productionQualified,false);
});
