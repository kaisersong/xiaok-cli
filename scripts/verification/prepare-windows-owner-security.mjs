import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=join(root,'native/windows-owner-security'),cache=join(root,'.artifacts/windows-owner-security/win32-x64');
const binary='windows_owner_security.node',json='windows_owner_security.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHash=()=>hash(Buffer.concat(['binding.gyp','windows-owner-security.c','windows-profile-custody.c'].map(name=>Buffer.concat([Buffer.from(name+'\0'),readFileSync(join(source,name))]))));
function read(path,limit){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>limit)throw Error('windows_security_build_file');return readFileSync(path);}
function validate(directory){
 const bytes=read(join(directory,binary),4*1024*1024),manifest=JSON.parse(read(join(directory,json),4096));
 const offset=bytes.length>=64?bytes.readUInt32LE(60):-1;
 if(!manifest||Object.keys(manifest).sort().join(',')!=='napi,sha256,sourceSha256,target,version'||manifest.version!==1||manifest.napi!==8||manifest.target!=='win32-x64'||manifest.sourceSha256!==sourceHash()||manifest.sha256!==hash(bytes)||bytes.toString('ascii',0,2)!=='MZ'||offset<64||offset+24>bytes.length||bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==0x8664||(bytes.readUInt16LE(offset+22)&0x2000)===0)throw Error('windows_security_build_mismatch');
 return {bytes,manifest};
}
function publish(directory,name,bytes){
 mkdirSync(directory,{recursive:true});if(lstatSync(directory).isSymbolicLink())throw Error('windows_security_build_alias');
 const temporary=join(directory,'.'+name+'.'+process.pid);writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,join(directory,name));
}
const mode=process.argv[2]??'source';
if(!['source','cli','desktop','test'].includes(mode))throw Error('windows_security_build_mode');
let artifact;
try{artifact=validate(cache);}catch(error){
 try{artifact=validate(join(root,'data/windows-owner-security/win32-x64'));}catch{}
 if(artifact){/* Source-bound reviewed prebuilt supports clean non-Windows builds. */}
 else {
 if(process.platform!=='win32'||process.arch!=='x64'){
  if(process.argv.includes('--require-all'))throw error;
  console.log('Windows owner security artifact not present on this non-Windows build');process.exit(0);
 }
 const before=sourceHash(),require=createRequire(join(root,'package.json'));
 const result=spawnSync(process.execPath,[require.resolve('node-gyp/bin/node-gyp.js'),'rebuild','--directory',source,'--arch=x64'],{stdio:'inherit',windowsHide:true,timeout:180000});
 if(result.error||result.status!==0||sourceHash()!==before)throw Error('windows_security_compile_failed');
 const bytes=read(join(source,'build/Release',binary),4*1024*1024),manifest={version:1,target:'win32-x64',napi:8,sha256:hash(bytes),sourceSha256:before};
 publish(cache,binary,bytes);publish(cache,json,Buffer.from(JSON.stringify(manifest)+'\n'));artifact=validate(cache);
 }
}
const sourceOutput=join(root,'src/runtime/native/win32-x64');
const directory=mode==='source'?sourceOutput:mode==='cli'?join(root,'dist/runtime/native/win32-x64'):mode==='test'?join(root,'.test-dist/src/runtime/native/win32-x64'):join(root,'desktop/dist/main/src/runtime/native/win32-x64');
for(const output of new Set([cache,sourceOutput,directory])){publish(output,binary,artifact.bytes);publish(output,json,Buffer.from(JSON.stringify(artifact.manifest)+'\n'));validate(output);}
console.log(JSON.stringify({target:'win32-x64',napi:8,sha256:artifact.manifest.sha256,sourceSha256:artifact.manifest.sourceSha256,directory}));
