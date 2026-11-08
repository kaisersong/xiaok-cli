import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('fixed original KSwarm Native child producer rejects foreign Core before any child spawn',{skip:process.platform!=='darwin'},()=>{
 const root=mkdtempSync(join(tmpdir(),'ks-native-source-'));mkdirSync(join(root,'config'),{mode:0o700});console.log(JSON.stringify({kind:'ks-native-source-fixture',root}));
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation'),binary=join(root,'foreign');
 const args=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',native,'-I',wire,join(repo,'tests/native/fixtures/kswarm-authority-child.c'),join(native,'installed-main-client.c'),join(wire,'wire.c'),'-lsqlite3','-framework','Security','-framework','CoreFoundation','-lbsm','-o',binary];
 const compiled=spawnSync('/usr/bin/cc',args,{cwd:repo,encoding:'utf8',timeout:30000});writeFileSync(join(root,'compile.json'),JSON.stringify({args,pid:compiled.pid,status:compiled.status,signal:compiled.signal,stdout:compiled.stdout,stderr:compiled.stderr,error:compiled.error?.message},null,2));
 assert.equal(compiled.error,undefined);assert.equal(compiled.status,0,compiled.stderr);
 const actual=spawnSync(binary,[],{cwd:root,env:{...process.env,XIAOK_CONFIG_DIR:join(root,'config')},encoding:'utf8',timeout:15000});writeFileSync(join(root,'run.json'),JSON.stringify({pid:actual.pid,status:actual.status,signal:actual.signal,stdout:actual.stdout,stderr:actual.stderr,error:actual.error?.message},null,2));
 assert.equal(actual.error,undefined);assert.equal(actual.status,0,actual.stderr);assert.deepEqual(JSON.parse(actual.stdout),{foreignCoreRejected:true,childSpawns:0,productionQualified:false});
});


test('fixed original KSwarm Core preparation is once, holds Core close and permits original negative cancel',{skip:process.platform!=='darwin'},async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ks-native-live-')));mkdirSync(join(root,'config'),{mode:0o700});console.log(JSON.stringify({kind:'ks-native-source-live',root}));
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation');
 const child=join(root,'child'),launcher=join(root,'launcher'),helper=join(root,'helper'),configuration=join(root,'configuration.h');
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 const sources=['installed-main-client.c','installed-main-client.h','root-store-io.h','root-store-io-codec.h'].map(x=>join(native,x)).concat(['protocol.h','wire.h','wire.c','main-installation-helper.c','main-installation-entry.c','root-store-state.h','root-store-io.h','authority-family-io.h'].map(x=>join(wire,x)),join(repo,'native/kswarm-authority-source/kswarm-child-launch.h'),join(repo,'tests/native/fixtures/kswarm-authority-child-live.c'));
 const before=Object.fromEntries(sources.map(p=>[p,hash(p)]));
 const header=digest=>[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',child],['MI_MAIN_BUNDLE',child],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',digest]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join('');writeFileSync(configuration,header('0'.repeat(64)));
 const builds=[];const build=(input,output)=>{const args=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',native,'-I',wire,'-DMI_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1','-DMI_FIXTURE_AUTHORITY_SCOPES=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration),...input,'-lsqlite3','-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',output];const r=spawnSync('/usr/bin/cc',args,{cwd:repo,encoding:'utf8',timeout:30000});builds.push({args,pid:r.pid,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});writeFileSync(join(root,'builds.json'),JSON.stringify(builds,null,2));assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);chmodSync(output,0o500);};
 build([join(repo,'tests/native/fixtures/kswarm-authority-child-live.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],child);
 writeFileSync(configuration,header(hash(child)));build([join(wire,'main-installation-entry.c'),join(wire,'wire.c')],launcher);build([join(wire,'main-installation-helper.c'),join(wire,'wire.c')],helper);
 assert.deepEqual(Object.fromEntries(sources.map(p=>[p,hash(p)])),before);writeFileSync(join(root,'source-hashes.json'),JSON.stringify(before,null,2));
 const p=spawn(helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:join(root,'config')},stdio:['ignore','pipe','pipe']});const actual={pid:p.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false};p.stdout.on('data',c=>actual.stdout+=c);p.stderr.on('data',c=>actual.stderr+=c);
 const closed=new Promise((yes,no)=>{p.once('error',no);p.once('close',(code,signal)=>{Object.assign(actual,{code,signal,reaped:true});yes();});});const timer=setTimeout(()=>p.kill('SIGTERM'),20000);
 try{await closed;}finally{clearTimeout(timer);if(!actual.reaped){p.kill('SIGTERM');await closed;}writeFileSync(join(root,'run.json'),JSON.stringify(actual,null,2));console.log(JSON.stringify(actual));}
 assert.equal(actual.signal,null,actual.stderr);assert.equal(actual.code,0,actual.stderr);const rows=actual.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));assert.equal(rows.filter(x=>x.event==='spawn').length,1);assert.equal(rows.filter(x=>x.event==='reaped').length,1);const facts=rows.find(x=>x.kind==='ks-fixed-native-core-component');assert.ok(facts);assert.deepEqual(facts,{kind:'ks-fixed-native-core-component',failure:0,onceZeroIo:true,coreCloseHeld:true,negativeCleanupKnown:true,rootFilesClosed:true,unknown:false,productionQualified:false});
});

test('fixed original KSwarm Native launch authenticates an independent child and keeps fd3 business IPC',{skip:process.platform!=='darwin'},async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ks-native-live-')));mkdirSync(join(root,'config'),{mode:0o700});console.log(JSON.stringify({kind:'ks-native-source-live',root}));
 const native=join(repo,'native/root-resource-authority'),wire=join(repo,'native/main-installation');
 const child=join(root,'child'),launcher=join(root,'launcher'),helper=join(root,'helper'),configuration=join(root,'configuration.h'),ksChild=join(root,'ks-child'),ksLauncher=join(root,'ks-launcher');
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 const sources=['installed-main-client.c','installed-main-client.h','root-store-io.h','root-store-io-codec.h'].map(x=>join(native,x)).concat(['protocol.h','wire.h','wire.c','main-installation-helper.c','main-installation-entry.c','root-store-state.h','root-store-io.h','authority-family-io.h'].map(x=>join(wire,x)),join(repo,'native/kswarm-authority-source/kswarm-child-launch.h'),join(repo,'tests/native/fixtures/kswarm-authority-child-live.c'));
 const before=Object.fromEntries(sources.map(p=>[p,hash(p)]));
 let existsKsHash='0'.repeat(64);const header=digest=>[['MI_FIXED_ROOT',root],['MI_MAIN_EXEC',child],['MI_MAIN_BUNDLE',child],['MI_LAUNCHER_EXEC',launcher],['MI_EXPECTED_MAIN_SHA256',digest],['MI_KSWARM_LAUNCHER_EXEC',ksLauncher],['MI_KSWARM_EXEC',ksChild],['MI_EXPECTED_KSWARM_SHA256',existsKsHash]].map(([k,v])=>`#define ${k} ${JSON.stringify(v)}\n`).join('');writeFileSync(configuration,header('0'.repeat(64)));
 const builds=[];const build=(input,output)=>{const args=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-I',native,'-I',wire,'-DMI_FIXTURE_BUILD=1','-DNR_ROOT_IO_COMPONENT=1','-DMI_FIXTURE_AUTHORITY_SCOPES=1','-DMI_FIXTURE_KSWARM_COMPONENT=1','-DMI_FIXTURE_KSWARM_RUN_CHILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration),...input,'-lsqlite3','-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',output];const r=spawnSync('/usr/bin/cc',args,{cwd:repo,encoding:'utf8',timeout:30000});builds.push({args,pid:r.pid,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});writeFileSync(join(root,'builds.json'),JSON.stringify(builds,null,2));assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);chmodSync(output,0o500);};
 build([join(repo,'tests/native/fixtures/kswarm-authority-delegated.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],ksChild);existsKsHash=hash(ksChild);writeFileSync(configuration,header('0'.repeat(64)));build([join(repo,'native/kswarm-authority-source/kswarm-child-launcher.c'),join(wire,'wire.c')],ksLauncher);
 build([join(repo,'tests/native/fixtures/kswarm-authority-child-live.c'),join(native,'installed-main-client.c'),join(wire,'wire.c')],child);
 writeFileSync(configuration,header(hash(child)));build([join(wire,'main-installation-entry.c'),join(wire,'wire.c')],launcher);build([join(wire,'main-installation-helper.c'),join(wire,'wire.c')],helper);
 assert.deepEqual(Object.fromEntries(sources.map(p=>[p,hash(p)])),before);writeFileSync(join(root,'source-hashes.json'),JSON.stringify(before,null,2));
 const p=spawn(helper,[],{cwd:root,env:{PATH:'/usr/bin:/bin',XIAOK_CONFIG_DIR:join(root,'config')},stdio:['ignore','pipe','pipe']});const actual={pid:p.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false};p.stdout.on('data',c=>actual.stdout+=c);p.stderr.on('data',c=>actual.stderr+=c);
 const closed=new Promise((yes,no)=>{p.once('error',no);p.once('close',(code,signal)=>{Object.assign(actual,{code,signal,reaped:true});yes();});});const timer=setTimeout(()=>p.kill('SIGTERM'),20000);
 try{await closed;}finally{clearTimeout(timer);if(!actual.reaped){p.kill('SIGTERM');await closed;}writeFileSync(join(root,'run.json'),JSON.stringify(actual,null,2));console.log(JSON.stringify(actual));}
 assert.equal(actual.signal,null,actual.stderr);assert.equal(actual.code,0,actual.stderr);const rows=actual.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));assert.equal(rows.filter(x=>x.event==='spawn').length,1);assert.equal(rows.filter(x=>x.event==='reaped').length,1);const delegated=rows.find(x=>x.kind==='ks-fixed-delegated-child');assert.ok(delegated,actual.stdout);assert.equal(delegated.failure,0);assert.equal(delegated.businessFd3,true);assert.equal(delegated.rootDeniedZeroIo,true);const facts=rows.find(x=>x.kind==='ks-fixed-native-core-component');assert.ok(facts);assert.deepEqual(facts,{kind:'ks-fixed-native-core-component',failure:0,onceZeroIo:true,coreCloseHeld:true,negativeCleanupKnown:true,rootFilesClosed:true,unknown:false,productionQualified:false});
});
