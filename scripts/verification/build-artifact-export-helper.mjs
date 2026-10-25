import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {publishArtifactExportBuild} from './publish-artifact-export-build.mjs';
import {x as extractTar} from 'tar';
import AdmZip from 'adm-zip';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),args=process.argv.slice(2);
const targets={'darwin-arm64':['darwin','arm64'],'darwin-x64':['darwin','amd64'],'linux-arm64':['linux','arm64'],'linux-x64':['linux','amd64'],'win32-arm64':['windows','arm64'],'win32-x64':['windows','amd64']};
if(![2,4].includes(args.length)||args[0]!=='--target'||!Object.hasOwn(targets,args[1])||args.length===4&&args[2]!=='--toolchain-archive')throw Error('Use --target <platform-arch> --toolchain-archive <official Go SDK archive>');
const sha=b=>createHash('sha256').update(b).digest('hex');
const lockBytes=readFileSync(new URL('./artifact-export-toolchain.lock.json',import.meta.url)),lock=JSON.parse(lockBytes),host=lock.hosts[`${process.platform}-${process.arch}`];
if(!host)throw Error('artifact_export_build_host_unsupported');
// Bound the read on the opened regular file; extract these same captured bytes,
// never a separately reopened path or a mutable cached SDK/standard library.
const fd=openSync(args.length===4?resolve(args[3]):join(root,'.artifacts','solpi-build-tools',host.filename),'r');let archive;
try{
 const info=fstatSync(fd);if(!info.isFile()||info.size!==host.size)throw Error('artifact_export_toolchain_archive_size');
 archive=Buffer.alloc(host.size);let offset=0;
 while(offset<archive.length){const count=readSync(fd,archive,offset,archive.length-offset,null);if(!count)throw Error('artifact_export_toolchain_archive_short');offset+=count;}
 if(readSync(fd,Buffer.alloc(1),0,1,null)!==0)throw Error('artifact_export_toolchain_archive_size');
}finally{closeSync(fd);}
if(sha(archive)!==host.sha256)throw Error('artifact_export_toolchain_archive_hash');
const target=args[1],source=join(root,'desktop/native/artifact-export-helper'),output=join(root,'.artifacts/artifact-export-helper',target),work=mkdtempSync(join(tmpdir(),'xiaok-export-sdk-'));
try{
 const captured=join(work,host.filename);writeFileSync(captured,archive,{flag:'wx',mode:0o600});
 // In-process parsers never consult TAR_OPTIONS or discover a system tar.exe.
 // The package-lock pins their inputs; only the already verified SDK is parsed.
 if(host.filename.endsWith('.zip'))new AdmZip(archive).extractAllTo(work,false,true);
 else await extractTar({file:captured,cwd:work,strict:true,preservePaths:false,chmod:true});
 const sdk=join(work,'go'),compiler=join(sdk,'bin',process.platform==='win32'?'go.exe':'go'),buildSource=join(work,'source');mkdirSync(buildSource);
 const names=['go.mod','main.go','identity_unix.go','identity_windows.go'];
 const sources=Object.fromEntries(names.map(name=>{const bytes=readFileSync(join(source,name));writeFileSync(join(buildSource,name),bytes,{flag:'wx'});return[name,sha(bytes)];}));
 // Do not inherit Go build injections (GOEXPERIMENT, GOCACHEPROG, architecture
 // tuning, GOROOT, overlays, cgo, toolchain downloads, or persisted GOENV).
 const env={HOME:work,USERPROFILE:work,TMPDIR:work,TEMP:work,TMP:work,PATH:join(sdk,'bin'),LANG:'C',LC_ALL:'C'};
 // Windows' loader needs the inherited OS root. It is not used to select a
 // compiler, shell, extractor or other executable; all tools live in this SDK.
 if(process.platform==='win32'&&process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
 Object.assign(env,{GOROOT:sdk,GOENV:'off',GOTOOLCHAIN:'local',GOWORK:'off',GOPROXY:'off',GOFLAGS:'',CGO_ENABLED:'0',GOCACHE:join(work,'cache'),GOPATH:join(work,'gopath'),GOOS:targets[target][0],GOARCH:targets[target][1]});
 const version=spawnSync(compiler,['version'],{env,encoding:'utf8',timeout:10000});if(version.error||version.status!==0||!version.stdout.startsWith(`go version ${lock.version} `))throw Error('artifact_export_compiler_version');
 const filename=target.startsWith('win32-')?'artifact-export-helper.exe':'artifact-export-helper',executable=join(work,filename);
 const buildArgs=['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',executable,'.'],built=spawnSync(compiler,buildArgs,{cwd:buildSource,env,stdio:'inherit',timeout:90000});
 if(built.error||built.status!==0)throw Error('artifact_export_compile_failed');
 const binaryBytes=readFileSync(executable),licenseBytes=readFileSync(join(sdk,'LICENSE'));
 const manifest={version:3,target,filename,size:binaryBytes.length,sha256:sha(binaryBytes),license:{size:licenseBytes.length,sha256:sha(licenseBytes)},sourceHashes:sources,toolchainArchive:{...host,lockSha256:sha(lockBytes)},compilerVersion:version.stdout.trim(),compilerSha256:sha(readFileSync(compiler)),arguments:buildArgs.map(arg=>arg===executable?filename:arg),executedOnTarget:false};
 const published=publishArtifactExportBuild(output,{[filename]:binaryBytes,'GO-LICENSE':licenseBytes,'manifest.json':Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
 console.log(JSON.stringify({...published,target,sha256:manifest.sha256,compiled:true,executed:false}));
}finally{rmSync(work,{recursive:true,force:true,maxRetries:3});}
