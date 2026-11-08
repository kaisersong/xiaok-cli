import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync,lstatSync,readlinkSync,symlinkSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareMainInstalledFixture} from './helpers/main-installed-fixture.mjs';
import {getProtectedNmpSqlFixtureAssets} from './helpers/protected-nmp-sql-assets.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function tree(root){if(!existsSync(root))return null;const rows=[];function walk(file){const st=lstatSync(file),r={path:relative(root,file).split('\\').join('/'),mode:st.mode&0o7777};if(st.isSymbolicLink()){r.kind='symlink';r.target=readlinkSync(file);}else if(st.isDirectory())r.kind='directory';else if(st.isFile()){r.kind='file';r.bytes=st.size;r.sha256=hash(file);}else throw Error('fixture_tree_kind');rows.push(r);if(st.isDirectory())for(const name of readdirSync(file).sort())walk(join(file,name));}walk(root);return rows;}
test('actual protected Core reads complete same-pool N/M/P/gang/intent ledgers fresh and restored without mutation',
 {skip:process.platform!=='darwin',timeout:90000},async()=>{
 const dependencyRepo=process.env.XIAOK_ROOT_NMP_VALIDATION_DEPENDENCIES||repo;
 const {buildMainProtectedSqliteFixture}=await import(pathToFileURL(join(dependencyRepo,'tests/native/helpers/main-protected-sqlite-fixture.mjs')).href);
 const frozen=JSON.parse(readFileSync(process.env.XIAOK_ROOT_NMP_FROZEN_MANIFEST,'utf8'));
 const sources=Object.fromEntries(frozen.files.map(r=>[join(repo,r.path),r.sha256]));
 for(const directory of ['native/root-resource-authority','native/main-installation'])for(const name of readdirSync(join(repo,directory))){const file=join(repo,directory,name);if(/\.(?:c|cc|h|mjs|json)$/.test(name)&&lstatSync(file).isFile())sources[file]=hash(file);}
 for(const name of ['tests/native/fixtures/root-nmp-ledger-main.cjs','tests/native/fixtures/root-nmp-ledger-main-entry.ts','tests/native/fixtures/protected-nmp-sql-fragment.cjs','tests/native/helpers/main-installed-fixture.mjs','tests/native/helpers/electron-executable.mjs'])sources[join(repo,name)]=hash(join(repo,name));
 const realRegistry=join(homedir(),'.xiaok','profile-sources'),registryBefore=tree(realRegistry);
 const prepared=await prepareMainInstalledFixture(repo,process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,{authorityFamilies:true});
 const {root}=prepared,bundle=join(root,'ledger-core.mjs'),entry=join(repo,'tests/native/fixtures/root-nmp-ledger-main-entry.ts'),fragment=join(repo,'tests/native/fixtures/protected-nmp-sql-fragment.cjs');
 const built=await createRequire(import.meta.url)('esbuild').build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"}});
 for(const input of Object.keys(built.metafile.inputs))if(!input.startsWith('<'))sources[resolve(repo,input)]=hash(resolve(repo,input));
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 writeFileSync(prepared.entry,`require(${JSON.stringify(join(repo,'tests/native/fixtures/root-nmp-ledger-main.cjs'))})(${JSON.stringify({root,bundle,fragment})});\n`);
 const finite=join(root,'finite.h');writeFileSync(finite,getProtectedNmpSqlFixtureAssets().finiteHeader);
 const argv=[join(repo,'native/root-resource-authority/build-main-session.mjs'),prepared.builds[1].args[1],prepared.embedded,prepared.nativeRoot,'embedded',finite,prepared.configuration];
 const compiled=spawnSync(process.execPath,argv,{cwd:repo,encoding:'utf8'});writeFileSync(join(root,'ledger-native-build.json'),JSON.stringify({pid:compiled.pid,argv,status:compiled.status,signal:compiled.signal,stderr:compiled.stderr},null,2));assert.equal(compiled.status,0,compiled.stderr);
 const facade=buildMainProtectedSqliteFixture(dependencyRepo,prepared.builds[1].args[1],join(root,'protected_sqlite.node'),prepared.configuration,{electronExecutable:prepared.executable});
 Object.assign(sources,facade.sources);
 const policy=process.env.XIAOK_ROOT_NMP_POLICY_OBSERVER;assert.ok(policy);sources[policy]=hash(policy);
 const receiptFile=join(dirname(dirname(dirname(dirname(prepared.executable)))),'receipt.json'),receipt=JSON.parse(readFileSync(receiptFile,'utf8'));
 assert.equal(receipt.bundleIdentifier.startsWith('org.xiaok.native-test.cache.c'),true);
 const artifacts=Object.fromEntries([prepared.helper,prepared.standalone,prepared.embedded,prepared.entry,prepared.configuration,bundle,finite,receiptFile].map(file=>[file,hash(file)]));Object.assign(artifacts,facade.artifacts);
 const check=()=>{for(const [file,sha]of Object.entries({...sources,...artifacts}))assert.equal(hash(file),sha,'fixture source/artifact drift: '+file);};check();
 writeFileSync(join(root,'ledger-source-artifact-manifest.json'),JSON.stringify({sources,artifacts,dependencyRepo,registryBefore,realRegistry,executable:prepared.executable,copyIdentifier:receipt.bundleIdentifier,productionQualified:false},null,2));
 console.log(JSON.stringify({kind:'protected-ledger-prepared',root,copyIdentifier:receipt.bundleIdentifier,executable:prepared.executable,mainCount:2,windows:0,guiFixtureOnly:true}));
 const results=[];
 for(const phase of ['fresh','restored']){
  check();const child=spawn(prepared.helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['pipe','pipe','pipe']});
  const row={phase,helperPid:child.pid,helperBirth:spawnSync('/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).stdout.trim(),stdout:'',stderr:'',signals:[],reaped:false};results.push(row);
  const save=()=>writeFileSync(join(root,'ledger-main-runs.json'),JSON.stringify(results,null,2));save();let observed=false,first;
  child.stdout.on('data',data=>{
   row.stdout+=data.toString();for(const line of row.stdout.split('\n')){if(!line.startsWith('{')||!line.endsWith('}'))continue;let event;try{event=JSON.parse(line);}catch{continue;}if(event.event==='spawn'){row.mainPid=event.pid;save();}}
   if(!observed&&row.stdout.includes('"kind":"root-ledger-main-ready"')){
    observed=true;
    try{const native=spawnSync(policy,[String(row.mainPid)],{encoding:'utf8'});row.policyObserver={pid:native.pid,status:native.status,signal:native.signal,stdout:native.stdout,stderr:native.stderr};assert.equal(native.status,0,native.stderr);row.policy=JSON.parse(native.stdout);assert.equal(row.policy.pid,row.mainPid);assert.ok([1,2].includes(row.policy.activationPolicy));assert.equal(row.policy.executablePath,prepared.executable);}catch(raw){first={raw};}
    child.stdin.end('STOP\n');save();
   }
  });child.stderr.on('data',data=>{row.stderr+=data.toString();});
  const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});
  const watchdog=setTimeout(()=>{if(!row.reaped){if(row.mainPid){row.signals.push({pid:row.mainPid,signal:'SIGTERM'});try{process.kill(row.mainPid,'SIGTERM');}catch(raw){first??={raw};}}else{row.signals.push({pid:child.pid,signal:'SIGTERM'});child.kill('SIGTERM');}}},25000);
  try{await closed;}finally{clearTimeout(watchdog);save();}
  if(first)throw first.raw;assert.equal(row.code,0,row.stdout+row.stderr);assert.equal(row.signal,null);assert.deepEqual(row.signals,[]);assert.equal(observed,true);
  const events=row.stdout.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)),facts=events.find(e=>e.kind==='original-protected-core-ledger-main');assert.ok(facts);assert.equal(facts.failed,false);assert.equal(facts.phase,phase);assert.equal(facts.actualMain,true);assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);assert.equal(facts.productionQualified,false);assert.equal(facts.homeEnvironmentUnchanged,true);assert.equal(facts.nativeIdentityPreserved,true);
  for(const key of ['bytesUnchanged','readAfterSourceSeal','ownerReturned','budgetClosed','storeClosed','coreClosed'])assert.equal(facts[key],true,key);
  assert.equal(facts.counts.nUnknown,0);assert.equal(facts.counts.physicalUnknown,0);if(phase==='restored')assert.equal(facts.coldEntireLedgerUnchanged,true);
  const reap=events.find(e=>e.event==='reaped');assert.equal(reap.pid,facts.pid);assert.equal(reap.status,0);assert.equal(reap.unknown,false);check();
 }
 assert.equal(results[0].mainPid===results[1].mainPid,false);assert.deepEqual(tree(realRegistry),registryBefore);assert.deepEqual(tree(receipt.source),receipt.sourceTree);
 writeFileSync(join(root,'ledger-postflight.json'),JSON.stringify({sourcesUnchanged:true,realRegistryUnchanged:true,sourceBundleUnchanged:true,phases:results.map(r=>r.phase),mainPids:results.map(r=>r.mainPid),productionQualified:false},null,2));
 console.log(JSON.stringify({kind:'protected-ledger-actual-complete',root,mainPids:results.map(r=>r.mainPid),phases:results.map(r=>r.phase),productionQualified:false}));
});
