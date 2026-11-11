import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,symlinkSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {prepareMainInstalledFixture} from './helpers/main-installed-fixture.mjs';
import {buildMainProtectedSqliteFixture} from './helpers/main-protected-sqlite-fixture.mjs';
import {getProtectedNmpSqlFixtureAssets} from './helpers/protected-nmp-sql-assets.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
test('protected Core drives original HTTPS M and retains unknown M across a read-only cold restart',
 {skip:process.platform!=='darwin',timeout:90000},async()=>{
  const sources={};
  for(const directory of ['native/root-resource-authority','native/main-installation'])for(const name of readdirSync(join(repo,directory))){const file=join(directory,name);if(/\.(?:c|cc|h|mjs|json)$/.test(name)&&lstatSync(join(repo,file)).isFile())sources[file]=hash(join(repo,file));}
  for(const file of ['tests/native/fixtures/protected-core-model-sdk.cjs','tests/native/fixtures/protected-core-model-sdk-entry.ts','tests/native/protected-core-model-sdk.test.mjs'])sources[file]=hash(join(repo,file));
  const prepared=await prepareMainInstalledFixture(repo,process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,{authorityFamilies:true});
  const {root}=prepared,bundle=join(root,'protected-core-sdk.mjs');
  const built=await createRequire(import.meta.url)('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/protected-core-model-sdk-entry.ts')],outdir:root,entryNames:'protected-core-sdk',outExtension:{'.js':'.mjs'},splitting:true,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"}});
  // Main reads config through new URL('./credential-worker.js',import.meta.url); production emits it beside the module via tsconfig.electron.json.
  const worker=await createRequire(import.meta.url)('esbuild').build({entryPoints:[join(repo,'src/utils/credential-worker.ts')],outfile:join(root,'credential-worker.js'),bundle:true,platform:'node',format:'cjs',packages:'external',metafile:true,define:{'import.meta.url':'fixtureWorkerUrl'},banner:{js:"const fixtureWorkerUrl=require('node:url').pathToFileURL(__filename).href;"}});
  const bundleSources=Object.fromEntries([...Object.keys(built.metafile.inputs),...Object.keys(worker.metafile.inputs)].filter(file=>!file.startsWith('<')).map(file=>[resolve(repo,file),hash(resolve(repo,file))]));
  symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
  writeFileSync(prepared.entry,`require(${JSON.stringify(join(repo,'tests/native/fixtures/protected-core-model-sdk.cjs'))})(${JSON.stringify({root,bundle,repo,nativeRoot:prepared.nativeRoot})});\n`);
  const finite=join(root,'sdk-finite.h');writeFileSync(finite,getProtectedNmpSqlFixtureAssets().finiteHeader);
  const args=[join(repo,'native/root-resource-authority/build-main-session.mjs'),prepared.builds[1].args[1],prepared.embedded,prepared.nativeRoot,'embedded',finite,prepared.configuration];
  const compiled=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8'});writeFileSync(join(root,'sdk-native-build.json'),JSON.stringify({pid:compiled.pid,args,status:compiled.status,signal:compiled.signal,stdout:compiled.stdout,stderr:compiled.stderr},null,2));assert.equal(compiled.status,0,compiled.stderr);
  const facade=buildMainProtectedSqliteFixture(repo,prepared.builds[1].args[1],join(root,'protected_sqlite.node'),prepared.configuration,{electronExecutable:prepared.executable});
  const artifacts=Object.fromEntries([prepared.helper,prepared.embedded,prepared.standalone,prepared.entry,prepared.configuration,bundle,finite,...Object.keys(built.metafile.outputs).map(file=>resolve(repo,file)),...Object.keys(worker.metafile.outputs).map(file=>resolve(repo,file))].map(file=>[file,hash(file)]));Object.assign(artifacts,facade.artifacts);
  const check=()=>{for(const [file,digest] of Object.entries(sources))assert.equal(hash(join(repo,file)),digest,file);for(const [file,digest] of Object.entries({...bundleSources,...artifacts,...facade.sources}))assert.equal(hash(file),digest,file);};
  writeFileSync(join(root,'sdk-source-hashes.json'),JSON.stringify({sources,bundleSources,artifacts,facadeSources:facade.sources},null,2));
  console.log(JSON.stringify({kind:'protected-core-sdk-prepared',root,executable:prepared.executable,phases:['fresh','restored']}));
  const results=[];
  for(const phase of ['fresh','restored']){
   check();const child=spawn(prepared.helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});
   const row={phase,helperPid:child.pid,stdout:'',stderr:'',signals:[],reaped:false};results.push(row);
   const save=()=>writeFileSync(join(root,'sdk-runs.json'),JSON.stringify(results,null,2));save();
   child.stdout.on('data',value=>{row.stdout+=value;save();});child.stderr.on('data',value=>{row.stderr+=value;});
   const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});
   const timer=setTimeout(()=>{row.signals.push('SIGTERM');child.kill('SIGTERM');},30000);
   try{await closed;}finally{clearTimeout(timer);if(!row.reaped){row.signals.push('SIGTERM');child.kill('SIGTERM');await closed;}save();}
   console.log(JSON.stringify({root,phase,...row}));
   assert.equal(row.signal,null,row.stderr);assert.deepEqual(row.signals,[]);
   const records=row.stdout.split('\n').filter(value=>value.startsWith('{')).map(value=>JSON.parse(value));
   const births=records.filter(value=>value.event==='spawn'),exits=records.filter(value=>value.event==='reaped');assert.equal(births.length,1);assert.equal(exits.length,1);assert.equal(exits[0].status,0,row.stderr);
   const facts=JSON.parse(readFileSync(join(root,'protected-core-model-'+phase+'.json'),'utf8'));
   assert.equal(facts.pid,births[0].pid);assert.equal(facts.actualMain,true);assert.equal(facts.failed,false,JSON.stringify(facts.first));assert.equal(facts.productionQualified,false);assert.equal(facts.protectedAdmission,true);assert.equal(facts.noLegacyRoot,true);assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);assert.equal(facts.historyPersisted,true);assert.equal(facts.openSockets,0);assert.equal(facts.getterHits,0);
   assert.equal(facts.rows.length,2);assert.equal(facts.rows.filter(value=>value.state==='released').length,1);assert.equal(facts.rows.filter(value=>value.state==='reserved'||value.state==='unknown').length,1);
   if(phase==='fresh'){
    assert.equal(facts.modelConstructs,2);assert.ok(facts.serverRequests>=1&&facts.serverRequests<=2);assert.equal(facts.explicitRestartWithHeld,true);assert.ok(row.code===0||row.code===79,'known retained helper unknown is not clean close');
   }else{assert.equal(facts.modelConstructs,0);assert.equal(facts.serverRequests,0);assert.equal(facts.coldNoNewSdk,true);assert.equal(row.code,0);assert.equal(exits[0].unknown,false);}
   check();
  }
  console.log(JSON.stringify({root,phases:results.map(value=>value.phase),productionQualified:false,readonlyCovered:false,actualHttpsSdkConstructs:2,coldSdkConstructs:0}));
 });
