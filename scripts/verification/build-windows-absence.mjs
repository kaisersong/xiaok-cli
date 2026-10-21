import fs from 'node:fs';
import path from 'node:path';
import {machine, release} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {verifyArtifact} from './copy-windows-absence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sourceDirectory=path.join(root,'src','runtime','verification','native');
const filenames=['windows-installation-absence.exe','windows-installation-absence.json'];
const publisher=Object.freeze({size:190725905,sha256:'e3ad77d117a4bea19a7a3b333341824d79a5a371004a10e25b8504e7b3047666',prefix:'llvm-mingw-20260922-ucrt-x86_64',fileCount:9053,bytes:749625811,treeSha256:'530f105a3ba2161e20360703a984a4f146466b8f4d88849e85bda3ccff9a34b2'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function exists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function plain(file,directory=false){const stat=fs.lstatSync(file,{bigint:true});if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1n))throw Error('Windows diagnostic requires plain files/directories');return stat;}
function capture(file,limit){const stat=plain(file);if(stat.size>BigInt(limit))throw Error('Windows diagnostic input size exceeded');const bytes=fs.readFileSync(file);if(bytes.length>limit)throw Error('Windows diagnostic input size exceeded');return {file,stat,bytes};}
function unchanged(record){const stat=plain(record.file,record.directory);for(const key of record.directory?['dev','ino','mode']:['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'])if(stat[key]!==record.stat[key])throw Error('Windows diagnostic input identity changed');if(record.bytes&&!fs.readFileSync(record.file).equals(record.bytes))throw Error('Windows diagnostic input bytes changed');}
function ancestors(directory,records){const relative=path.relative(root,directory);if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Windows diagnostic destination outside fixed root');let current=root;for(const part of ['',...relative.split(path.sep).filter(Boolean)]){if(part)current=path.join(current,part);if(!exists(current))break;records.set(current,{file:current,stat:plain(current,true),directory:true});}}
function parse(args){
 if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'))throw Error('Invalid Windows diagnostic arguments');
 let arch=process.arch,compiler,archive;const seen=new Set();
 for(let index=0;index<args.length;index++){const flag=args[index];if(!['--target','--compiler','--toolchain-archive'].includes(flag)||seen.has(flag))throw Error('Invalid Windows diagnostic arguments');seen.add(flag);const value=args[++index];if(!value||value.startsWith('--'))throw Error('Invalid Windows diagnostic arguments');if(flag==='--target')arch=value;else if(flag==='--compiler')compiler=value;else archive=value;}
 if(!['x64','arm64'].includes(arch)||(compiler&&archive)||(compiler&&/\.(cmd|bat)$/i.test(compiler)))throw Error('Invalid Windows diagnostic arguments');
 return {arch,compiler,archive};
}
function host(archive){
 let nativeMachine;
 if(process.platform==='win32'){nativeMachine=machine();const value=nativeMachine.toLowerCase(),native=['amd64','x86_64'].includes(value)?'x64':['arm64','aarch64'].includes(value)?'arm64':undefined;if(!native||native!==process.arch||(archive&&native!=='x64'))throw Error('Native Windows compiler architecture required');}
 else if(archive)throw Error('Official archive requires native Windows x64');
 return {platform:process.platform,processArchitecture:process.arch,nativeMachine:nativeMachine??null,osRelease:release()};
}
function publish(directory,name,bytes){const temporary=path.join(directory,'.'+name+'.'+randomBytes(16).toString('hex')+'.tmp');let fd;try{fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,path.join(directory,name));}finally{if(fd!==undefined)fs.closeSync(fd);if(exists(temporary))fs.unlinkSync(temporary);}}
function tree(directory){
 const files=[];
 function walk(folder,relative=''){for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Invalid publisher tree link');const rel=relative?relative+'/'+name:name;if(stat.isDirectory())walk(file,rel);else{const item=capture(file,128*1024**2);files.push({path:rel,size:item.bytes.length,sha256:sha(item.bytes)});}}}
 walk(directory);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(files.length!==publisher.fileCount||files.reduce((count,file)=>count+file.size,0)!==publisher.bytes||sha(Buffer.from(JSON.stringify(files)))!==publisher.treeSha256)throw Error('Publisher extracted tree mismatch');return publisher.treeSha256;
}
async function extractArchive(archive,staging){
 const {default:AdmZip}=await import('adm-zip');
 const archiveFile=path.join(staging,'publisher.zip');fs.writeFileSync(archiveFile,archive.bytes,{flag:'wx'});
 const entries=new AdmZip(archive.bytes).getEntries(),names=new Set(),files=[];let total=0;
 if(entries.length>20000)throw Error('Publisher archive entry count exceeded');
 for(const entry of entries){const name=entry.entryName,parts=name.replace(/\/$/,'').split('/'),key=name.replace(/\/$/,'').toLowerCase(),type=(entry.header.attr>>>16)&0xf000;
  if(parts[0]!==publisher.prefix||parts.some(part=>!part||part==='.'||part==='..'||/[:\\\0]/.test(part))||names.has(key)||![0,0x4000,0x8000].includes(type)||entry.header.flags&1)throw Error('Invalid publisher archive entry');names.add(key);
  if(!entry.isDirectory){if(parts.length<2||entry.header.size>128*1024**2)throw Error('Invalid publisher archive file');total+=entry.header.size;files.push(entry);}
 }
 if(files.length!==publisher.fileCount||total!==publisher.bytes)throw Error('Publisher archive census mismatch');
 const output=path.join(staging,'toolchain');fs.mkdirSync(output);
 for(const entry of files){const destination=path.join(output,...entry.entryName.split('/'));fs.mkdirSync(path.dirname(destination),{recursive:true});const bytes=entry.getData();if(bytes.length!==entry.header.size)throw Error('Publisher archive file size mismatch');fs.writeFileSync(destination,bytes,{flag:'wx'});}
 const directory=path.join(output,publisher.prefix);tree(directory);unchanged(archive);return {directory,archiveFile};
}

/** Diagnostic only: no receipt or optional compiler path issues release authority. */
export async function buildWindowsAbsence(args){
 const options=parse(args),hostFacts=host(options.archive); // Before filesystem/spawn/import of archive code.
 const {arch}=options,records=new Map(),output=path.join(root,'data','verification','windows',`win32-${arch}`),evidence=path.join(root,'.artifacts','p3r','windows-native');
 for(const directory of [sourceDirectory,output,evidence])ancestors(directory,records);
 const source=capture(path.join(sourceDirectory,'windows-installation-absence.c'),2*1024**2),core=capture(path.join(sourceDirectory,'windows-installation-absence-core.h'),64*1024);
 const present=filenames.map(name=>exists(path.join(output,name)));let previous=[];
 if(present.some(Boolean)){if(!present.every(Boolean))throw Error('Partial Windows diagnostic output');verifyArtifact(output,arch);previous=filenames.map(name=>capture(path.join(output,name),name.endsWith('.exe')?2*1024**2:4096));}
 const receiptPath=path.join(evidence,`build-${arch}.json`),previousReceipt=exists(receiptPath)?capture(receiptPath,1024**2):undefined;
 let archive;
 if(options.archive){archive=capture(path.resolve(options.archive),publisher.size);if(archive.bytes.length!==publisher.size||sha(archive.bytes)!==publisher.sha256)throw Error('Publisher archive size/SHA mismatch');}
 for(const record of [source,core,...records.values(),...previous,...(archive?[archive]:[]),...(previousReceipt?[previousReceipt]:[])])unchanged(record);
 fs.mkdirSync(evidence,{recursive:true});const staging=fs.mkdtempSync(path.join(evidence,'diagnostic-build-'));let extracted;
 try{
  const sourceSnapshot=path.join(staging,'windows-installation-absence.c'),coreSnapshot=path.join(staging,'windows-installation-absence-core.h');fs.writeFileSync(sourceSnapshot,source.bytes,{flag:'wx'});fs.writeFileSync(coreSnapshot,core.bytes,{flag:'wx'});
  const snapshots=[capture(sourceSnapshot,2*1024**2),capture(coreSnapshot,64*1024)];
  if(archive)extracted=await extractArchive(archive,staging);
  const compiler=extracted?path.join(extracted.directory,'bin',arch==='x64'?'x86_64-w64-mingw32-clang.exe':'aarch64-w64-mingw32-clang.exe'):options.compiler??(process.platform==='win32'?'cl.exe':arch==='x64'?'x86_64-w64-mingw32-gcc':'aarch64-w64-mingw32-gcc');
  const executable=path.join(staging,filenames[0]),msvc=/^cl(?:\.exe)?$/i.test(path.basename(compiler));
  const command=msvc?['/nologo','/std:c11','/W4','/WX','/O2','/MT','/GS','/guard:cf',sourceSnapshot,`/Fe:${executable}`,`/Fo:${path.join(staging,'windows-installation-absence.obj')}`,'/link','/DYNAMICBASE','/NXCOMPAT','/GUARD:CF','shell32.lib','ole32.lib','advapi32.lib','uuid.lib']:['-std=c11','-Wall','-Wextra','-Werror','-O2','-static','-fstack-protector-all','-mguard=cf','-Wl,--dynamicbase','-Wl,--nxcompat',sourceSnapshot,'-o',executable,'-lshell32','-lole32','-ladvapi32','-luuid'];
  const result=spawnSync(compiler,command,{cwd:staging,encoding:'utf8',timeout:60000,maxBuffer:1024**2,shell:false,windowsHide:true});
  if(result.error||result.signal||result.status!==0)throw Error('Windows diagnostic compilation failed: '+(result.error?.message??result.stderr??result.signal??result.status));
  const compiled=capture(executable,2*1024**2),offset=compiled.bytes.length>=64?compiled.bytes.readUInt32LE(60):-1;
  if(compiled.bytes.toString('ascii',0,2)!=='MZ'||offset<64||offset+24>compiled.bytes.length||compiled.bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||compiled.bytes.readUInt16LE(offset+4)!==(arch==='x64'?0x8664:0xaa64))throw Error('Windows diagnostic PE target mismatch');
  const manifest={version:1,target:`win32-${arch}`,sha256:sha(compiled.bytes),sourceSha256:sha(source.bytes),coreSha256:sha(core.bytes)},manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  for(const record of [source,core,...snapshots,compiled,...records.values(),...previous,...(archive?[archive]:[]),...(previousReceipt?[previousReceipt]:[])])unchanged(record);
  if(extracted){if(!fs.readFileSync(extracted.archiveFile).equals(archive.bytes))throw Error('Private publisher archive changed');tree(extracted.directory);}
  const receipt={version:1,target:manifest.target,compiler,arguments:command,exitCode:result.status,...hostFacts,...manifest,compilerStdout:result.stdout,compilerStderr:result.stderr,archiveSha256:archive?publisher.sha256:null,treeSha256:archive?publisher.treeSha256:null,executedOnWindows:false,controllerQualified:false,releaseQualified:false,dependencyCustodyVerified:false,peSecurityQualified:false};
  ancestors(output,new Map());ancestors(evidence,new Map());fs.mkdirSync(output,{recursive:true});publish(output,filenames[0],compiled.bytes);publish(output,filenames[1],manifestBytes);
  verifyArtifact(output,arch);if(!fs.readFileSync(path.join(output,filenames[0])).equals(compiled.bytes)||!fs.readFileSync(path.join(output,filenames[1])).equals(manifestBytes))throw Error('Windows diagnostic publication changed');unchanged(source);unchanged(core);
  publish(evidence,path.basename(receiptPath),Buffer.from(JSON.stringify(receipt,null,2)+'\n'));return receipt;
 }finally{fs.rmSync(staging,{recursive:true,force:true,maxRetries:3});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const receipt=await buildWindowsAbsence(process.argv.slice(2));console.log(JSON.stringify(receipt));}
