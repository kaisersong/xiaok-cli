const {createHash}=require('node:crypto');
const {readFileSync,lstatSync,mkdirSync,copyFileSync,writeFileSync,chmodSync,existsSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {execFileSync}=require('node:child_process');
const lock=require('../resources/broker-runtime-lock.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function regular(path){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('broker_runtime_alias');return stat;}
function directory(path){const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('broker_runtime_alias');}
function prepareBrokerRuntime({archive,cacheRoot,target}) {
 const entry=lock.targets[target];if(!entry)throw Error('broker_runtime_target');
 regular(archive);
 if(digest(readFileSync(archive))!==entry.archiveSha256)throw Error('broker_runtime_archive_digest');
 const destination=join(cacheRoot,target);
 if(existsSync(destination))throw Error('broker_runtime_cache_exists');
 mkdirSync(destination,{recursive:true});
 // Extract only fixed, provenance-pinned members to stdout. Archive paths are
 // never materialized, so no traversal or symlink member can escape the cache.
 const binary=execFileSync('tar',['-xOf',resolve(archive),entry.member],{maxBuffer:160*1024*1024,windowsHide:true});
 const license=execFileSync('tar',['-xOf',resolve(archive),entry.license],{maxBuffer:1048576,windowsHide:true});
 if(binary.length<1048576||license.length===0)throw Error('broker_runtime_archive');
 writeFileSync(join(destination,entry.executable),binary,{flag:'wx',mode:0o755});chmodSync(join(destination,entry.executable),0o755);
 writeFileSync(join(destination,'LICENSE'),license,{flag:'wx'});
 const manifest={schema:'xiaok-broker-runtime/v1',target,node:lock.node,sqlite:lock.sqlite,executable:entry.executable,archiveSha256:entry.archiveSha256,executableSha256:digest(binary)};
 writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 return manifest;
}
function shipBrokerRuntime({cacheRoot,resources,target}) {
 const entry=lock.targets[target];if(!entry)return {target,qualified:false,reason:'legacy_runtime_target'};
 const source=join(cacheRoot,target);directory(source);
 const sourceManifest=join(source,'manifest.json');regular(sourceManifest);
 const manifest=JSON.parse(readFileSync(sourceManifest,'utf8'));
 if(manifest.schema!=='xiaok-broker-runtime/v1'||manifest.target!==target||manifest.node!==lock.node||manifest.sqlite!==lock.sqlite||manifest.executable!==entry.executable||manifest.archiveSha256!==entry.archiveSha256)throw Error('broker_runtime_manifest');
 for(const name of [entry.executable,'LICENSE'])regular(join(source,name));
 if(digest(readFileSync(join(source,entry.executable)))!==manifest.executableSha256)throw Error('broker_runtime_digest');
 let dir=resources;directory(dir);
 for(const name of ['services','intent-broker','runtime',target]){
  dir=join(dir,name);if(!existsSync(dir))mkdirSync(dir);directory(dir);
 }
 for(const name of [entry.executable,'LICENSE','manifest.json']) {
  const dest=join(dir,name);if(existsSync(dest))regular(dest);
  copyFileSync(join(source,name),dest);
 }
 chmodSync(join(dir,entry.executable),0o755);
 if(digest(readFileSync(join(dir,entry.executable)))!==manifest.executableSha256)throw Error('broker_runtime_digest');
 return manifest;
}
async function afterPack(context){
 const {Arch}=require('electron-builder'),target=context.electronPlatformName+'-'+Arch[context.arch];
 const resources=context.electronPlatformName==='darwin'?join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents','Resources'):join(context.appOutDir,'resources');
 return shipBrokerRuntime({cacheRoot:join(context.packager.projectDir,'.broker-runtimes'),resources,target});
}
module.exports=afterPack;
module.exports.prepareBrokerRuntime=prepareBrokerRuntime;
module.exports.shipBrokerRuntime=shipBrokerRuntime;
if(require.main===module){
 const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);if(index<0||!args[index+1])throw Error('missing '+name);return args[index+1];};
 try{console.log(JSON.stringify(prepareBrokerRuntime({archive:option('--archive'),cacheRoot:option('--cache'),target:option('--target')})));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
