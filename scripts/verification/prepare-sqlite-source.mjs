import {existsSync,readFileSync,mkdirSync,mkdtempSync,renameSync,lstatSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// Build-only source input. Runtime databases use node:sqlite, not this amalgamation.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),parent=join(root,'native/sqlite-source/build'),output=join(parent,'3.53.4');
const files={'sqlite3.c':'b1dd5d74ec7f29055a6684fa06fb3c2f6821c87dd38f9a458dfd2e8a1db28189','sqlite3.h':'919e7f2e8ed1d8f56ac17b412b8971c76aa5d1a879752cc6058f75e7d5910e1d'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function check(path){if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory())throw Error('sqlite_source_directory_invalid');for(const [name,expected]of Object.entries(files)){const file=join(path,name),facts=lstatSync(file);if(facts.isSymbolicLink()||!facts.isFile()||facts.nlink!==1||hash(readFileSync(file))!==expected)throw Error('sqlite_source_hash_mismatch');}}
if(existsSync(output)){check(output);}else{
 mkdirSync(parent,{recursive:true});if(lstatSync(parent).isSymbolicLink())throw Error('sqlite_source_directory_invalid');
 const response=await fetch('https://www.sqlite.org/2026/sqlite-amalgamation-3530400.zip',{signal:AbortSignal.timeout(40000)});if(!response.ok)throw Error('sqlite_source_download_failed_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>4*1024**2||hash(bytes)!=='1e71ddf93849c6a6ecf58b827c0692073d2dd7ee40196158068f7b29f422e87d')throw Error('sqlite_source_archive_hash_mismatch');
 const staging=mkdtempSync(join(parent,'.source-'));
 const python=process.platform==='win32'?'python':'python3';
 const script="import io,zipfile,sys,pathlib\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nfor name in ['sqlite3.c','sqlite3.h']:\n data=z.read('sqlite-amalgamation-3530400/'+name)\n with (pathlib.Path(sys.argv[1])/name).open('xb') as f:f.write(data)\n";
 const child=spawnSync(python,['-c',script,staging],{input:bytes,encoding:'buffer',timeout:30000});if(child.error||child.status!==0)throw Error('sqlite_source_unpack_failed',{cause:child.error});
 check(staging);renameSync(staging,output);
}
console.log(JSON.stringify({sqliteSource:'3.53.4',output,files,runtimeDriver:'node:sqlite',qualification:false}));
