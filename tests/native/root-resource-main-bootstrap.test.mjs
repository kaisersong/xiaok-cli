import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
test('original Electron Main Native issuer has a role-bound opaque lifetime',{skip:process.platform!=='darwin',timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-main-bootstrap-'));
 const addon=join(root,'main-bootstrap.node'),foreign=join(root,'foreign.node');
 if(process.env.XIAOK_MAIN_BOOTSTRAP_TEST_ADDON)copyFileSync(process.env.XIAOK_MAIN_BOOTSTRAP_TEST_ADDON,addon);
 else{
  assert.ok(process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,'actual Electron SDK headers required');
  const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-bootstrap.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
 }
 copyFileSync(addon,foreign);
 const electron=await getNativeTestElectronExecutable(repo);
 const fixture=join(repo,'tests/native/fixtures/root-resource-main-bootstrap.cjs');
 const runs=[];
 for(const mode of ['main','run-as-node','plain-node']){
  const evidence=join(root,mode);mkdirSync(evidence);const resultPath=join(evidence,'facts.json');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  if(mode==='run-as-node')env.ELECTRON_RUN_AS_NODE='1';
  const argv=[fixture,mode,addon,foreign,resultPath,join(evidence,'userData')];
  const executable=mode==='plain-node'?process.execPath:electron;
  const child=spawn(executable,argv,{env,stdio:['ignore','pipe','pipe']});
  const birth=spawnSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim();
  const row={mode,pid:child.pid,birth,argv:[executable,...argv],signals:[],stdout:'',stderr:''};runs.push(row);
  writeFileSync(join(evidence,'birth.json'),JSON.stringify(row,null,2));
  child.stdout.on('data',value=>{row.stdout+=value;});child.stderr.on('data',value=>{row.stderr+=value;});
  let escalation;const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');
   escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGKILL');child.kill('SIGKILL');}},2000);
  }},20000);
  try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{row.code=code;row.signal=signal;row.reaped=true;yes();});});}
  finally{clearTimeout(timer);clearTimeout(escalation);writeFileSync(join(evidence,'run.json'),JSON.stringify(row,null,2));}
  console.log(JSON.stringify({evidence,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);
  const facts=JSON.parse(readFileSync(resultPath,'utf8'));assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));
  if(mode==='main'){assert.equal(facts.worker.actualExitCode,0);assert.equal(facts.worker.refused,true);assert.equal(facts.revoked,true);}
  else if(mode==='plain-node'&&facts.loaderRefused)assert.equal(facts.rolePredicateEvaluated,false);
  else assert.equal(facts.refused,true);
 }
 console.log(JSON.stringify({root,runs:runs.length,ownedRemaining:runs.filter(row=>!row.reaped).length,notProductionNativeClose:true}));
});
