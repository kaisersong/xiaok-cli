import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The alternate input is a test-only frozen-stage baseline. It never reaches
// production argv, and the copied script runs unchanged inside the fixture repo.
const copySource = process.env.XIAOK_TEST_NATIVE_COPY_SOURCE ?? path.join(repository, 'scripts/verification/copy-windows-absence.mjs');
const hotfixSource = process.env.XIAOK_TEST_NATIVE_HOTFIX_SOURCE ?? path.join(repository, 'scripts/apply-windows-startup-hotfix.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['windows-installation-absence.exe', 'windows-installation-absence.json'];
function fixture() {
  // Use the real module pathname, as the script's CLI identity guard does.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-native-copy-contract-')));
  const script = path.join(root, 'scripts/verification/copy-windows-absence.mjs');
  fs.mkdirSync(path.dirname(script), {recursive:true}); fs.copyFileSync(copySource, script);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const source = path.join(root, 'src/runtime/verification/native'); fs.mkdirSync(source, {recursive:true});
  for (const name of ['windows-installation-absence.c', 'windows-installation-absence-core.h']) fs.writeFileSync(path.join(source,name),'fixed source fixture');
  const reader = path.join(root, 'dist/runtime/verification/windows-installation-absence.js');
  fs.mkdirSync(path.dirname(reader), {recursive:true});fs.writeFileSync(reader,'// emitted reader');
  return {root,script,reader,source,
    directory: arch => path.join(root, 'data/verification/windows', `win32-${arch}`),
    destination: arch => path.join(path.dirname(reader), 'native', `win32-${arch}`),
    close: () => fs.rmSync(root,{recursive:true,force:true,maxRetries:3})};
}
function artifact(f, arch, directory=f.directory(arch)) {
  fs.mkdirSync(directory,{recursive:true});
  const bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\0\0',128);bytes.writeUInt16LE(arch==='x64'?0x8664:0xaa64,132);
  const manifest={version:1,target:`win32-${arch}`,sha256:hash(bytes),sourceSha256:hash(fs.readFileSync(path.join(f.source,'windows-installation-absence.c'))),coreSha256:hash(fs.readFileSync(path.join(f.source,'windows-installation-absence-core.h')))};
  fs.writeFileSync(path.join(directory,names[0]),bytes);fs.writeFileSync(path.join(directory,names[1]),JSON.stringify(manifest));
  return bytes;
}
function run(f, {args=['cli'], platform='darwin', arch='arm64', machine='ARM64', machineError=false, options, hotfix=false}={}) {
  const script=hotfix?path.join(f.root,'scripts/apply-windows-startup-hotfix.mjs'):f.script;
  if(hotfix)fs.copyFileSync(hotfixSource,script);
  const launcher=path.join(f.root,'test-launcher.mjs'), resultFile=path.join(f.root,'test-result.json');
  // Count calls from the actual production body; module-loader reads occur
  // before that body and are outside the platform gate under test.
  fs.writeFileSync(launcher,`import fs from 'node:fs';import os from 'node:os';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';
Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});Object.defineProperty(process,'arch',{value:${JSON.stringify(arch)}});
os.machine=()=>{if(${machineError})throw Error('machine unavailable');return ${JSON.stringify(machine)}};
const write=fs.writeFileSync;let calls=0;for(const key of ['readFileSync','lstatSync','existsSync','mkdirSync','writeFileSync','copyFileSync','renameSync']){const original=fs[key];fs[key]=(...args)=>{if((new Error().stack??'').includes(pathToFileURL(${JSON.stringify(script)}).href))calls++;return original(...args)}}const spawn=childProcess.spawnSync;childProcess.spawnSync=(...args)=>{if((new Error().stack??'').includes(pathToFileURL(${JSON.stringify(script)}).href))calls++;return spawn(...args)};syncBuiltinESMExports();
process.argv=[process.execPath,${JSON.stringify(options === undefined ? script : launcher)},...${JSON.stringify(args)}];
try{const mod=await import(pathToFileURL(${JSON.stringify(script)}));${options === undefined ? '' : `mod.copyWindowsAbsence(${JSON.stringify(f.root)},${JSON.stringify(options)});`}write(${JSON.stringify(resultFile)},JSON.stringify({success:true,calls}));}
catch(error){write(${JSON.stringify(resultFile)},JSON.stringify({success:false,calls,message:String(error)}));process.exitCode=1;}
`);
  const child=spawnSync(process.execPath,[launcher],{cwd:f.root,encoding:'utf8',timeout:5000});
  assert.ifError(child.error);assert.equal(child.signal,null);
  const result=JSON.parse(fs.readFileSync(resultFile,'utf8'));return {...result,status:child.status};
}
function withFixture(fn){const f=fixture();try{fn(f);}finally{f.close();}}
function absent(f){assert.equal(fs.existsSync(path.join(path.dirname(f.reader),'native')),false);}

test('missing optional nonhost artifacts do not create output',()=>withFixture(f=>{assert.equal(run(f).status,0);absent(f);}));
test('zero arguments retain CLI compatibility',()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');assert.equal(run(f,{args:[]}).status,0);for(const arch of ['x64','arm64'])assert.equal(fs.existsSync(path.join(f.destination(arch),names[0])),true);}));
test('present single optional target is copied with exact bytes',()=>withFixture(f=>{const bytes=artifact(f,'x64');assert.equal(run(f).status,0);assert.deepEqual(fs.readFileSync(path.join(f.destination('x64'),names[0])),bytes);assert.deepEqual(fs.readFileSync(path.join(f.destination('x64'),names[1])),fs.readFileSync(path.join(f.directory('x64'),names[1])));assert.equal(fs.existsSync(f.destination('arm64')),false);}));
for(const args of [['cli','--check'],['cli','--require-all'],['cli','--require-all','--arch','x64']])test(`mandatory universal/check gate: ${args.join(' ')}`,()=>withFixture(f=>{artifact(f,'x64');assert.notEqual(run(f,{args}).status,0);absent(f);}));
for(const mode of ['--check','--require-all'])test(`${mode} rejects a missing emitted reader before output`,()=>withFixture(f=>{fs.unlinkSync(f.reader);artifact(f,'x64');artifact(f,'arm64');assert.notEqual(run(f,{args:['cli',mode]}).status,0);absent(f);}));
for(const [arch,machine] of [['x64','AMD64'],['x64','x86_64'],['arm64','ARM64'],['arm64','aarch64']])test(`native matching ${arch}/${machine} requires its selected payload`,()=>withFixture(f=>{assert.notEqual(run(f,{platform:'win32',arch,machine}).status,0);absent(f);artifact(f,arch);assert.equal(run(f,{platform:'win32',arch,machine}).status,0);assert.ok(fs.existsSync(f.destination(arch)));}));
for(const [arch,machine] of [['x64','ARM64'],['arm64','AMD64'],['x64','unknown'],['ia32','AMD64']])test(`native mismatch ${arch}/${machine} denies before filesystem`,()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');const r=run(f,{platform:'win32',arch,machine});assert.notEqual(r.status,0);assert.equal(r.calls,0);absent(f);}));
test('native machine errors deny before filesystem',()=>withFixture(f=>{const r=run(f,{platform:'win32',arch:'x64',machineError:true});assert.notEqual(r.status,0);assert.equal(r.calls,0);absent(f);}));
for(const args of [['cli','--unknown'],['cli','--arch'],['cli','--root'],['cli','--arch','ia32'],['cli','desktop'],['cli','--check','--check'],['cli','--arch','x64','--arch','arm64']])test(`strict arguments reject ${args.join(' ')}`,()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');assert.notEqual(run(f,{args}).status,0);absent(f);}));
for(const options of [{archs:[]},{archs:['x64','x64']},{archs:['ia32']},{check:'yes'},{requireAll:true,archs:['x64']}])test(`export rejects unsupported options ${JSON.stringify(options)}`,()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');assert.notEqual(run(f,{options}).status,0);absent(f);}));
for(const member of names)test(`partial optional source ${member} rejects`,()=>withFixture(f=>{artifact(f,'x64');fs.unlinkSync(path.join(f.directory('x64'),member));assert.notEqual(run(f).status,0);absent(f);}));
test('stale optional source rejects before valid first architecture is copied',()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');const file=path.join(f.directory('arm64'),names[1]);const m=JSON.parse(fs.readFileSync(file));m.sourceSha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(m));assert.notEqual(run(f).status,0);absent(f);}));
test('text payload never passes a matching hash manifest',()=>withFixture(f=>{artifact(f,'x64');const bytes=Buffer.from('not a native PE');fs.writeFileSync(path.join(f.directory('x64'),names[0]),bytes);const file=path.join(f.directory('x64'),names[1]);const m=JSON.parse(fs.readFileSync(file));m.sha256=hash(bytes);fs.writeFileSync(file,JSON.stringify(m));assert.notEqual(run(f).status,0);absent(f);}));
test('missing optional source with existing destination rejects',()=>withFixture(f=>{artifact(f,'x64',f.destination('x64'));const before=fs.readFileSync(path.join(f.destination('x64'),names[0]));assert.notEqual(run(f).status,0);assert.deepEqual(fs.readFileSync(path.join(f.destination('x64'),names[0])),before);}));
test('partial destination rejects before any first-target output',()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');fs.mkdirSync(f.destination('arm64'),{recursive:true});fs.writeFileSync(path.join(f.destination('arm64'),names[0]),'untouched');assert.notEqual(run(f).status,0);assert.equal(fs.existsSync(f.destination('x64')),false);assert.equal(fs.readFileSync(path.join(f.destination('arm64'),names[0]),'utf8'),'untouched');}));
test('destination directory link is rejected without modifying its referent',()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');const foreign=path.join(f.root,'foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'marker'),'untouched');fs.mkdirSync(path.dirname(f.destination('arm64')),{recursive:true});fs.symlinkSync(foreign,f.destination('arm64'),'junction');assert.notEqual(run(f).status,0);assert.deepEqual(fs.readdirSync(foreign),['marker']);assert.equal(fs.readFileSync(path.join(foreign,'marker'),'utf8'),'untouched');assert.equal(fs.existsSync(f.destination('x64')),false);}));
test('destination hardlink is rejected without modifying its referent',()=>withFixture(f=>{artifact(f,'x64');artifact(f,'x64',f.destination('x64'));const foreign=path.join(f.root,'foreign-file');fs.linkSync(path.join(f.destination('x64'),names[0]),foreign);const before=fs.readFileSync(foreign);assert.notEqual(run(f).status,0);assert.deepEqual(fs.readFileSync(foreign),before);}));
for(const [arch,machine,machineError] of [['x64','ARM64',false],['arm64','ARM64',false],['x64','unknown',false],['x64','AMD64',true]])test(`startup patch native ${arch}/${machine}/${machineError} denies before filesystem/spawn`,()=>withFixture(f=>{const r=run(f,{hotfix:true,platform:'win32',arch,machine,machineError,args:[f.root,'--dry-run']});assert.notEqual(r.status,0);assert.equal(r.calls,0);absent(f);}));
test('matching startup patch reaches unchanged package preflight',()=>withFixture(f=>{const r=run(f,{hotfix:true,platform:'win32',arch:'x64',machine:'AMD64',args:[f.root,'--dry-run']});assert.notEqual(r.status,0);assert.match(r.message,/1\.5\.6/);assert.equal(r.calls,1);absent(f);}));

test('a missing reader never silently retains an existing native destination',()=>withFixture(f=>{fs.unlinkSync(f.reader);artifact(f,'x64',f.destination('x64'));const before=fs.readFileSync(path.join(f.destination('x64'),names[0]));assert.notEqual(run(f).status,0);assert.deepEqual(fs.readFileSync(path.join(f.destination('x64'),names[0])),before);}));
test('oversized optional payload is rejected before any output',()=>withFixture(f=>{artifact(f,'x64');const bytes=Buffer.alloc(2*1024**2+1);fs.writeFileSync(path.join(f.directory('x64'),names[0]),bytes);const file=path.join(f.directory('x64'),names[1]);const m=JSON.parse(fs.readFileSync(file));m.sha256=hash(bytes);fs.writeFileSync(file,JSON.stringify(m));assert.notEqual(run(f).status,0);absent(f);}));
test('oversized optional manifest is rejected even with valid JSON fields',()=>withFixture(f=>{artifact(f,'x64');const file=path.join(f.directory('x64'),names[1]);fs.appendFileSync(file,' '.repeat(4097));assert.notEqual(run(f).status,0);absent(f);}));
test('corrupt optional JSON manifest is rejected before any output',()=>withFixture(f=>{artifact(f,'x64');fs.writeFileSync(path.join(f.directory('x64'),names[1]),'{');assert.notEqual(run(f).status,0);absent(f);}));
test('stale canonical core header rejects before any first-target output',()=>withFixture(f=>{artifact(f,'x64');artifact(f,'arm64');const file=path.join(f.directory('arm64'),names[1]);const m=JSON.parse(fs.readFileSync(file));m.coreSha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(m));assert.notEqual(run(f).status,0);absent(f);}));

test('a missing optional reader with no native source or destination remains a no-op',()=>withFixture(f=>{fs.unlinkSync(f.reader);assert.equal(run(f).status,0);absent(f);}));
test('a missing optional reader still validates present sources without copying them',()=>withFixture(f=>{fs.unlinkSync(f.reader);artifact(f,'x64');artifact(f,'arm64');assert.equal(run(f).status,0);absent(f);}));
test('a missing optional reader cannot hide a stale present source',()=>withFixture(f=>{fs.unlinkSync(f.reader);artifact(f,'x64');const file=path.join(f.directory('x64'),names[1]);const m=JSON.parse(fs.readFileSync(file));m.sourceSha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(m));assert.notEqual(run(f).status,0);absent(f);}));
