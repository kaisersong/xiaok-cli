import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCoreKSwarmFixture,hashCoreFixture,coreFixtureTree} from './helpers/main-core-kswarm-fixture.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('actual original Main Core retains one genuine KSwarm port and cancels its unentered Source before Root closure',{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const prepared=process.env.XIAOK_CORE_KSWARM_PREPARED?JSON.parse(readFileSync(process.env.XIAOK_CORE_KSWARM_PREPARED,'utf8')):await prepareCoreKSwarmFixture(repo,process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS);
 const {root}=prepared,check=()=>{for(const [file,sha]of Object.entries({...prepared.sources,...prepared.artifacts}))assert.equal(hashCoreFixture(file),sha,'fixture source/artifact drift '+file);};check();
 const child=spawn(prepared.helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});
 const row={helperPid:child.pid,helperBirth:spawnSync('/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim(),stdout:'',stderr:'',signals:[],reaped:false};
 const save=()=>writeFileSync(join(root,'core-kswarm-main-run.json'),JSON.stringify(row,null,2)+'\n');save();let first,observed=false;
 child.stdout.on('data',value=>{row.stdout+=value.toString();for(const line of row.stdout.split('\n')){if(!line.startsWith('{')||!line.endsWith('}'))continue;let item;try{item=JSON.parse(line);}catch{continue;}if(item.event==='spawn')row.mainPid=item.pid;}
  if(!observed&&row.stdout.includes('"kind":"core-kswarm-main-ready"')){observed=true;try{const policy=spawnSync(prepared.policy,[String(row.mainPid)],{encoding:'utf8'});row.policyObserver={pid:policy.pid,status:policy.status,signal:policy.signal,stdout:policy.stdout,stderr:policy.stderr};assert.equal(policy.status,0,policy.stderr);row.policy=JSON.parse(policy.stdout);assert.equal(row.policy.pid,row.mainPid);assert.ok([1,2].includes(row.policy.activationPolicy));assert.equal(row.policy.executablePath,prepared.executable);}catch(raw){first={raw};}child.stdin.end('STOP\n');save();}
 });child.stderr.on('data',value=>{row.stderr+=value.toString();});
 const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});
 const watchdog=setTimeout(()=>{if(!row.reaped){const pid=row.mainPid||row.helperPid;row.signals.push({pid,signal:'SIGTERM'});try{process.kill(pid,'SIGTERM');}catch(raw){first??={raw};}}},25000);
 try{await closed;}finally{clearTimeout(watchdog);save();}if(first)throw first.raw;assert.equal(row.code,0,row.stdout+row.stderr);assert.equal(row.signal,null);assert.deepEqual(row.signals,[]);assert.equal(observed,true);
 const records=row.stdout.split('\n').filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)),facts=records.find(v=>v.kind==='original-core-kswarm-main');assert.ok(facts);assert.equal(records.filter(v=>v.event==='spawn').length,1);assert.equal(facts.failed,false);assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);assert.equal(facts.launches,0);assert.equal(facts.publicNativeReplacementCalls,0);assert.equal(facts.foreignLeaseTraps,0);assert.equal(facts.productionQualified,false);
 for(const name of ['actualMain','sameOriginalPort','activeTerminalDenied','sameOriginalPortAfterClose','coreClosed','homeEnvironmentUnchanged','nativeIdentityPreserved'])assert.equal(facts[name],true,name);
 const reaped=records.find(v=>v.event==='reaped');assert.equal(reaped.pid,facts.pid);assert.equal(reaped.status,0);assert.equal(reaped.unknown,false);check();assert.deepEqual(coreFixtureTree(prepared.registry),prepared.registryBefore);assert.deepEqual(coreFixtureTree(prepared.receipt.source),prepared.receipt.sourceTree);
 writeFileSync(join(root,'core-kswarm-postflight.json'),JSON.stringify({sourcesUnchanged:true,realRegistryUnchanged:true,sourceBundleUnchanged:true,mainPid:facts.pid,helperPid:row.helperPid,productionQualified:false},null,2));console.log(JSON.stringify({kind:'core-kswarm-main-complete',root,mainPid:facts.pid,helperPid:row.helperPid,windows:0,productionQualified:false}));
});
