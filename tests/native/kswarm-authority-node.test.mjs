import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,chmodSync,copyFileSync,cpSync,readdirSync,statSync,existsSync,constants} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
for(const scenario of ['normal','no_explicit_finish'])test('original fixed Native child bootstrap drives the original Node Hub and protected KS persistence: '+scenario,{skip:process.platform!=='darwin'},async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ks-node-source-'))),ks=join(root,'kswarm'),runtime=join(ks,'runtime');mkdirSync(join(root,'config'),{mode:0o700});mkdirSync(runtime,{recursive:true});
 const sibling=realpathSync(process.env.XIAOK_KSWARM_SOURCE_TEST_REPO||resolve(repo,'../kswarm'));
 console.log(JSON.stringify({kind:'ks-original-node-source-test',root,sibling}));
 const captured={};function source(path){path=realpathSync(path);if(captured[path])return;const st=statSync(path,{bigint:true});captured[path]={sha256:hash(path),bytes:Number(st.size),mtimeNs:String(st.mtimeNs)};if(/\.(c|h)$/.test(path)){for(const m of readFileSync(path,'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)){const child=[resolve(dirname(path),m[1]),...include.map(d=>join(d,m[1]))].find(existsSync);if(child)source(child);}}}
 function tree(dir){for(const d of readdirSync(dir,{withFileTypes:true})){const p=join(dir,d.name);if(d.isDirectory())tree(p);else if(d.isFile())source(p);else throw Error('fixture source symlink rejected');}}
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation'),facade=join(repo,'native/protected-sqlite-facade'),ksNative=join(repo,'native/kswarm-authority-source');
 const cache=join(homedir(),'Library/Caches/node-gyp');const version=[process.versions.node,...readdirSync(cache).filter(v=>/^\d+\.\d+\.\d+$/.test(v))].find(v=>existsSync(join(cache,v,'include/node/node_api.h')));assert.ok(version,'actual Node N-API headers required');const headers=join(cache,version,'include/node'),include=[native,wire,facade,ksNative,headers];
 tree(join(sibling,'src'));source(join(sibling,'package.json'));cpSync(join(sibling,'src'),join(ks,'src'),{recursive:true});copyFileSync(join(sibling,'package.json'),join(ks,'package.json'));
 const node=join(root,'node');copyFileSync(realpathSync(process.execPath),node,constants.COPYFILE_FICLONE);chmodSync(node,0o500);
 const main=join(root,'main'),launcher=join(root,'launcher'),ksLauncher=join(root,'ks-launcher'),helper=join(root,'helper'),entry=join(root,'entry.cjs'),configuration=join(root,'configuration.h');
 const addon=join(runtime,'protected_sqlite.node');copyFileSync(join(facade,'index.cjs'),join(runtime,'index.cjs'));copyFileSync(join(ksNative,'original-authority-sqlite.cjs'),join(runtime,'original-authority-sqlite.cjs'));
 const observer=join(repo,'tests/native/fixtures/kswarm-authority-node.cjs');source(observer);writeFileSync(entry,`require(${JSON.stringify(addon)}).consumeOriginalKSwarmSource();require(${JSON.stringify(observer)}).run(${JSON.stringify(root)},${JSON.stringify(ks)},${JSON.stringify(scenario)}).catch(error=>{console.error(error);process.exitCode=1;if(process.channel)process.disconnect();});\n`);
 let mainHash='0'.repeat(64);const header=()=>[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',main],['MI_MAIN_BUNDLE',main],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',mainHash],['MI_KSWARM_LAUNCHER_EXEC',ksLauncher],['MI_KSWARM_EXEC',node],['MI_KSWARM_ENTRY',entry],['MI_EXPECTED_KSWARM_SHA256',hash(node)]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join('');writeFileSync(configuration,header());
 const inputs=[join(native,'installed-main-client.c'),join(native,'original-root-io-vfs.c'),join(wire,'wire.c'),join(wire,'main-installation-entry.c'),join(wire,'main-installation-helper.c'),join(ksNative,'kswarm-child-launcher.c'),join(ksNative,'kswarm-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(facade,'index.cjs'),join(ksNative,'original-authority-sqlite.cjs'),join(repo,'tests/native/fixtures/kswarm-authority-child-live.c')];for(const p of inputs)source(p);
 const common=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations',...include.flatMap(p=>['-I',p]),'-DNAPI_VERSION=8','-DMI_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1','-DMI_FIXTURE_AUTHORITY_SCOPES=1','-DMI_FIXTURE_KSWARM_RUN_CHILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration)];const builds=[];
 const build=(files,out,extra=[])=>{const args=[...common,...files,...extra,'-lsqlite3','-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',out];const r=spawnSync('/usr/bin/cc',args,{cwd:repo,encoding:'utf8',timeout:30000});builds.push({args,pid:r.pid,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});writeFileSync(join(root,'builds.json'),JSON.stringify(builds,null,2));assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);chmodSync(out,0o500);};
 build([join(repo,'tests/native/fixtures/kswarm-authority-child-live.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],main);mainHash=hash(main);writeFileSync(configuration,header());
 build([join(wire,'main-installation-entry.c'),join(wire,'wire.c')],launcher);build([join(ksNative,'kswarm-child-launcher.c'),join(wire,'wire.c')],ksLauncher);build([join(wire,'main-installation-helper.c'),join(wire,'wire.c')],helper);
 build([join(ksNative,'kswarm-child-addon.c'),join(facade,'protected-sqlite-facade.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],addon,['-bundle','-undefined','dynamic_lookup']);
 const bundled=spawnSync(process.execPath,[join(repo,'native/sidecar-source-runtime/build.mjs'),join(runtime,'xiaok-source-runtime.cjs')],{cwd:repo,encoding:'utf8',timeout:30000});writeFileSync(join(root,'runtime-build.json'),JSON.stringify({pid:bundled.pid,status:bundled.status,stdout:bundled.stdout,stderr:bundled.stderr},null,2));assert.equal(bundled.status,0,bundled.stderr);
 for(const [p,before]of Object.entries(captured)){const st=statSync(p,{bigint:true});assert.equal(hash(p),before.sha256,'compile source drift');assert.equal(String(st.mtimeNs),before.mtimeNs,'compile source mtime drift');}writeFileSync(join(root,'source-manifest.json'),JSON.stringify(captured,null,2));
 const runs=[];
 for(let phase=0;phase<(scenario==='normal'?2:1);phase++){
 const p=spawn(helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:join(root,'config')},stdio:['ignore','pipe','pipe']});const actual={pid:p.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false};p.stdout.on('data',c=>actual.stdout+=c);p.stderr.on('data',c=>actual.stderr+=c);const closed=new Promise((yes,no)=>{p.once('error',no);p.once('close',(code,signal)=>{Object.assign(actual,{code,signal,reaped:true});yes();});});const timer=setTimeout(()=>p.kill('SIGTERM'),30000);
 try{await closed;}finally{clearTimeout(timer);if(!actual.reaped){p.kill('SIGTERM');await closed;}writeFileSync(join(root,'run-'+phase+'.json'),JSON.stringify(actual,null,2));console.log(JSON.stringify(actual));}
 assert.equal(actual.signal,null,actual.stderr);assert.equal(actual.code,scenario==='normal'?0:79,actual.stderr);const rows=actual.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));const hub=rows.find(x=>x.kind==='ks-original-node-hub');assert.ok(hub,actual.stdout);assert.equal(hub.ordinaryDatabaseAbsent,true);const core=rows.find(x=>x.kind==='ks-fixed-native-core-component');if(scenario==='normal'){assert.equal(core.failure,0);assert.equal(core.rootFilesClosed,true);assert.equal(core.unknown,false);}else{assert.ok(rows.find(x=>x.kind==='ks-node-premature-exit'&&x.exitCode===0));assert.equal(core.failure,12);assert.equal(core.rootFilesClosed,false);assert.equal(core.unknown,true);}
 runs.push(rows);
 }
 if(scenario==='normal'){
  const pools=runs.map(rows=>rows.find(row=>row.kind==='ks-native-original-pool')),stores=runs.map(rows=>rows.find(row=>row.kind==='ks-original-node-hub').storeId);
  assert.equal(pools[0].fresh,true);assert.equal(pools[1].fresh,false);assert.equal(pools[0].poolId,pools[1].poolId);assert.equal(stores[0],stores[1]);
 }
 for(const [p,before]of Object.entries(captured)){const st=statSync(p,{bigint:true});assert.equal(hash(p),before.sha256,'runtime source drift');assert.equal(String(st.mtimeNs),before.mtimeNs,'runtime source mtime drift');}
});
