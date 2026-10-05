import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const buildSource=process.env.XIAOK_TEST_NATIVE_BUILD_SOURCE??path.join(repository,'scripts/verification/build-windows-absence.mjs');
const executeSource=process.env.XIAOK_TEST_NATIVE_EXECUTE_SOURCE??path.join(repository,'scripts/verification/test-windows-absence.mjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['windows-installation-absence.exe','windows-installation-absence.json'];
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-native-build-contract-'))),directory=path.join(root,'scripts','verification');fs.mkdirSync(directory,{recursive:true});
 for(const [input,name] of [[buildSource,'build-windows-absence.mjs'],[executeSource,'test-windows-absence.mjs'],[path.join(repository,'scripts/verification/copy-windows-absence.mjs'),'copy-windows-absence.mjs']])fs.copyFileSync(input,path.join(directory,name));
 fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
 const source=path.join(root,'src','runtime','verification','native');fs.mkdirSync(source,{recursive:true});
 for(const name of ['windows-installation-absence.c','windows-installation-absence-core.h'])fs.copyFileSync(path.join(repository,'src','runtime','verification','native',name),path.join(source,name));
 fs.writeFileSync(path.join(source,'windows-absence-core.h'),'deliberately different legacy header');
 return {root,source,script:path.join(directory,'build-windows-absence.mjs'),execute:path.join(directory,'test-windows-absence.mjs'),out:arch=>path.join(root,'data','verification','windows',`win32-${arch}`),close(){fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}};
}
function payload(f,arch='x64',directory=f.out(arch)){
 fs.mkdirSync(directory,{recursive:true});const bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\0\0',128);bytes.writeUInt16LE(arch==='x64'?0x8664:0xaa64,132);
 fs.writeFileSync(path.join(directory,names[0]),bytes);fs.writeFileSync(path.join(directory,names[1]),JSON.stringify({version:1,target:`win32-${arch}`,sha256:sha(bytes),sourceSha256:sha(fs.readFileSync(path.join(f.source,'windows-installation-absence.c'))),coreSha256:sha(fs.readFileSync(path.join(f.source,'windows-installation-absence-core.h')))}));return bytes;
}
function run(f,{args=['--target','x64','--compiler','fixed-clang'],platform='darwin',arch='arm64',machine='ARM64',machineError=false,behavior='success',execute=false,importOnly=false}={}){
 const script=execute?f.execute:f.script,launcher=path.join(f.root,'launcher.mjs'),resultFile=path.join(f.root,'result.json');
 fs.writeFileSync(launcher,`import fs from 'node:fs';import os from 'node:os';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';
Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});Object.defineProperty(process,'arch',{value:${JSON.stringify(arch)}});os.machine=()=>{if(${machineError})throw Error('native machine unavailable');return ${JSON.stringify(machine)}};
const scriptURL=pathToFileURL(${JSON.stringify(script)}).href;const originalWrite=fs.writeFileSync;let fsCalls=0;let spawns=[];for(const key of ['readFileSync','lstatSync','mkdirSync','mkdtempSync','writeFileSync','renameSync','openSync','unlinkSync','rmSync']){const fn=fs[key];fs[key]=(...a)=>{if((new Error().stack??'').includes(scriptURL))fsCalls++;return fn(...a)}}
cp.spawnSync=(command,argv,options)=>{spawns.push({command,argv,options});
 if(${execute})return {status:argv.length?2:0,signal:null,stdout:Buffer.from(JSON.stringify({version:1,kind:argv.length?'unavailable':'ordinary'})),stderr:Buffer.alloc(0)};
 const output=argv.find(a=>a.startsWith('/Fe:'))?.slice(4)??argv[argv.indexOf('-o')+1];const input=argv.find(a=>a.endsWith('windows-installation-absence.c'));let captured;
 if(input)captured={file:input,source:fs.readFileSync(input,'utf8'),core:fs.readFileSync(new URL('./windows-installation-absence-core.h',pathToFileURL(input)),'utf8')};
 spawns.at(-1).captured=captured;
 if(${JSON.stringify(behavior)}==='error')return {error:Error('compiler unavailable'),status:null,signal:null,stdout:'',stderr:''};
 if(${JSON.stringify(behavior)}==='timeout')return {error:Object.assign(Error('compiler timeout'),{code:'ETIMEDOUT'}),status:null,signal:'SIGTERM',stdout:'',stderr:''};
 if(${JSON.stringify(behavior)}==='nonzero')return {status:7,signal:null,stdout:'',stderr:'compiler rejected'};
 if(${JSON.stringify(behavior)}==='signal')return {status:null,signal:'SIGTERM',stdout:'',stderr:''};
 const bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\\0\\0',128);bytes.writeUInt16LE(${args.includes('arm64')?0xaa64:0x8664},132);
 if(${JSON.stringify(behavior)}==='wrong-machine')bytes.writeUInt16LE(${args.includes('arm64')?0x8664:0xaa64},132);
 if(${JSON.stringify(behavior)}==='text')bytes.fill(65);originalWrite(output,bytes);
 if(${JSON.stringify(behavior)}==='source-change')originalWrite(${JSON.stringify(path.join(f.source,'windows-installation-absence.c'))},'changed during compilation');
 if(${JSON.stringify(behavior)}==='snapshot-change')originalWrite(input,'changed private snapshot');
 if(${JSON.stringify(behavior)}==='core-change')originalWrite(${JSON.stringify(path.join(f.source,'windows-installation-absence-core.h'))},'changed canonical header during compilation');
 if(${JSON.stringify(behavior)}==='core-snapshot-change')originalWrite(new URL('./windows-installation-absence-core.h',pathToFileURL(input)),'changed private header snapshot');
 return {status:0,signal:null,stdout:'compiled fixture',stderr:''};};syncBuiltinESMExports();
process.argv=[process.execPath,${JSON.stringify(importOnly?launcher:script)},...${JSON.stringify(args)}];
try{await import(scriptURL);originalWrite(${JSON.stringify(resultFile)},JSON.stringify({success:true,fsCalls,spawns}));}catch(error){originalWrite(${JSON.stringify(resultFile)},JSON.stringify({success:false,fsCalls,spawns,message:String(error)}));process.exitCode=1;}
`);
 const result=spawnSync(process.execPath,[launcher],{cwd:f.root,encoding:'utf8',timeout:5000});assert.ifError(result.error);assert.equal(result.signal,null);assert.ok(fs.existsSync(resultFile),result.stderr);return {...JSON.parse(fs.readFileSync(resultFile,'utf8')),status:result.status};
}
function withFixture(fn){const f=fixture();try{fn(f);}finally{f.close();}}
function noOutput(f){assert.equal(fs.existsSync(path.join(f.root,'data')),false);}
function previous(f){payload(f);return names.map(name=>fs.readFileSync(path.join(f.out('x64'),name)));}
function unchanged(f,bytes){assert.deepEqual(names.map(name=>fs.readFileSync(path.join(f.out('x64'),name))),bytes);}

test('builder import initializes without filesystem or child effects',()=>withFixture(f=>{const r=run(f,{importOnly:true});assert.equal(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
for(const args of [['--unknown'],['--target'],['--target','ia32'],['--target','x64','--target','arm64'],['--compiler'],['--compiler','a','--compiler','b'],['--compiler','a','--toolchain-archive','b'],['--toolchain-archive'],['--compiler','bad.cmd']])test(`builder strict arguments ${args.join(' ')}`,()=>withFixture(f=>{const r=run(f,{args});assert.notEqual(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
for(const [arch,machine,machineError] of [['x64','ARM64',false],['arm64','AMD64',false],['x64','unknown',false],['ia32','AMD64',false],['x64','AMD64',true]])test(`builder native gate ${arch}/${machine}/${machineError}`,()=>withFixture(f=>{const r=run(f,{platform:'win32',arch,machine,machineError});assert.notEqual(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
test('archive compilation denies nonWindows before filesystem',()=>withFixture(f=>{const r=run(f,{args:['--target','x64','--toolchain-archive','missing.zip']});assert.notEqual(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
test('archive compilation denies native ARM host before filesystem',()=>withFixture(f=>{const r=run(f,{platform:'win32',arch:'arm64',machine:'ARM64',args:['--target','arm64','--toolchain-archive','missing.zip']});assert.notEqual(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
for(const target of ['x64','arm64'])test(`diagnostic ${target} compiles only private exact snapshots and publishes exact5 false receipt`,()=>withFixture(f=>{const original=fs.readFileSync(path.join(f.source,'windows-installation-absence.c'),'utf8'),core=fs.readFileSync(path.join(f.source,'windows-installation-absence-core.h'),'utf8');const r=run(f,{args:['--target',target,'--compiler','fixed-clang']});assert.equal(r.status,0,r.message);assert.equal(r.spawns.length,1);const c=r.spawns[0];assert.notEqual(c.captured.file,path.join(f.source,'windows-installation-absence.c'));assert.equal(c.captured.source,original);assert.equal(c.captured.core,core);assert.equal(fs.existsSync(c.captured.file),false);for(const flag of ['-std=c11','-Wall','-Wextra','-Werror','-static','-fstack-protector-all','-mguard=cf','-Wl,--dynamicbase','-Wl,--nxcompat','-lshell32','-lole32','-ladvapi32','-luuid'])assert.ok(c.argv.includes(flag),flag);assert.equal(c.options.shell,false);const m=JSON.parse(fs.readFileSync(path.join(f.out(target),names[1])));assert.deepEqual(Object.keys(m).sort(),['coreSha256','sha256','sourceSha256','target','version']);assert.equal(m.target,`win32-${target}`);assert.equal(m.sha256,sha(fs.readFileSync(path.join(f.out(target),names[0]))));const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'.artifacts','p3r','windows-native',`build-${target}.json`)));for(const key of ['releaseQualified','controllerQualified','executedOnWindows','dependencyCustodyVerified','peSecurityQualified'])assert.equal(receipt[key],false,key);}));
test('MSVC diagnostic keeps GS/CFG and actual SDK libraries',()=>withFixture(f=>{const r=run(f,{platform:'win32',arch:'x64',machine:'AMD64',args:['--target','x64','--compiler','cl.exe']});assert.equal(r.status,0,r.message);for(const flag of ['/GS','/guard:cf','/DYNAMICBASE','/NXCOMPAT','/GUARD:CF','shell32.lib','ole32.lib','advapi32.lib','uuid.lib'])assert.ok(r.spawns[0].argv.includes(flag),flag);}));
for(const behavior of ['error','timeout','nonzero','signal','wrong-machine','text','source-change','snapshot-change','core-change','core-snapshot-change'])test(`diagnostic ${behavior} denies without replacing prior valid output`,()=>withFixture(f=>{const bytes=previous(f),r=run(f,{behavior});assert.notEqual(r.status,0);unchanged(f,bytes);assert.equal(fs.existsSync(r.spawns[0]?.captured?.file??''),false);}));
for(const member of names)test(`diagnostic rejects partial old output ${member} before compiler`,()=>withFixture(f=>{previous(f);fs.unlinkSync(path.join(f.out('x64'),member));const r=run(f);assert.notEqual(r.status,0);assert.equal(r.spawns.length,0);}));
test('diagnostic rejects stale prior manifest before compiler',()=>withFixture(f=>{previous(f);const file=path.join(f.out('x64'),names[1]),m=JSON.parse(fs.readFileSync(file));m.sourceSha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(m));const r=run(f);assert.notEqual(r.status,0);assert.equal(r.spawns.length,0);}));
test('diagnostic destination junction does not modify foreign referent',()=>withFixture(f=>{const foreign=path.join(f.root,'foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'keep'),'original');fs.mkdirSync(path.dirname(f.out('x64')),{recursive:true});fs.symlinkSync(foreign,f.out('x64'),'junction');const r=run(f);assert.notEqual(r.status,0);assert.equal(r.spawns.length,0);assert.deepEqual(fs.readdirSync(foreign),['keep']);assert.equal(fs.readFileSync(path.join(foreign,'keep'),'utf8'),'original');}));
test('diagnostic destination hardlink does not modify foreign referent',()=>withFixture(f=>{previous(f);const foreign=path.join(f.root,'foreign');fs.linkSync(path.join(f.out('x64'),names[0]),foreign);const bytes=fs.readFileSync(foreign),r=run(f);assert.notEqual(r.status,0);assert.equal(r.spawns.length,0);assert.deepEqual(fs.readFileSync(foreign),bytes);}));
for(const [arch,machine,machineError] of [['x64','ARM64',false],['arm64','ARM64',false],['x64','unknown',false],['ia32','AMD64',false],['x64','AMD64',true]])test(`real execution native gate ${arch}/${machine}/${machineError}`,()=>withFixture(f=>{const r=run(f,{execute:true,args:[],platform:'win32',arch,machine,machineError});assert.notEqual(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
test('real execution rejects caller arguments before filesystem',()=>withFixture(f=>{const r=run(f,{execute:true,args:['--path','override'],platform:'win32',arch:'x64',machine:'AMD64'});assert.notEqual(r.status,0);assert.equal(r.fsCalls,0);assert.equal(r.spawns.length,0);noOutput(f);}));
test('real execution uses canonical header/extraargv2/three bounded calls and sentinel env',()=>withFixture(f=>{payload(f);const bytes=names.map(name=>fs.readFileSync(path.join(f.out('x64'),name))),r=run(f,{execute:true,args:[],platform:'win32',arch:'x64',machine:'x86_64'});assert.equal(r.status,0,r.message);assert.equal(r.spawns.length,3);assert.deepEqual(r.spawns.map(c=>c.argv),[[],[],['unexpected-override']]);for(const c of r.spawns){assert.equal(c.options.timeout,5000);assert.equal(c.options.maxBuffer,4096);assert.equal(c.options.shell,false);assert.equal(c.command,path.join(f.out('x64'),names[0]));}assert.equal(typeof r.spawns[1].options.env.ProgramData,'string');unchanged(f,bytes);const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'.artifacts','p3r','windows-native','execution-x64.json')));assert.equal(receipt.observations[2].exitCode,2);assert.equal(receipt.controllerQualified,false);assert.equal(receipt.releaseQualified,false);assert.equal(receipt.nativeMachine,'x86_64');}));
for(const size of [32,190725905])test(`archive rejects untrusted ${size} bytes before extraction/compiler`,()=>withFixture(f=>{const archive=path.join(f.root,'bad.zip'),fd=fs.openSync(archive,'wx');try{fs.ftruncateSync(fd,size);}finally{fs.closeSync(fd);}const r=run(f,{platform:'win32',arch:'x64',machine:'AMD64',args:['--target','x64','--toolchain-archive',archive]});assert.notEqual(r.status,0);assert.equal(r.spawns.length,0);assert.match(r.message,/archive|publisher|size|SHA|hash/i);noOutput(f);}));
for(const machine of ['AMD64','x86_64'])test(`matching native diagnostic ${machine} retains normal build`,()=>withFixture(f=>{const r=run(f,{platform:'win32',arch:'x64',machine});assert.equal(r.status,0,r.message);assert.equal(r.spawns.length,1);}));

test('read-only CI uploads all hidden diagnostic receipts alongside both target data',()=>{
 const workflow=fs.readFileSync(path.join(repository,'.github','workflows','windows-verification-helper.yml'),'utf8');
 assert.match(workflow,/permissions:\s*\n\s+contents: read\s*\n/);assert.doesNotMatch(workflow,/contents:\s*write/);assert.match(workflow,/persist-credentials: false/);
 const upload=workflow.slice(workflow.indexOf('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'));
 assert.match(upload,/include-hidden-files: true/);assert.match(upload,/data\/verification\/windows\/win32-x64\//);assert.match(upload,/data\/verification\/windows\/win32-arm64\//);assert.match(upload,/\.artifacts\/p3r\/windows-native\/\*\.json/);assert.match(upload,/if-no-files-found: error/);
});
