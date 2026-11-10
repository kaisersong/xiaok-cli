import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('actual Main issuer owns its same original C session through one native loader',{skip:process.platform!=='darwin',timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-main-session-'));assert.ok(process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS);
 const electron=await getNativeTestElectronExecutable(repo),fixture=join(repo,'tests/native/fixtures/root-resource-main-session.cjs');
 const external=process.env.XIAOK_MAIN_SESSION_TEST_ADDON;
 const domain=external?process.env.XIAOK_MAIN_SESSION_TEST_DOMAIN:join(root,'domain'),addon=external||join(root,'resource-main.node');assert.ok(domain);
 const factsFile=join(root,'facts.h');
 // The actual original metadata API supplies data bytes only, not Main or
 // product subject authority. The finite constructor is compile-only.
 if(!external){
  const {createRootResourceJournal}=await import(join(repo,'desktop/dist/main/desktop/electron/desktop-root-resource-store.js'));
  const authority={},proof={},context={requestSource:'scheduler',authority},file=join(root,'metadata.sqlite');
  const fact={executionKey:'fixture-main-queued',payloadHash:'1'.repeat(64),executionClass:'kswarm_direct',priorityClass:'human_followup',scope:{profileId:'fixture-profile',workspaceId:'fixture-workspace',principalId:'fixture-principal'},subject:{kind:'kswarm_task',projectId:'fixture-project',taskId:'fixture-task',runId:'fixture-run'},authorizationRef:'fixture-original-data'};
  const original=createRootResourceJournal({path:file,authority,issuer:{hostId:'fixture-host',hostBootId:'fixture-boot',runtimeEpoch:1},verifySubject(value){if(value!==proof)throw Error('metadata member');return fact;},isEligible(){return true;},verifyExit(){throw Error('no exit grant');}});
  try{original.enqueueRoot(proof,context);}finally{original.close(context);}
  const read=new DatabaseSync(file,{readOnly:true});let row;try{row=read.prepare('SELECT execution_key,metadata_json FROM root_resources').get();}finally{read.close();}
  writeFileSync(factsFile,'static const char *nr_fixture_metadata[]={'+JSON.stringify(row.metadata_json)+'};\nstatic const char *nr_fixture_execution_keys[]={'+JSON.stringify(row.execution_key)+'};\nstatic const int nr_fixture_priorities[]={1};\n#define NR_FIXTURE_FACT_COUNT 1\n');
  mkdirSync(domain);const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,process.env.XIAOK_MAIN_SESSION_TEST_BASELINE?'baseline':'embedded',factsFile],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 }
 if(!process.env.XIAOK_MAIN_SESSION_TEST_BASELINE){
  const symbols=spawnSync('nm',['-gU',addon],{encoding:'utf8'});assert.equal(symbols.status,0,symbols.stderr);
  assert.match(symbols.stdout,/_node_register_module_v140\b/);assert.match(symbols.stdout,/_nr_init_resource_authority\b/);
  assert.doesNotMatch(symbols.stdout,/_napi_register_module_v1\b|_node_api_module_get_api_version_v1\b/);
 }
 // One actual binary, including its fixed DB domain, is shared by all roles.
 // Negative roles run before Main creates its legitimate database.
 for(const mode of ['run-as-node','node','main',...(!external?['main-revoked']:[])]){
  const evidence=join(root,mode);mkdirSync(evidence);
  let actualAddon=addon,actualDomain=domain;
  if(mode==='main-revoked'){
   actualDomain=join(evidence,'domain');mkdirSync(actualDomain);actualAddon=join(evidence,'revoked.node');
   const built=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,actualAddon,actualDomain,'embedded',factsFile],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  }
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;if(mode==='run-as-node')env.ELECTRON_RUN_AS_NODE='1';
  const resultPath=join(evidence,'facts.json'),exe=mode==='node'?process.execPath:electron,args=[fixture,mode,actualAddon,actualDomain,resultPath,join(evidence,'userData')];
  const child=spawn(exe,args,{env,stdio:['ignore','pipe','pipe']});const birth=spawnSync('ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim();
  const row={mode,pid:child.pid,birth,argv:[exe,...args],signals:[],stdout:'',stderr:''};writeFileSync(join(evidence,'birth.json'),JSON.stringify(row,null,2));child.stdout.on('data',x=>{row.stdout+=x;});child.stderr.on('data',x=>{row.stderr+=x;});
  let escalation;const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGKILL');child.kill('SIGKILL');}},2000);}},20000);
  try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{row.code=code;row.signal=signal;row.reaped=true;yes();});});}finally{clearTimeout(timer);clearTimeout(escalation);writeFileSync(join(evidence,'run.json'),JSON.stringify(row,null,2));}
  console.log(JSON.stringify({evidence,...row}));assert.equal(row.code,0,row.stderr);assert.deepEqual(row.signals,[]);const facts=JSON.parse(readFileSync(resultPath,'utf8'));assert.equal(facts.pid,child.pid);assert.equal(facts.ok,true,JSON.stringify(facts));
 }
 console.log(JSON.stringify({root,notProductNQualification:true}));
});
