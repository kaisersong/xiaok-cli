import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDirectory = path.join(sourceRoot, 'src/runtime/verification/native');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyArtifact(directory, arch) {
  const executable=path.join(directory,'windows-installation-absence.exe');
  const manifestPath=path.join(directory,'windows-installation-absence.json');
  if(!fs.existsSync(executable)||!fs.existsSync(manifestPath)) throw Error('Windows absence artifact missing: '+directory);
  for(const file of [executable,manifestPath]){
    const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1) throw Error('Invalid Windows absence artifact file');
  }
  const bytes=fs.readFileSync(executable), manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(Object.keys(manifest).sort().join(',')!=='coreSha256,sha256,sourceSha256,target,version'||manifest.version!==1||manifest.target!==`win32-${arch}`) throw Error('Invalid Windows absence manifest target');
  if(bytes.length>2*1024*1024||sha(bytes)!==manifest.sha256) throw Error('Windows absence SHA mismatch');
  if(manifest.sourceSha256!==sha(fs.readFileSync(path.join(sourceDirectory,'windows-installation-absence.c')))||manifest.coreSha256!==sha(fs.readFileSync(path.join(sourceDirectory,'windows-installation-absence-core.h')))) throw Error('Windows absence source mismatch');
  const offset=bytes.length>=64?bytes.readUInt32LE(60):-1;
  const expected=arch==='x64'?0x8664:arch==='arm64'?0xaa64:undefined;
  if(!expected||bytes.toString('ascii',0,2)!=='MZ'||offset<64||offset+6>bytes.length||bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==expected) throw Error('Windows absence PE target mismatch');
  return manifest;
}

export function copyWindowsAbsence(root, {check=false,archs=['x64','arm64']}={}) {
  const moduleDirectory=path.join(root,'dist/runtime/verification');
  if(!fs.existsSync(path.join(moduleDirectory,'windows-installation-absence.js'))) return;
  for(const arch of archs){
    const destination=path.join(moduleDirectory,'native',`win32-${arch}`);
    if(!check){
      const source=path.join(sourceRoot,'data/verification/windows',`win32-${arch}`);
      verifyArtifact(source,arch);fs.mkdirSync(destination,{recursive:true});
      for(const name of ['windows-installation-absence.exe','windows-installation-absence.json'])fs.copyFileSync(path.join(source,name),path.join(destination,name));
    }
    verifyArtifact(destination,arch);
  }
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2), get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const arch=get('--arch');
  copyWindowsAbsence(path.resolve(get('--root')??sourceRoot),{check:args.includes('--check'),archs:arch?[arch]:['x64','arm64']});
}
