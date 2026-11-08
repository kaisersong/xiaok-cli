import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyArtifact} from '../../../scripts/verification/copy-windows-absence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const names=['windows-installation-absence.exe','windows-installation-absence.json'];
function plainDirectory(directory){
 const stat=fs.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('windows_source_fixture_directory');
}
function exists(file){try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function samePair(a,b){return names.every(name=>fs.readFileSync(path.join(a,name)).equals(fs.readFileSync(path.join(b,name))));}
/** Test-layout preparation only. No execution, ordinary claim or permission. */
export function prepareWindowsSourceAbsence(){
 if(arguments.length||!['x64','arm64'].includes(process.arch))throw Error('windows_source_fixture_arguments');
 const arch=process.arch,source=path.join(root,'data','verification','windows',`win32-${arch}`);
 const parent=path.join(root,'src','runtime','verification','native'),destination=path.join(parent,`win32-${arch}`);
 for(const part of ['','data','data/verification','data/verification/windows',`data/verification/windows/win32-${arch}`,'src','src/runtime','src/runtime/verification','src/runtime/verification/native'])plainDirectory(path.join(root,part));
 const manifest=verifyArtifact(source,arch);
 if(exists(destination)){
  verifyArtifact(destination,arch);
  if(!samePair(source,destination))throw Error('windows_source_fixture_changed');
  return Object.freeze({target:manifest.target,sha256:manifest.sha256});
 }
 const staging=fs.mkdtempSync(path.join(parent,'.windows-source-fixture-'));
 try{
  for(const name of names)fs.writeFileSync(path.join(staging,name),fs.readFileSync(path.join(source,name)),{flag:'wx'});
  verifyArtifact(staging,arch);verifyArtifact(source,arch);
  if(!samePair(source,staging))throw Error('windows_source_fixture_changed');
  // Publish the complete pair; no partial-file fallback or overwrite of stale input.
  if(exists(destination))throw Error('windows_source_fixture_concurrent');
  fs.renameSync(staging,destination);
  verifyArtifact(destination,arch);
  if(!samePair(source,destination))throw Error('windows_source_fixture_changed');
  return Object.freeze({target:manifest.target,sha256:manifest.sha256});
 }finally{if(exists(staging))fs.rmSync(staging,{recursive:true});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.length!==2)throw Error('windows_source_fixture_arguments');
 if(process.platform==='win32')console.log(JSON.stringify(prepareWindowsSourceAbsence()));
 else console.log(JSON.stringify({kind:'not-windows',prepared:false}));
}
