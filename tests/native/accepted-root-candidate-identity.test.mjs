import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(join(repo,'package.json'));

test('candidate observation preserves exact original Services bytes and rejects source drift',async()=>{
 const api=await import('./helpers/accepted-root-candidate-observation.mjs');
 const raw=readFileSync(join(repo,'desktop/electron/desktop-services.ts'));
 const url=pathToFileURL(join(tmpdir(),'accepted-root-candidate-observation.mjs')).href;
 const transformed=api.instrumentOriginalCandidateServices(raw,url);
 assert.deepEqual(api.restoreOriginalCandidateServices(transformed.contents,url),raw);
 assert.equal(transformed.targets,2);
 assert.throws(()=>api.instrumentOriginalCandidateServices(Buffer.concat([raw,Buffer.from('\n')]),url),/SOURCE_SHA/);
});
test('candidate observation retains original opaque references without inspecting getters or proxies',async()=>{
 const root=mkdtempSync(join(tmpdir(),'candidate-observer-unit-')),output=join(root,'accepted-root-candidate-observation.mjs');
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/helpers/accepted-root-candidate-observation.ts')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
 const api=await import(pathToFileURL(output).href);
 let traps=0;const proof=new Proxy(Object.defineProperty({},'hidden',{get(){traps++;throw undefined;}}),{get(){traps++;throw undefined;},getOwnPropertyDescriptor(){traps++;throw undefined;},ownKeys(){traps++;throw undefined;}});
 api.recordOriginalCandidate('kswarm_direct',proof);assert.equal(api.readLastOriginalCandidate('kswarm_direct'),proof);assert.equal(traps,0);
 api.recordOriginalCandidate('room_project',undefined);assert.equal(api.readLastOriginalCandidate('room_project'),undefined);assert.equal(traps,0);
});

// The parent deliberately reads the unpatched, actual OS account directory.
import {userInfo} from 'node:os';
import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readlinkSync,existsSync} from 'node:fs';
import {assertElectronNativeTargetSymbols} from './helpers/electron-native-target-abi.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function physicalTree(file){
 try{
  const s=lstatSync(file,{bigint:true}),fact={path:file,dev:String(s.dev),ino:String(s.ino),mode:String(s.mode),size:String(s.size)};
  if(s.isSymbolicLink())return {...fact,link:readlinkSync(file)};
  if(s.isFile())return {...fact,sha256:digest(readFileSync(file))};
  if(s.isDirectory())return {...fact,entries:readdirSync(file).sort().map(name=>physicalTree(join(file,name)))};
  return fact;
 }catch(error){if(error.code==='ENOENT')return {path:file,absent:true};throw error;}
}
function realProfile(){
 const base=join(userInfo().homedir,'.xiaok','profile-sources');
 return {registry:physicalTree(join(base,'registry.json')),fences:physicalTree(join(base,'writer-fences'))};
}
const sourceFiles=[
 'tests/native/fixtures/accepted-root-candidate-identity.cjs','tests/native/fixtures/accepted-root-binding-entry.ts',
 'tests/native/helpers/accepted-root-candidate-observation.mjs','tests/native/helpers/accepted-root-candidate-observation.ts',
 'desktop/tests/support/owned-workflow-child-account-preload.mjs','desktop/tests/support/owned-workflow-network-fixture.mjs',
 'desktop/electron/desktop-services.ts','desktop/electron/kswarm-runtime-bridge.ts','desktop/electron/room-workspace-runtime.ts',
 'desktop/electron/main-room-root-admission.ts','native/root-resource-authority/main-bootstrap.cc',
 'native/root-resource-authority/root_resource_authority.c',
];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,digest(readFileSync(join(repo,file)))]));
for(const kind of ['direct','room'])test(`actual Native ${kind} candidate identity, cross-kind rejection and lifetime`,{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const root=mkdtempSync(join(tmpdir(),`xiaok-candidate-${kind}-`)),domain=join(root,'domain'),addon=join(root,'root_resource_authority_main.node'),bundle=join(root,'component.mjs'),observer=join(root,'accepted-root-candidate-observation.mjs');
 mkdirSync(domain,{mode:0o700});const sources=hashes(),profileBefore=realProfile();
 writeFileSync(join(root,'before.json'),JSON.stringify({sources,realProfile:profileBefore},null,2));
 const build=spawnSync(process.execPath,[join(repo,'native/root-resource-authority/build-main-session.mjs'),process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,addon,domain,'embedded'],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr||build.stdout);
 await require('esbuild').build({entryPoints:[join(repo,'tests/native/helpers/accepted-root-candidate-observation.ts')],outfile:observer,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {originalCandidateObservationPlugin}=await import('./helpers/accepted-root-candidate-observation.mjs');
 const compiled=await require('esbuild').build({entryPoints:[join(repo,'tests/native/fixtures/accepted-root-binding-entry.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,plugins:[originalCandidateObservationPlugin(repo,pathToFileURL(observer).href)],external:[pathToFileURL(observer).href],banner:{js:"import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"}});
 symlinkSync(join(repo,'desktop/node_modules'),join(root,'node_modules'));
 const electron=await getNativeTestElectronExecutable(repo);assertElectronNativeTargetSymbols(addon,electron,join(root,'target-abi.json'));
 const inputHashes=Object.fromEntries(Object.keys(compiled.metafile.inputs).map(file=>{const full=resolve(file);return [full,digest(readFileSync(full))];}));
 const artifacts=Object.fromEntries([addon,bundle,observer].map(file=>[file,digest(readFileSync(file))]));
 assert.deepEqual(hashes(),sources);const result=join(root,'facts.json'),env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 const args=[join(repo,'tests/native/fixtures/accepted-root-candidate-identity.cjs'),bundle,domain,result,join(root,'userData'),repo,kind];
 const child=spawn(electron,args,{env,stdio:['ignore','pipe','pipe']}),row={pid:child.pid,argv:[electron,...args],signals:[],stdout:'',stderr:'',sources,artifacts,inputHashes};
 writeFileSync(join(root,'birth.json'),JSON.stringify(row,null,2));child.stdout.on('data',v=>{row.stdout+=v;});child.stderr.on('data',v=>{row.stderr+=v;});
 let escalation;const watchdog=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGTERM');child.kill('SIGTERM');escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){row.signals.push('SIGKILL');child.kill('SIGKILL');}},2000);}},45000);
 try{await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});}
 finally{clearTimeout(watchdog);clearTimeout(escalation);row.profileAfter=realProfile();writeFileSync(join(root,'run.json'),JSON.stringify(row,null,2));}
 const facts=existsSync(result)?JSON.parse(readFileSync(result,'utf8')):null;console.log(JSON.stringify({root,pid:row.pid,argv:row.argv,signals:row.signals,code:row.code,signal:row.signal,reaped:row.reaped,stdout:row.stdout,stderr:row.stderr,profileAfter:row.profileAfter,facts}));
 assert.deepEqual(row.profileAfter,profileBefore,'actual OS account registry and writer-fences must remain unchanged');
 assert.deepEqual(hashes(),sources);for(const [file,sha]of Object.entries(inputHashes))assert.equal(digest(readFileSync(file)),sha,file);for(const[file,sha]of Object.entries(artifacts))assert.equal(digest(readFileSync(file)),sha,file);
 assert.equal(row.code,0,JSON.stringify(facts));assert.deepEqual(row.signals,[]);assert.equal(facts.ok,true);assert.equal(facts.pid,child.pid);assert.equal(facts.actualMain,true);assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);assert.equal(facts.productionQualified,false);assert.equal(facts.noBinderValidCandidates,0);assert.equal(facts.observerRetainsProof,true);assert.equal(facts.account.environmentUnchanged,true);assert.equal(facts.account.homeIsPrivate,true);assert.equal(facts.ownedChild.code,0);assert.equal(facts.networkChild.exitCode,0);assert.equal(facts.networkChild.protectionTriggered,false);
 if(kind==='room'){assert.equal(facts.physicalClosureConfirmed,true);assert.equal(facts.resourceRows.length,1);assert.equal(facts.resourceRows[0].state,'released');}
 else{assert.equal(facts.resourceRows.length,1);assert.ok(['reserved','released'].includes(facts.resourceRows[0].state));}
});
