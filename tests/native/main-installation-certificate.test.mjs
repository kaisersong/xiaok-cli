import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,existsSync,statSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),native=join(repo,'native/main-installation');
const env={PATH:'/usr/bin:/bin',LC_ALL:'C'};
const sourceFiles=['native/main-installation/main-installation-helper.c','native/main-installation/main-installation-entry.c','native/main-installation/main-installation-certifier.c','native/main-installation/installation-closure.h','native/main-installation/installation-release.h','native/main-installation/installation-certificate.h','native/main-installation/protocol.h','native/main-installation/wire.c','native/main-installation/wire.h','native/main-installation/root-store-state.h','native/main-installation/root-store-io.h','native/main-installation/authority-family-io.h','scripts/build-main-installation-artifacts.mjs','tests/native/main-installation-certificate.test.mjs','tests/native/fixtures/main-installation-certificate-component.c','tests/native/fixtures/main-installation-certificate-fsync-fault.c','tests/native/fixtures/main-installation-certificate-close-fault.c'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(join(repo,file))).digest('hex')]));
const sourceBefore=sourceHashes();after(()=>{assert.deepEqual(sourceHashes(),sourceBefore);console.log(JSON.stringify({kind:'certificate-source-closure',sourceHashes:sourceBefore,guiSpawns:0,rootInstalls:0,notProductionQualification:true}));});
function run(command,args,options={}){
 const child=spawnSync(command,args,{env,encoding:'utf8',...options});
 console.log(JSON.stringify({kind:'certificate-owned-child',command,args,pid:child.pid,status:child.status,signal:child.signal,reaped:child.pid!==undefined,stdout:child.stdout,stderr:child.stderr}));
 return child;
}
function root(){const path=realpathSync(mkdtempSync(join(tmpdir(),'mi-certificate-')));mkdirSync(join(path,'config'),{mode:0o700});return path;}
function write(path,body,mode=0o600){writeFileSync(path,body,{mode});}
function fixtureApp(base,architecture){
 const app=join(base,'input.app');mkdirSync(join(app,'Contents','MacOS'),{recursive:true,mode:0o700});
 write(join(app,'Contents','Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>xiaok</string><key>CFBundleIdentifier</key><string>com.xiaok.desktop</string></dict></plist>');
 const source=join(base,'main.c');write(source,'int main(void){return 0;}\n');const result=run('/usr/bin/cc',[...(architecture?['-arch',architecture]:[]),source,'-o',join(app,'Contents','MacOS','xiaok')]);assert.equal(result.status,0,result.stderr);symlinkSync('xiaok',join(app,'Contents','MacOS','relative-alias'));return app;
}
const darwin={skip:process.platform!=='darwin'};
test('artifact generator builds real production-kind programs in a private output without launching or changing the input app',darwin,()=>{
 const base=root(),app=fixtureApp(base),out=join(base,'payload');
 const result=run(process.execPath,[join(repo,'scripts/build-main-installation-artifacts.mjs'),'--app',app,'--out',out],{env:{...env,XIAOK_CONFIG_DIR:join(base,'config')}});
 assert.equal(result.status,0,result.stderr);
 const receipt=JSON.parse(readFileSync(join(out,'receipt.json'),'utf8'));
 assert.equal(receipt.buildKind,0);assert.equal(receipt.installed,false);assert.equal(receipt.signed,false);assert.equal(receipt.guiSpawns,0);
 for(const name of ['main-installation-helper','main-installation-entry','main-installation-certifier'])assert.ok(statSync(join(out,name)).isFile());
 const denied=run(join(out,'main-installation-certifier'),[],{env:{...env,MI_FIXED_ROOT:base,SUDO_UID:'0',XIAOK_CONFIG_DIR:join(base,'config')}});
 assert.equal(denied.status,77);assert.match(denied.stderr,/MI_CERTIFIER_PRIVILEGE_REQUIRED/);
 assert.equal(existsSync(join(out,'installation.bin')),false);
});
function component(base,extra=[],fixture='main-installation-certificate-component.c'){
 const installed=join(base,'installed');mkdirSync(join(installed,'Xiaok.app','Contents','MacOS'),{recursive:true,mode:0o700});
 const header=join(base,'configuration.h');write(header,`#define MI_FIXED_ROOT ${JSON.stringify(installed)}\n#define MI_MAIN_BUNDLE MI_FIXED_ROOT "/Xiaok.app"\n#define MI_MAIN_EXEC MI_MAIN_BUNDLE "/Contents/MacOS/xiaok"\n#define MI_LAUNCHER_EXEC MI_FIXED_ROOT "/main-installation-entry"\n#define MI_HELPER_EXEC MI_FIXED_ROOT "/main-installation-helper"\n#define MI_CERTIFIER_EXEC MI_FIXED_ROOT "/main-installation-certifier"\n`);
 const target=join(installed,'main-installation-certifier');
 const compiled=run('/usr/bin/cc',['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-DMI_INSTALLATION_CERT_COMPONENT_BUILD=1','-DMI_CONFIGURATION_HEADER='+JSON.stringify(header),...extra,join(repo,'tests/native/fixtures',fixture),join(native,'wire.c'),'-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',target]);
 assert.equal(compiled.status,0,compiled.stderr);
 for(const file of [join(installed,'Xiaok.app','Contents','MacOS','xiaok'),join(installed,'main-installation-helper'),join(installed,'main-installation-entry')])write(file,Buffer.from('actual private fixture bytes\n'),0o500);
 return {installed,target};
}
test('fixture-only certificate generation writes real bytes and a repeat does not overwrite or grant production',darwin,()=>{
 const base=root(),c=component(base),file=join(c.installed,'installation.bin');
 const first=run(c.target,[],{env:{...env,XIAOK_CONFIG_DIR:join(base,'config')}});assert.equal(first.status,0,first.stderr);
 const before=readFileSync(file),identity=statSync(file);assert.equal(before.length,120);assert.equal(before.subarray(0,8).toString(),'XMTEST01');
 const second=run(c.target,[],{env:{...env,XIAOK_CONFIG_DIR:join(base,'config')}});assert.equal(second.status,78);assert.match(second.stderr,/ALREADY_PRESENT/);
 assert.deepEqual(readFileSync(file),before);assert.equal(statSync(file).ino,identity.ino);
 console.log(JSON.stringify({kind:'fixture-only-certificate',sha256:createHash('sha256').update(before).digest('hex'),notProductionCertificate:true,notInstalled:true}));
});

test('component crashes preserve pending or published bytes and never remint on retry (expected negatives)',darwin,()=>{
 for(const phase of [1,2,3,4]){
  const base=root(),c=component(base,['-DMI_CERTIFICATE_STOP_PHASE='+phase]);
  const first=run(c.target,[]);assert.equal(first.status,91);
  const file=join(c.installed,phase===4?'installation.bin':'installation.bin.pending'),before=readFileSync(file),identity=statSync(file);
  assert.equal(before.length,phase===1?0:120);
  const retry=run(c.target,[]);assert.equal(retry.status,78);assert.match(retry.stderr,phase===4?/ALREADY_PRESENT/:/INCOMPLETE/);
  assert.deepEqual(readFileSync(file),before);assert.equal(statSync(file).ino,identity.ino);
 }
});
test('real fsync followed by EIO retains first failure and actual file without rollback (expected negative)',darwin,()=>{
 const base=root(),c=component(base,[],'main-installation-certificate-fsync-fault.c'),file=join(c.installed,'installation.bin.pending');
 const failed=run(c.target,[]);assert.equal(failed.status,78);assert.match(failed.stderr,/REAL_FSYNC_THEN_EIO/);assert.match(failed.stderr,/errno=5:unknown=1:published=0/);assert.equal(readFileSync(file).length,120);
 const before=readFileSync(file);const retry=run(c.target,[]);assert.equal(retry.status,78);assert.match(retry.stderr,/INCOMPLETE/);assert.match(retry.stderr,/unknown=1/);assert.deepEqual(readFileSync(file),before);assert.equal(existsSync(join(c.installed,'installation.bin')),false);
});
test('production codec rejects every non-v1 magic and non-120 length, including fixture certificates',darwin,()=>{
 const base=root(),source=join(base,'codec.c'),target=join(base,'codec');
 const unit=`#define _DARWIN_C_SOURCE\n#define main ignored_certifier_main\n#include ${JSON.stringify(join(native,'main-installation-certifier.c'))}\n#undef main\nint main(void){unsigned char b[121]={0};memcpy(b,"XMINST01",8);mi_certificate_p32(b+8,1);mi_certificate_p32(b+12,502);memcpy(b+80,"12345678-1234-1234-1234-123456789abc",36);mi_certificate_p32(b+116,31);if(!mi_certificate_decode(b,120,0))return 81;for(size_t n=0;n<=121;n++)if(n!=120&&mi_certificate_decode(b,n,0))return 82;for(size_t i=0;i<8;i++)for(unsigned c=0;c<256;c++){unsigned char prior=b[i];if(c==prior)continue;b[i]=(unsigned char)c;if(mi_certificate_decode(b,120,0))return 83;b[i]=prior;}memcpy(b,"XMTEST01",8);if(mi_certificate_decode(b,120,0)||!mi_certificate_decode(b,120,1))return 84;return 0;}\n`;
 write(source,unit);const compiled=run('/usr/bin/cc',['-std=c11','-Werror','-Wno-deprecated-declarations',source,join(native,'wire.c'),'-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',target]);assert.equal(compiled.status,0,compiled.stderr);assert.equal(run(target,[]).status,0);
});

test('wrong actual Main architecture is rejected before building a mixed payload (expected negative)',darwin,()=>{
 const base=root(),other=process.arch==='arm64'?'x86_64':'arm64',app=fixtureApp(base,other),out=join(base,'payload');
 const denied=run(process.execPath,[join(repo,'scripts/build-main-installation-artifacts.mjs'),'--app',app,'--out',out]);
 assert.equal(denied.status,1);assert.match(denied.stderr,/TARGET_ARCHITECTURE_UNSUPPORTED/);assert.equal(existsSync(out),false);
});
test('builder rejects ASCII escape, source overlap and external symlinks without changing the source (expected negatives)',darwin,()=>{
 for(const name of ['../xiaok','xiaok\u0301','..']){
  const base=root(),app=fixtureApp(base),info=join(app,'Contents','Info.plist'),out=join(base,'payload');write(info,readFileSync(info,'utf8').replace('<string>xiaok</string>',`<string>${name}</string>`));
  const before=readFileSync(info);const denied=run(process.execPath,[join(repo,'scripts/build-main-installation-artifacts.mjs'),'--app',app,'--out',out]);assert.equal(denied.status,1);assert.match(denied.stderr,/EXECUTABLE_BASENAME/);assert.deepEqual(readFileSync(info),before);assert.equal(existsSync(out),false);
 }
 const base=root(),app=fixtureApp(base);const overlap=run(process.execPath,[join(repo,'scripts/build-main-installation-artifacts.mjs'),'--app',app,'--out',join(app,'output')]);assert.equal(overlap.status,1);assert.match(overlap.stderr,/OUTPUT_UNAVAILABLE/);assert.equal(existsSync(join(app,'output')),false);
 const external=join(base,'external');write(external,'do not touch');symlinkSync(external,join(app,'escape'));const denied=run(process.execPath,[join(repo,'scripts/build-main-installation-artifacts.mjs'),'--app',app,'--out',join(base,'escaped')]);assert.equal(denied.status,1);assert.match(denied.stderr,/SOURCE_LINK_ESCAPE/);assert.equal(readFileSync(external,'utf8'),'do not touch');
});
test('post-close failure retains exact failed FD and first errno while attempting all cleanup (expected negative)',darwin,()=>{
 const base=root(),c=component(base,[],'main-installation-certificate-close-fault.c');const failed=run(c.target,[]);
 assert.equal(failed.status,78);assert.match(failed.stderr,/REAL_CLOSE_THEN_EIO/);assert.match(failed.stderr,/FAILED_CLOSE:fd=\d+:errno=5/);assert.match(failed.stderr,/errno=5:unknown=1:published=0/);assert.equal(readFileSync(join(c.installed,'installation.bin.pending')).length,120);assert.equal(existsSync(join(c.installed,'installation.bin')),false);
});
test('two actual component writers race the same exclusive pending file and only one publishes',darwin,async()=>{
 const base=root(),c=component(base,['-DMI_CERTIFICATE_COMPONENT_BARRIER=1']);
 function start(){const child=spawn(c.target,[],{env,stdio:['pipe','pipe','pipe']}),row={pid:child.pid,stdout:'',stderr:'',code:null,signal:null,reaped:false,watchdog:false};let ready;const entered=new Promise(yes=>{ready=yes;});const timer=setTimeout(()=>{if(!row.reaped){row.watchdog=true;child.kill('SIGTERM');}},10000);child.stdout.on('data',raw=>{row.stdout+=raw;if(row.stdout.includes('READY\n'))ready();});child.stderr.on('data',raw=>{row.stderr+=raw;});const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{clearTimeout(timer);Object.assign(row,{code,signal,reaped:true});console.log(JSON.stringify({kind:'certificate-concurrent-owned-child',...row}));yes(row);});});return {child,row,entered,closed};}
 const a=start(),b=start();try{await Promise.all([a,b].map(item=>Promise.race([item.entered,item.closed.then(()=>{throw Error('component exited before READY: '+item.row.stderr);})])));a.child.stdin.end('G');b.child.stdin.end('G');const rows=await Promise.all([a.closed,b.closed]);assert.deepEqual(rows.map(row=>row.code).sort(),[0,78]);assert.ok(rows.every(row=>row.signal===null));assert.equal(readFileSync(join(c.installed,'installation.bin')).length,120);}
 finally{for(const item of [a,b])if(!item.row.reaped){item.child.kill('SIGTERM');await item.closed;}}
});

test('an ignored ancestor close post-error is sticky and prevents every certificate write (expected negative)',darwin,()=>{
 const base=root(),c=component(base,['-DMI_CERTIFICATE_ANCESTOR_CLOSE=1'],'main-installation-certificate-close-fault.c');
 const denied=run(c.target,[]);assert.equal(denied.status,78);assert.match(denied.stderr,/FAILED_CLOSE:fd=\d+:errno=5/);assert.match(denied.stderr,/unknown=1/);assert.equal(existsSync(join(c.installed,'installation.bin.pending')),false);assert.equal(existsSync(join(c.installed,'installation.bin')),false);
});

test('the actual certifier non-Apple compile branch rejects without platform SDK facts',darwin,()=>{
 const base=root(),target=join(base,'unsupported');const built=run('/usr/bin/cc',['-std=c11','-Werror','-U__APPLE__',join(native,'main-installation-certifier.c'),'-o',target]);assert.equal(built.status,0,built.stderr);const denied=run(target,[]);assert.equal(denied.status,77);assert.match(denied.stderr,/PLATFORM_UNAVAILABLE/);console.log(JSON.stringify({kind:'compile-only-platform-branch',hostPlatform:process.platform,notWindowsOrLinuxRuntimeQualification:true}));
});
