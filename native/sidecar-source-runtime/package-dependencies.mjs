import {readFile,writeFile,mkdir,lstat,readdir,realpath,copyFile,stat} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
// Build inputs only. Runtime code accepts no dependency path or module resolver.
if(process.argv.length!==4)throw Error('runtime output and actual target dependency package required');
const output=resolve(process.argv[2]),databasePackage=await realpath(process.argv[3]);
const metadata=JSON.parse(await readFile(join(databasePackage,'package.json'),'utf8'));
if(metadata.name!=='better-sqlite3'||!/^13\./.test(metadata.version)||JSON.stringify(metadata.dependencies)!==JSON.stringify({'node-addon-api':'^8.0.0'}))throw Error('fixed better-sqlite3 v13 runtime contract required');
const packages=[['better-sqlite3',databasePackage]],binding='prebuilds/'+process.platform+'-'+process.arch+'.node',bindings=process.platform==='darwin'?['prebuilds/darwin-arm64.node','prebuilds/darwin-x64.node']:[binding];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),files=[],sources=[];
const permitted=(_name,path)=>path==='package.json'||path.startsWith('lib/')||bindings.includes(path);
for(const [name,root]of packages){
 const metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(metadata.name!==name)throw Error('fixed runtime dependency identity mismatch');
 async function visit(path){const entries=await readdir(path,{withFileTypes:true});for(const entry of entries){const absolute=join(path,entry.name),local=relative(root,absolute).split('\\').join('/');const facts=await lstat(absolute,{bigint:true});if(facts.isSymbolicLink())throw Error('runtime dependency symlink rejected');if(facts.isDirectory()){if(local==='lib'||local.startsWith('lib/')||local==='prebuilds')await visit(absolute);continue;}if(!permitted(name,local))continue;if(!facts.isFile())throw Error('runtime dependency plain file required');const bytes=await readFile(absolute),destination=join(output,'node_modules',name,...local.split('/'));sources.push({path:absolute,sha256:hash(bytes),bytes:bytes.length,mtimeNs:String(facts.mtimeNs)});await mkdir(dirname(destination),{recursive:true});await copyFile(absolute,destination);if(hash(await readFile(destination))!==hash(bytes))throw Error('runtime dependency copy mismatch');files.push({name,path:relative(output,destination),sha256:hash(bytes),bytes:bytes.length});}}
 await visit(root);
}
for(const [name]of packages){if(!files.some(file=>file.name===name&&file.path.endsWith('/package.json')))throw Error('runtime dependency package missing');}
for(const required of bindings)if(!files.some(file=>file.path.endsWith('/'+required)))throw Error('actual target better-sqlite3 binding required: '+required);
for(const before of sources){const bytes=await readFile(before.path),facts=await stat(before.path,{bigint:true});if(hash(bytes)!==before.sha256||String(facts.mtimeNs)!==before.mtimeNs)throw Error('runtime dependency changed during copy');}
const manifest={kind:'fixed_sidecar_runtime_dependencies_v1',qualification:false,targetAbiVerified:false,buildNode:process.versions.node,files,sources};
await writeFile(join(output,'dependency-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,packages:packages.map(([name])=>name),files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),qualification:false,targetAbiVerified:false}));
