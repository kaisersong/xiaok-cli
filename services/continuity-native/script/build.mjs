// Reproducible, isolated native build. Never installs/links a global executable.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const service=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const spec=JSON.parse(fs.readFileSync(path.join(service,'upstream.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const options=new Map();
for(let i=2;i<process.argv.length;i+=2){
  const name=process.argv[i],value=process.argv[i+1];
  if(!['--build-root','--cargo','--rustc','--profile','--archive','--cargo-home'].includes(name)||!value||options.has(name))throw new Error('invalid_build_arguments');
  options.set(name,value);
}
// Other platforms stay unavailable until their actual native qualification exists.
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('native_build_platform_unqualified');
if(!spec.qualifiedPlatforms.includes(`${process.platform}-${process.arch}`))throw new Error('native_build_platform_unqualified');
for(const name of ['--build-root','--cargo','--rustc'])if(!options.has(name)||!path.isAbsolute(options.get(name)))throw new Error(`absolute_${name}_required`);
const profile=options.get('--profile')??'release';
if(!['release','dev'].includes(profile))throw new Error('invalid_build_profile');
const patch=fs.readFileSync(path.join(service,'restricted.patch'));
if(sha(patch)!==spec.patchSha256)throw new Error('native_patch_hash_mismatch');
const parent=fs.realpathSync(options.get('--build-root'));
const root=fs.mkdtempSync(path.join(parent,'xiaok-native-build-'));fs.chmodSync(root,0o700);
// Apply and execute the exact bytes captured now, never a later repository reread.
const frozenPatch=path.join(root,'restricted.patch');fs.writeFileSync(frozenPatch,patch,{mode:0o600,flag:'wx'});
const frozenTests=path.join(root,'qualification');fs.mkdirSync(frozenTests,{mode:0o700});
fs.cpSync(path.join(service,'test'),path.join(frozenTests,'test'),{recursive:true,filter:source=>{
  const stat=fs.lstatSync(source);if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())throw new Error('invalid_qualification_source');return true;
}});
fs.writeFileSync(path.join(frozenTests,'package.json'),JSON.stringify({type:'module'}),{mode:0o600,flag:'wx'});
const testFiles=fs.readdirSync(path.join(frozenTests,'test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join(frozenTests,'test',name));
function testSnapshotFiles(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?testSnapshotFiles(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const files=testSnapshotFiles(path.join(frozenTests,'test')).sort();
const testsSha256=sha(JSON.stringify(files.map(file=>[path.relative(frozenTests,file).split(path.sep).join('/'),sha(fs.readFileSync(file))])));
function privateCache(name,fallback){
  if(!options.has(name))return path.join(root,fallback);
  const requested=fs.realpathSync(options.get(name)),relative=path.relative(parent,requested);
  if(!path.isAbsolute(options.get(name))||relative===''||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('cache_outside_explicit_build_root');
  return requested;
}
const state={schemaVersion:1,root,pid:process.pid,processes:[],status:'running'};
const record=()=>fs.writeFileSync(path.join(root,'build-processes.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});record();
const active=new Map();
const env={PATH:[path.dirname(options.get('--rustc')),path.dirname(process.execPath),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),
  LANG:'en_US.UTF-8',CARGO_HOME:privateCache('--cargo-home','cargo-home'),CARGO_TARGET_DIR:path.join(root,'target'),RUSTC:options.get('--rustc')};
const rustdoc=path.join(path.dirname(options.get('--rustc')),'rustdoc');if(fs.existsSync(rustdoc))env.RUSTDOC=rustdoc;
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  stopping=true;
  for(const child of active.values())try{process.kill(-child.pid,'SIGTERM');}catch{}
  const deadline=setTimeout(()=>{for(const child of active.values())try{process.kill(-child.pid,'SIGKILL');}catch{}},3000);deadline.unref();
});
async function run(executable,args,{cwd=root,name,capture=false,extraEnv={}}={}){
  if(stopping)throw new Error('native_build_stopped');
  const log=fs.openSync(path.join(root,`${name}.log`),'wx',0o600);
  const child=spawn(executable,args,{cwd,env:{...env,...extraEnv},stdio:['ignore','pipe','pipe'],detached:true});
  const entry={name,pid:child.pid,executable,args,status:'running'};state.processes.push(entry);active.set(child.pid,child);record();
  let output='';
  const consume=chunk=>{fs.writeSync(log,chunk);if(capture&&output.length<65536)output+=chunk.toString();};
  child.stdout.on('data',consume);child.stderr.on('data',consume);
  const result=await new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('close',(code,signal)=>resolve({code,signal}));});
  active.delete(child.pid);fs.closeSync(log);Object.assign(entry,{status:'complete',...result,reaped:true});record();
  if(result.error||result.code!==0||stopping)throw new Error(`native_build_step_failed:${name}`);
  return output;
}
try{
  for(const [name,executable]of [['cargo',options.get('--cargo')],['rustc',options.get('--rustc')]]){
    const version=await run(executable,['--version'],{name:`${name}-version`,capture:true});
    if(!version.startsWith(`${name} ${spec.compilerVersion} `))throw new Error('native_compiler_version_mismatch');
  }
  const compilerDetails=await run(options.get('--rustc'),['-vV'],{name:'rustc-host',capture:true});
  if(!compilerDetails.split(/\r?\n/).includes(`host: ${spec.targetTriple}`))throw new Error('native_compiler_host_mismatch');
  const archivePath=path.join(root,'upstream.tar.gz');
  if(options.has('--archive'))fs.copyFileSync(options.get('--archive'),archivePath);
  else{
    const response=await fetch(spec.sourceUrl,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('native_source_download_failed');
    fs.writeFileSync(archivePath,Buffer.from(await response.arrayBuffer()),{mode:0o600});
  }
  if(sha(fs.readFileSync(archivePath))!==spec.sourceSha256)throw new Error('native_source_archive_hash_mismatch');
  await run('/usr/bin/tar',['-xzf',archivePath,'-C',root],{name:'extract'});
  const source=path.join(root,`codex-${spec.upstreamCommit}`);
  for(const [name,expected]of Object.entries(spec.originalFiles))if(sha(fs.readFileSync(path.join(source,name)))!==expected)throw new Error('native_original_source_mismatch');
  for(const name of spec.newFiles)if(fs.existsSync(path.join(source,name)))throw new Error('native_original_source_collision');
  await run('/usr/bin/git',['apply','--check',frozenPatch],{cwd:source,name:'patch-check'});
  await run('/usr/bin/git',['apply',frozenPatch],{cwd:source,name:'patch'});
  const cwd=path.join(source,'codex-rs'),cargo=options.get('--cargo');
  await run(cargo,['test','-p','codex-extension-api','--test','main_bridge_only','--locked','--features',spec.cargoFeature,'--target',spec.targetTriple],{cwd,name:'registry-policy'});
  await run(cargo,['build','-p','codex-app-server','--bin','codex-app-server','--locked','--features',spec.cargoFeature,'--target',spec.targetTriple,...(profile==='release'?['--release']:[])],{cwd,name:'restricted-build'});
  const binaryDirectory=path.join(root,'qualified-bin');fs.mkdirSync(binaryDirectory,{mode:0o700});
  const binary=path.join(binaryDirectory,'codex-app-server');
  fs.copyFileSync(path.join(env.CARGO_TARGET_DIR,spec.targetTriple,profile==='release'?'release':'debug','codex-app-server'),binary,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(binary,0o700);
  const binarySha256=sha(fs.readFileSync(binary));
  const header=Buffer.alloc(16),descriptor=fs.openSync(binary,'r');try{if(fs.readSync(descriptor,header,0,16,0)!==16||header.readUInt32LE(0)!==0xfeedfacf||header.readUInt32LE(4)!==0x0100000c||header.readUInt32LE(12)!==2)throw new Error('native_binary_architecture_mismatch');}finally{fs.closeSync(descriptor);}
  await run(process.execPath,['--test',...testFiles],{cwd:frozenTests,name:'actual-native-qualification',extraEnv:{XIAOK_NATIVE_TEST_BINARY:binary}});
  if(sha(fs.readFileSync(binary))!==binarySha256)throw new Error('native_qualified_binary_changed');
  const manifest={schemaVersion:1,restrictionVersion:spec.restrictionVersion,upstreamCommit:spec.upstreamCommit,sourceSha256:spec.sourceSha256,
    patchSha256:spec.patchSha256,compilerVersion:spec.compilerVersion,targetTriple:spec.targetTriple,platform:process.platform,arch:process.arch,profile,
    binarySha256,testsSha256,binary};
  fs.writeFileSync(path.join(root,'artifact.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  state.status='complete';record();process.stdout.write(JSON.stringify({buildRoot:root,manifest:path.join(root,'artifact.json')})+'\n');
}catch(error){state.status='failed';state.error=error.message;record();throw error;}
