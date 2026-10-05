import {readFileSync,existsSync,mkdirSync,copyFileSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),args=process.argv.slice(2);
if(!['cli','desktop'].includes(args[0])||args.slice(1).some(arg=>arg!=='--require-all')||args.length>2)throw Error('verification_native_copy_arguments');
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const targetRoot=args[0]==='cli'?join(root,'dist/runtime/verification/native'):join(root,'desktop/dist/main/src/runtime/verification/native');
for(const arch of ['x64','arm64']){
 const source=join(root,'data/verification/windows','win32-'+arch),binary=join(source,'windows-installation-absence.exe'),manifestPath=join(source,'windows-installation-absence.json');
 const required=args.includes('--require-all')||(process.platform==='win32'&&process.arch===arch);
 if(!existsSync(binary)||!existsSync(manifestPath)){if(required)throw Error('verification_native_windows_artifact_missing_'+arch+'; build this commit in an MSVC developer prompt: node scripts/verification/build-windows-absence.mjs --target '+arch);continue;}
 for(const path of [binary,manifestPath]){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('verification_native_artifact_path');}
 const body=readFileSync(binary),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(body.length>2*1024**2||Object.keys(manifest).sort().join(',')!=='coreSha256,sha256,sourceSha256,target,version'||manifest.sourceSha256!==digest(join(root,'src/runtime/verification/native/windows-installation-absence.c'))||manifest.coreSha256!==digest(join(root,'src/runtime/verification/native/windows-absence-core.h'))||manifest.version!==1||manifest.target!=='win32-'+arch||manifest.sha256!==createHash('sha256').update(body).digest('hex'))throw Error('verification_native_artifact_hash');
 const destination=join(targetRoot,'win32-'+arch);mkdirSync(destination,{recursive:true});
 copyFileSync(binary,join(destination,'windows-installation-absence.exe'));copyFileSync(manifestPath,join(destination,'windows-installation-absence.json'));
}
