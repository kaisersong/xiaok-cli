import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const patchRoot=path.dirname(fileURLToPath(import.meta.url));
const destination=path.resolve(process.argv[2]??'.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json'),'utf8'));
if(pkg.name!=='xiaokcode'||pkg.version!=='1.5.6')throw Error('This patch supports xiaokcode 1.5.6 only');
if(process.platform==='win32'&&process.arch!=='x64')throw Error('This native patch is x64 only');
const reader=fs.readFileSync(path.join(destination,'dist/runtime/verification/windows-installation-absence.js'),'utf8');
if(!reader.includes("'windows-installation-absence.exe'")||!reader.includes('readWindowsInstallationAbsence'))throw Error('Unsupported Windows reader');
const manifest=JSON.parse(fs.readFileSync(path.join(patchRoot,'manifest.json'),'utf8'));
const files=[
 'dist/runtime/verification/native/win32-x64/windows-installation-absence.exe',
 'dist/runtime/verification/native/win32-x64/windows-installation-absence.json',
 'dist/utils/crash-reporter.js','dist/utils/crash-reporter.d.ts',
];
if(!Array.isArray(manifest)||manifest.length!==files.length||manifest.some((item,index)=>item.file!==files[index]))throw Error('Unsupported patch manifest');
const writes=manifest.map(item=>{
 const bytes=fs.readFileSync(path.join(patchRoot,'payload',item.file));
 if(sha(bytes)!==item.sha256)throw Error('Payload verification failed: '+item.file);
 if(item.file.endsWith('.js')){
  const result=spawnSync(process.execPath,['--check',path.join(patchRoot,'payload',item.file)],{encoding:'utf8'});
  if(result.status!==0)throw Error('Syntax verification failed: '+item.file);
 }
 return {...item,bytes};
});
const nativeManifest=JSON.parse(writes[1].bytes.toString('utf8'));
const executable=writes[0].bytes;
const pe=executable.readUInt32LE(60);
if(nativeManifest.target!=='win32-x64'||nativeManifest.version!==1||nativeManifest.sha256!==sha(executable)||executable.toString('ascii',0,2)!=='MZ'||pe+6>executable.length||executable.toString('ascii',pe,pe+4)!=='PE\0\0'||executable.readUInt16LE(pe+4)!==0x8664)throw Error('Invalid Windows x64 native payload');
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({version:pkg.version,files:writes.length,dryRun:true}));process.exit(0);
}
const backup=path.join(destination,`.windows-startup-backup-${Date.now()}`);
fs.mkdirSync(backup,{recursive:true});
for(const item of writes){
 const target=path.join(destination,item.file);
 if(fs.existsSync(target)){
  const saved=path.join(backup,item.file);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(target,saved);
 }
}
for(const item of writes){
 const target=path.join(destination,item.file);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const temporary=target+'.windows-startup.tmp';fs.writeFileSync(temporary,item.bytes);fs.renameSync(temporary,target);
 if(sha(fs.readFileSync(target))!==item.sha256)throw Error('Installation verification failed: '+item.file);
}
console.log(JSON.stringify({version:pkg.version,files:writes.length,backup}));
if(process.platform==='win32'){
 const {readWindowsInstallationAbsence}=await import(pathToFileURL(path.join(destination,'dist/runtime/verification/windows-installation-absence.js')));
 const kind=readWindowsInstallationAbsence();
 console.log('Windows installation check: '+kind);
 if(kind!=='ordinary'){
  console.error('Windows installation check did not qualify this machine for ordinary sessions. Do not bypass this check.');
  process.exitCode=1;
 }
}
