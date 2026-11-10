import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('original Node Worker binds the private backing store and runs synchronous protected SQL on the same client', {skip:process.platform!=='darwin'||!['127','137'].includes(process.versions.modules)},async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'rsc-')));mkdirSync(join(root,'config'),{mode:0o700});
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation');
 const node=join(root,'node'),entry=join(root,'entry.cjs'),addon=join(root,'protected_sqlite.node'),launcher=join(root,'launcher'),helper=join(root,'helper'),header=join(root,'configuration.h');
 copyFileSync(process.execPath,node);chmodSync(node,0o500);
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const sources=[...['installed-main-client.c','installed-main-client.h','installed-budget-worker-io.h','budget-worker-native-bridge.cc','root-store-io.h','root-store-io-codec.h','root-store-io-dispatch.h','original-root-io-vfs.c','original-root-io-vfs.h'].map(f=>join(native,f)),...['protocol.h','wire.h','wire.c','main-installation-helper.c','main-installation-entry.c','root-store-state.h','root-store-io.h','authority-family-io.h'].map(f=>join(wire,f)),...['protected-sqlite-facade.c','protected-sqlite-facade.h','index.cjs'].map(f=>join(repo,'native/protected-sqlite-facade',f)),join(repo,'tests/native/fixtures/installed-budget-node-worker.cjs')];
 const before=Object.fromEntries(sources.map(f=>[f,hash(f)]));
 writeFileSync(header,[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',node],['MI_MAIN_BUNDLE',node],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',hash(node)],['MI_FIXTURE_MAIN_ENTRY',entry]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join('')+'#define MI_FIXTURE_AUTHORITY_SCOPES 1\n');
 copyFileSync(join(repo,'native/protected-sqlite-facade/index.cjs'),join(root,'index.cjs'));
 copyFileSync(join(repo,'tests/native/fixtures/installed-budget-node-worker.cjs'),join(root,'worker.cjs'));
 writeFileSync(entry,`process.env.XIAOK_CONFIG_DIR=${JSON.stringify(join(root,'config'))};
const {Worker}=require('node:worker_threads');const {once}=require('node:events');const addon=require(${JSON.stringify(addon)});
(async()=>{const carrier=addon.componentPrepareBudgetWorker();let earlyCloseDenied=false;try{addon.componentCloseBudgetWorker(carrier);}catch{earlyCloseDenied=true;}if(!earlyCloseDenied)throw Error('EARLY_CORE_CLOSE_ACCEPTED');const getter=Object.getOwnPropertyDescriptor(Worker.prototype,'threadId').get;
const worker=new Worker(${JSON.stringify(join(root,'worker.cjs'))},{workerData:{addon:${JSON.stringify(addon)},adapter:${JSON.stringify(join(root,'index.cjs'))},carrier},execArgv:[]});
const finished=once(worker,'exit');const message=once(worker,'message');const actualId=Reflect.apply(getter,worker,[]);addon.componentPublishBudgetWorker(carrier,actualId);
const [facts]=await message;const [exitCode]=await finished;if(exitCode!==0)throw Error('ACTUAL_WORKER_EXIT_FAILED');const closed=addon.componentCloseBudgetWorker(carrier);console.log(JSON.stringify({kind:'protected-worker-component',actualId,exitCode,facts,earlyCloseDenied,...closed}));
})().catch(raw=>{globalThis.heldOriginalError=raw;const d=Object.getOwnPropertyDescriptors(raw);console.error(JSON.stringify({kind:'protected-worker-component-failed',message:d.message?.value,code:d.code?.value,stack:d.stack?.value}));process.exitCode=1;});
`);

 const sdk=spawnSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'});assert.equal(sdk.status,0,sdk.stderr);
 const common=['-Werror','-Wno-deprecated-declarations','-isysroot',sdk.stdout.trim(),'-I',process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(process.execPath),'../include/node'),'-I',native,'-I',join(repo,'native/protected-sqlite-facade'),'-DMI_FIXTURE_BUILD=1','-DNR_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1','-DNR_MAIN_INSTALLATION_COMPONENT=1','-DNR_MAIN_BOOTSTRAP_EMBEDDED=1','-DNR_FIXTURE_ROOT='+JSON.stringify(root),'-DMI_CONFIGURATION_HEADER='+JSON.stringify(header),'-DNAPI_VERSION=8'];
 const builds=[];const build=(exe,args)=>{const r=spawnSync(exe,args,{encoding:'utf8'});builds.push({exe,args,pid:r.pid,code:r.status,signal:r.signal,stderr:r.stderr});writeFileSync(join(root,'builds.json'),JSON.stringify(builds,null,2));assert.equal(r.status,0,r.stderr);};
 const objects=[];for(const name of ['installed-main-client.c','original-root-io-vfs.c','../main-installation/wire.c','../protected-sqlite-facade/protected-sqlite-facade.c']){const o=join(root,objects.length+'.o');build('/usr/bin/cc',[...common,'-std=c11','-c',join(native,name),'-o',o]);objects.push(o);}
 build('/usr/bin/c++',[...common,'-std=c++20','-bundle','-undefined','dynamic_lookup',...(process.config.variables.v8_enable_pointer_compression?['-DV8_COMPRESS_POINTERS']:[]),...(process.config.variables.v8_enable_sandbox?['-DV8_ENABLE_SANDBOX']:[]),join(native,'budget-worker-native-bridge.cc'),...objects,'-lsqlite3','-framework','Security','-lbsm','-o',addon]);
 for(const [source,output] of [['main-installation-entry.c',launcher],['main-installation-helper.c',helper]]){build('/usr/bin/cc',[...common,'-std=c11',join(wire,source),join(wire,'wire.c'),'-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',output]);chmodSync(output,0o500);}
 assert.deepEqual(Object.fromEntries(sources.map(f=>[f,hash(f)])),before,'actual source changed during compilation');writeFileSync(join(root,'source-hashes.json'),JSON.stringify(before,null,2));
 const run=async (label,expectedError)=>{const child=spawn(helper,[],{env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:join(root,'config')},stdio:['ignore','pipe','pipe']});const row={label,pid:child.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false};child.stdout.on('data',b=>row.stdout+=b);child.stderr.on('data',b=>row.stderr+=b);const done=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{Object.assign(row,{code,signal,reaped:true});yes();});});const timer=setTimeout(()=>child.kill('SIGTERM'),20000);try{await done;}finally{clearTimeout(timer);if(!row.reaped){child.kill('SIGTERM');await done;}writeFileSync(join(root,label+'.json'),JSON.stringify(row,null,2));console.log(JSON.stringify({root,...row}));}assert.equal(row.signal,null,row.stderr);if(expectedError){assert.notEqual(row.code,0,row.stderr);assert.ok(row.stderr.includes(expectedError),row.stderr);assert.ok(row.stdout.includes('\"event\":\"spawn\"'),row.stdout);assert.ok(row.stdout.includes('\"event\":\"reaped\"'),row.stdout);return null;}assert.equal(row.code,0,row.stderr);const facts=row.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x)).find(x=>x.kind==='protected-worker-component');assert.ok(facts);assert.equal(facts.productionQualified,false);assert.equal(facts.rootFilesClosed,true);assert.equal(facts.unknown,false);assert.equal(facts.exitCode,0);assert.equal(facts.facts.spent,17);assert.equal(facts.facts.proxyTraps,0);assert.equal(facts.facts.foreignCarrierRejected,true);assert.equal(facts.earlyCloseDenied,true);assert.equal(facts.facts.replayDenied,true);assert.equal(facts.facts.namespaceSetterTraps,0);assert.equal(facts.facts.spoofedPublicThreadId,999999);return facts;};
 await run('node-worker');
});
