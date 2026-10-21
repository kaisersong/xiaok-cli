import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// Build-time publication only. Package readers capture current.json once, then
// read its immutable generation. Old generations are never changed underneath
// concurrent readers; this is not a runtime evidence store or authorization.
export function publishArtifactExportBuild(root,files){
 const names=Object.keys(files).sort();
 if(names.join(',')!=='GO-LICENSE,artifact-export-helper,manifest.json'&&names.join(',')!=='GO-LICENSE,artifact-export-helper.exe,manifest.json')throw Error('artifact_export_build_files');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 mkdirSync(root,{recursive:true});
 const stage=mkdtempSync(join(root,'.staging-')),generation='generation-'+randomUUID(),output=join(root,generation),pointer=join(root,'.current-'+randomUUID());
 try{
  for(const name of names){const bytes=Buffer.from(files[name]);writeFileSync(join(stage,name),bytes,{flag:'wx',mode:name.startsWith('artifact-export-helper')?0o755:0o644});if(hash(readFileSync(join(stage,name)))!==hash(bytes))throw Error('artifact_export_build_write');}
  const manifestSha256=hash(readFileSync(join(stage,'manifest.json')));
  renameSync(stage,output);
  writeFileSync(pointer,JSON.stringify({version:1,generation,manifestSha256})+'\n',{flag:'wx',mode:0o644});
  renameSync(pointer,join(root,'current.json'));
  return Object.freeze({output,generation,manifestSha256});
 }finally{rmSync(stage,{recursive:true,force:true,maxRetries:3});rmSync(pointer,{force:true,maxRetries:3});}
}
