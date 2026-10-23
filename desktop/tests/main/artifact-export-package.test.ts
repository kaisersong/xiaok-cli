// @vitest-environment node
import {afterAll,it,expect} from 'vitest';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,readdirSync,symlinkSync,truncateSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import pkg from '../../electron/artifact-export-package.cjs';
import {runArtifactExportProcess} from '../../electron/artifact-export-process.js';
import {statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createPackage} from '@electron/asar';
import {Arch} from 'electron-builder';
const require=createRequire(import.meta.url);
const packHelper=require('../../scripts/pack-artifact-export-helper.cjs');
const repo=resolve(import.meta.dirname,'../../..'),work=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-export-package-'))),host=`${process.platform}-${process.arch}`;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const sources=['go.mod','main.go','identity_unix.go','identity_windows.go'];
afterAll(()=>rmSync(work,{recursive:true,force:true,maxRetries:3}));
function fixture(target=host, actual=false){
 const root=join(work,randomUUID()),build=join(root,'.artifacts/artifact-export-helper',target);mkdirSync(build,{recursive:true});
 for(const name of sources){const destination=join(root,'desktop/native/artifact-export-helper',name);mkdirSync(dirname(destination),{recursive:true});cpSync(join(repo,'desktop/native/artifact-export-helper',name),destination);}
 const lock=join(root,'scripts/verification/artifact-export-toolchain.lock.json');mkdirSync(dirname(lock),{recursive:true});cpSync(join(repo,'scripts/verification/artifact-export-toolchain.lock.json'),lock);
 let pointer:any;
 if(actual){const original=join(repo,'.artifacts/artifact-export-helper',target);pointer=JSON.parse(readFileSync(join(original,'current.json'),'utf8'));cpSync(join(original,pointer.generation),join(build,pointer.generation),{recursive:true});cpSync(join(original,'current.json'),join(build,'current.json'));}
 else{
  // Explicit self-contained container-header fixture, never executed or reported as a Go build.
  const binary=Buffer.alloc(512),arm=target.endsWith('arm64');
  if(target.startsWith('darwin')){binary.writeUInt32LE(0xfeedfacf,0);binary.writeUInt32LE(arm?0x0100000c:0x01000007,4);binary.writeUInt32LE(2,12);}
  else if(target.startsWith('linux')){Buffer.from([127,69,76,70,2,1]).copy(binary);binary.writeUInt16LE(2,16);binary.writeUInt16LE(arm?183:62,18);}
  else{binary.writeUInt16LE(0x5a4d,0);binary.writeUInt32LE(128,0x3c);binary.writeUInt32LE(0x4550,128);binary.writeUInt16LE(arm?0xaa64:0x8664,132);binary.writeUInt16LE(2,150);binary.writeUInt16LE(0x20b,152);}
  const license=Buffer.from('Explicit license fixture'),lockBytes=readFileSync(lock),sdk=JSON.parse(lockBytes.toString()).hosts['darwin-arm64'],filename=target.startsWith('win32')?'artifact-export-helper.exe':'artifact-export-helper';
  const manifest={version:3,target,filename,size:binary.length,sha256:hash(binary),license:{size:license.length,sha256:hash(license)},sourceHashes:Object.fromEntries(sources.map(name=>[name,hash(readFileSync(join(root,'desktop/native/artifact-export-helper',name)))])),toolchainArchive:{...sdk,lockSha256:hash(lockBytes)},compilerVersion:'go version go1.27.1 darwin/arm64',compilerSha256:'a'.repeat(64),arguments:['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',filename,'.'],executedOnTarget:false};
  const encoded=Buffer.from(JSON.stringify(manifest));pointer={version:1,generation:'generation-'+randomUUID(),manifestSha256:hash(encoded)};const generation=join(build,pointer.generation);mkdirSync(generation);writeFileSync(join(generation,filename),binary);writeFileSync(join(generation,'GO-LICENSE'),license);writeFileSync(join(generation,'manifest.json'),encoded);writeFileSync(join(build,'current.json'),JSON.stringify(pointer));
 }
 const generation=join(build,pointer.generation),manifest=JSON.parse(readFileSync(join(generation,'manifest.json'),'utf8'));
 return {root,build,generation,pointer,manifest};
}
function changeManifest(f:ReturnType<typeof fixture>,change:(m:any)=>void){change(f.manifest);const bytes=Buffer.from(JSON.stringify(f.manifest,null,2)+'\n');writeFileSync(join(f.generation,'manifest.json'),bytes);writeFileSync(join(f.build,'current.json'),JSON.stringify({...f.pointer,manifestSha256:hash(bytes)})+'\n');}
it.each(['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64'])('selects the explicit self-contained schema fixture for %s and copies only three matching files',target=>{
 const f=fixture(target),resources=join(f.root,'resources');const installed=pkg.installArtifactExportPackage(f.root,target,resources);
 expect(readdirSync(join(resources,'artifact-export-helper',target)).sort()).toEqual(['GO-LICENSE',f.manifest.filename,'manifest.json'].sort());expect(hash(readFileSync(installed.executable))).toBe(f.manifest.sha256);
 expect(pkg.resolveInstalledArtifactExportHelper(resources,...target.split('-') as [string,string])).toBe(installed.executable);
});
it.each(['binary','license','source','lock'] as const)('rejects changed %s instead of shipping a stale build',kind=>{
 const f=fixture();const path=kind==='binary'?join(f.generation,f.manifest.filename):kind==='license'?join(f.generation,'GO-LICENSE'):kind==='source'?join(f.root,'desktop/native/artifact-export-helper/main.go'):join(f.root,'scripts/verification/artifact-export-toolchain.lock.json');writeFileSync(path,'changed');expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow();
});
it.each(['target','unknown-field','license-hash'] as const)('rejects a malformed captured manifest: %s',kind=>{
 const f=fixture();changeManifest(f,m=>{if(kind==='target')m.target='win32-ia32';else if(kind==='unknown-field')m.extra=true;else m.license.sha256='0'.repeat(64);});expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow();
});
it('rejects pointer traversal and never reads an alternative generation',()=>{
 const f=fixture();writeFileSync(join(f.build,'current.json'),JSON.stringify({...f.pointer,generation:'../outside'}));expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow();
});
it.runIf(process.platform!=='win32')('rejects a symlinked build binary',()=>{
 const f=fixture(),binary=join(f.generation,f.manifest.filename),other=join(f.root,'other');cpSync(binary,other);rmSync(binary);symlinkSync(other,binary);expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow();
});
it('refuses an occupied destination and preserves it',()=>{
 const f=fixture(),resources=join(f.root,'resources'),destination=join(resources,'artifact-export-helper',host);mkdirSync(destination,{recursive:true});writeFileSync(join(destination,'keep'),'unchanged');expect(()=>pkg.installArtifactExportPackage(f.root,host,resources)).toThrow();expect(readFileSync(join(destination,'keep'),'utf8')).toBe('unchanged');
});
it('rejects a missing build and unsupported architecture',()=>{
 const root=join(work,randomUUID());mkdirSync(root);expect(()=>pkg.installArtifactExportPackage(root,host,join(root,'resources'))).toThrow();expect(()=>pkg.resolveInstalledArtifactExportHelper(root,'win32','ia32')).toThrow();
});
it.runIf(process.env.XIAOK_EXPORT_PACKAGE_INTEGRATION==='1')('executes the actual prepared package helper through the Main process owner',async()=>{
 const f=fixture(host,true),resources=join(f.root,'resources');pkg.installArtifactExportPackage(f.root,host,resources);const executable=pkg.resolveInstalledArtifactExportHelper(resources,process.platform,process.arch),parent=join(f.root,'output');mkdirSync(parent);const info=statSync(parent,{bigint:true}),bytes=Buffer.from('Actual packaged bytes');
 const result=await runArtifactExportProcess({requestSource:'user',executable,parent,parentIdentity:{device:String(info.dev),inode:String(info.ino)},temporaryName:'.xiaok-export-'+randomUUID(),targetName:'final.bin',ownershipToken:'a'.repeat(64),bytes,sha256:hash(bytes),signal:new AbortController().signal,hooks:{async prepare(){},async created(){},async staged(){},async authorizeCommit(){return()=>{};},async settled(){}}});expect(result.status).toBe('completed');expect(readFileSync(join(parent,'final.bin'))).toEqual(bytes);
});
it('rejects an oversized binary before reading its contents',()=>{
 const f=fixture(),binary=join(f.generation,f.manifest.filename);truncateSync(binary,16*1024*1024+1);expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow();
});
it('accepts reordered exact manifest keys and resolves the development generation',()=>{
 const f=fixture();const bytes=Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(f.manifest).reverse())));writeFileSync(join(f.generation,'manifest.json'),bytes);writeFileSync(join(f.build,'current.json'),JSON.stringify({...f.pointer,manifestSha256:hash(bytes)}));
 expect(pkg.resolveDevelopmentArtifactExportHelper(f.root,process.platform,process.arch)).toBe(join(f.generation,f.manifest.filename));
});
it('runtime permits post-build signing bytes but still rejects a changed CPU or license',()=>{
 const f=fixture(),resources=join(f.root,'resources'),{executable}=pkg.installArtifactExportPackage(f.root,host,resources);
 const original=readFileSync(executable);writeFileSync(executable,Buffer.concat([original,Buffer.from('signature-shape fixture; not a real signature')]));
 expect(pkg.resolveInstalledArtifactExportHelper(resources,process.platform,process.arch)).toBe(executable);
 const corrupt=Buffer.from(original);corrupt.fill(0,0,64);writeFileSync(executable,corrupt);expect(()=>pkg.resolveInstalledArtifactExportHelper(resources,process.platform,process.arch)).toThrow();
 writeFileSync(executable,original);writeFileSync(join(dirname(executable),'GO-LICENSE'),'changed');expect(()=>pkg.resolveInstalledArtifactExportHelper(resources,process.platform,process.arch)).toThrow();
});
it.each(['darwin-arm64','linux-x64','win32-arm64','win32-x64'])('actual afterPack hook verifies app.asar and installs selected %s',async target=>{
 const f=fixture(target,target===host&&process.env.XIAOK_EXPORT_PACKAGE_INTEGRATION==='1'),desktop=join(f.root,'desktop'),[platform,arch]=target.split('-');mkdirSync(join(desktop,'electron'),{recursive:true});cpSync(join(repo,'desktop/electron/artifact-export-package.cjs'),join(desktop,'electron/artifact-export-package.cjs'));
 const appOutDir=join(f.root,'packed'),resources=platform==='darwin'?join(appOutDir,'Xiaok.app/Contents/Resources'):join(appOutDir,'resources');mkdirSync(resources,{recursive:true});
 const input=join(f.root,'asar-input'),entry=join(input,'dist/main/desktop/electron/artifact-export-package.cjs');mkdirSync(dirname(entry),{recursive:true});cpSync(join(desktop,'electron/artifact-export-package.cjs'),entry);await createPackage(input,join(resources,'app.asar'));
 const result=await packHelper({electronPlatformName:platform,arch:Arch[arch as 'arm64'|'x64'],appOutDir,packager:{projectDir:desktop,appInfo:{productFilename:'Xiaok'}}});expect(result.executable).toBe(join(resources,'artifact-export-helper',target,f.manifest.filename));
 if(target===host&&process.env.XIAOK_EXPORT_PACKAGE_INTEGRATION==='1'){const executable=pkg.resolveInstalledArtifactExportHelper(resources,platform,arch),parent=join(f.root,'actual-hook-output');mkdirSync(parent);const info=statSync(parent,{bigint:true}),bytes=Buffer.from('Actual afterPack app resources');
 const outcome=await runArtifactExportProcess({requestSource:'user',executable,parent,parentIdentity:{device:String(info.dev),inode:String(info.ino)},temporaryName:'.xiaok-export-'+randomUUID(),targetName:'hook.bin',ownershipToken:'b'.repeat(64),bytes,sha256:hash(bytes),signal:new AbortController().signal,hooks:{async prepare(){},async created(){},async staged(){},async authorizeCommit(){return()=>{};},async settled(){}}});expect(outcome.status).toBe('completed');expect(readFileSync(join(parent,'hook.bin'))).toEqual(bytes);}

});
it('actual afterPack rejects a stale archived loader before writing helper resources',async()=>{
 const f=fixture(),desktop=join(f.root,'desktop');mkdirSync(join(desktop,'electron'),{recursive:true});cpSync(join(repo,'desktop/electron/artifact-export-package.cjs'),join(desktop,'electron/artifact-export-package.cjs'));
 const appOutDir=join(f.root,'packed'),resources=join(appOutDir,'resources');mkdirSync(resources,{recursive:true});const input=join(f.root,'asar-input'),entry=join(input,'dist/main/desktop/electron/artifact-export-package.cjs');mkdirSync(dirname(entry),{recursive:true});writeFileSync(entry,'old');await createPackage(input,join(resources,'app.asar'));
 await expect(packHelper({electronPlatformName:'linux',arch:Arch.arm64,appOutDir,packager:{projectDir:desktop,appInfo:{productFilename:'Xiaok'}}})).rejects.toThrow('stale');expect(readdirSync(resources)).toEqual(['app.asar']);
});
it('actual afterPack rejects unsupported targets before package access',async()=>{
 await expect(packHelper({electronPlatformName:'win32',arch:Arch.ia32})).rejects.toThrow('unsupported');
});
it('the single afterPack entry retains both existing gates before the helper gate',async()=>{
 const entry=require.resolve('../../scripts/after-pack.cjs');const names=['verify-packaged-main-freshness','verify-packaged-runtime-dependencies','verify-packaged-service-contracts','pack-bundled-runtimes','pack-artifact-export-helper'];const calls:string[]=[];
 const modules=names.map(name=>require.resolve(`../../scripts/${name}.cjs`));const originals=modules.map(file=>require.cache[file]);const originalEntry=require.cache[entry];
 try{modules.forEach((file,index)=>{require.cache[file]={id:file,filename:file,loaded:true,exports:async()=>{calls.push(names[index]);}} as NodeJS.Module;});delete require.cache[entry];await require(entry)({});expect(calls).toEqual(names);
 // A failure in an earlier gate must prevent the helper mutation.
 calls.length=0;require.cache[modules[1]]!.exports=async()=>{throw new Error('old gate refused');};delete require.cache[entry];await expect(require(entry)({})).rejects.toThrow('old gate refused');expect(calls).toEqual([names[0]]);
 calls.length=0;require.cache[modules[1]]!.exports=async()=>{calls.push(names[1]);};require.cache[modules[2]]!.exports=async()=>{throw new Error('service gate refused');};delete require.cache[entry];await expect(require(entry)({})).rejects.toThrow('service gate refused');expect(calls).toEqual(names.slice(0,2));
 }finally{modules.forEach((file,index)=>{if(originals[index])require.cache[file]=originals[index];else delete require.cache[file];});if(originalEntry)require.cache[entry]=originalEntry;else delete require.cache[entry];}
});
it.each(['linux-other','.staging-crashed'])('rejects an occupied helper parent containing %s',name=>{
 const f=fixture(),resources=join(f.root,'resources'),old=join(resources,'artifact-export-helper',name);mkdirSync(old,{recursive:true});writeFileSync(join(old,'keep'),'old');expect(()=>pkg.installArtifactExportPackage(f.root,host,resources)).toThrow();expect(readFileSync(join(old,'keep'),'utf8')).toBe('old');
});
it('rejects a fourth generation entry',()=>{
 const f=fixture();writeFileSync(join(f.generation,'extra'),'extra');expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow();
});
it('missing build reports the exact target preparation command',()=>{
 const root=join(work,randomUUID());mkdirSync(root);expect(()=>pkg.installArtifactExportPackage(root,host,join(root,'resources'))).toThrow(`--target ${host} --toolchain-archive`);
});
it.each(['darwin-arm64','linux-x64','win32-x64'])('runtime rejects an object file with matching CPU: %s',target=>{
 const f=fixture(target),resources=join(f.root,'resources'),{executable}=pkg.installArtifactExportPackage(f.root,target,resources),bytes=readFileSync(executable);
 if(target.startsWith('darwin'))bytes.writeUInt32LE(1,12);else if(target.startsWith('linux'))bytes.writeUInt16LE(1,16);else bytes.writeUInt16LE(0,bytes.readUInt32LE(0x3c)+22);writeFileSync(executable,bytes);expect(()=>pkg.resolveInstalledArtifactExportHelper(resources,...target.split('-') as [string,string])).toThrow();
});
it.runIf(process.platform!=='win32')('publishes a traversable target directory for installations owned by another user',()=>{
 const f=fixture(),resources=join(f.root,'resources'),{executable}=pkg.installArtifactExportPackage(f.root,host,resources);expect(statSync(dirname(executable)).mode&0o777).toBe(0o755);expect(statSync(executable).mode&0o777).toBe(0o755);
});
it.each(['generation','binary','license'])('missing %s reports the target preparation command',kind=>{
 const f=fixture();rmSync(kind==='generation'?f.generation:join(f.generation,kind==='binary'?f.manifest.filename:'GO-LICENSE'),{recursive:true});expect(()=>pkg.installArtifactExportPackage(f.root,host,join(f.root,'resources'))).toThrow(`--target ${host} --toolchain-archive`);
});
it.runIf(process.platform!=='win32')('publishes the helper parent traversably even with a restrictive build umask',()=>{
 const f=fixture(),resources=join(f.root,'resources');mkdirSync(resources,{mode:0o755});const before=process.umask(0o077);try{const {executable}=pkg.installArtifactExportPackage(f.root,host,resources);expect(statSync(dirname(dirname(executable))).mode&0o777).toBe(0o755);}finally{process.umask(before);}
});
