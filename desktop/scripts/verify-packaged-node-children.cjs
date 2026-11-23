'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {packagedRuntimePaths}=require('./verify-packaged-runtime-dependencies.cjs');
const {resolveNodeChildPackage,mapNodeChildPath}=require('../electron/node-child-package.cjs');
const {entries:childEntrypoints}=require('./prune-node-child.cjs');
function verify({resources,projectDir,platform,arch}){
 const locate=file=>mapNodeChildPath(resources,path.join(resources,'app.asar',file));
 const entries=Object.values(childEntrypoints).map(locate);
 const runner=path.join(resources,'yzj-cli/runner.cjs');entries.push(runner);
 for(const entry of entries)if(!fs.statSync(entry).isFile())throw Error('packaged_node_child_missing');
 if(platform!==process.platform||arch!==process.arch)return {runtimeVerified:false,entries:entries.length};
 const runtime=resolveNodeChildPackage(resources,process.env);
 function run(args,options={}){
  const r=spawnSync(runtime.command,[...runtime.argsPrefix,...args],{env:runtime.env,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024,...options});
  if(r.error||r.status!==0||r.signal)throw Error('packaged_node_child_failed: '+(r.error?.message||r.stderr||r.stdout||r.status));return r.stdout;
 }
 for(const entry of entries)run(['--check',entry]);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-node-child-gate-'));
 const env={...runtime.env,HOME:root,USERPROFILE:root,XDG_CONFIG_HOME:root,XIAOK_CONFIG_DIR:path.join(root,'config')};
 let verified=false;
 try{
  const input=path.resolve(projectDir,'../tests/fixtures/office-parser/fuse-runtime.docx');
  const ownerUrl=pathToFileURL(locate(childEntrypoints.activityOwner)).href;
  const keyringUrl=pathToFileURL(locate('dist/main/src/utils/fixed-keyring-native.js')).href;
  run(['--input-type=module','--eval',`await import(${JSON.stringify(ownerUrl)});
    const {loadFixedKeyringEntry}=await import(${JSON.stringify(keyringUrl)});
    if(typeof loadFixedKeyringEntry()!=='function') throw Error('packaged_keyring_not_loaded');`],{env});
  const globUrl=pathToFileURL(locate(childEntrypoints.glob)).href;
  fs.writeFileSync(path.join(root,'package-smoke.txt'),'glob smoke');
  run(['--input-type=module','--eval',`import {Worker} from 'node:worker_threads';
    const worker=new Worker(new URL(${JSON.stringify(globUrl)}),{
      execArgv:[],resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:8,stackSizeMb:2},
      workerData:{kind:'glob',scoped:false,input:{cwd:${JSON.stringify(root)},patterns:['package-smoke.txt']},
        limits:{maxEntries:10,maxDirectories:10,maxResults:10,maxPathBytes:8192}}});
    let matched=false;
    worker.once('message',result=>{matched=result.ok===true&&result.entries?.length===1;});
    worker.once('exit',code=>{if(code!==0||!matched) throw Error('packaged_glob_failed');});`],{env});
  const worker=locate(childEntrypoints.office);
  const response=JSON.parse(run([worker],{env,input:JSON.stringify({protocolVersion:1,absolutePath:input,format:'docx',maxOutputChars:4096})}));
  if(response.ok!==true||response.engine!=='anydoc'||!response.markdown?.includes('fuse-runtime'))throw Error('packaged_office_node_child_failed: '+JSON.stringify(response));
  const cliRoot=path.join(resources,'node-child/app/node_modules/@yunzhijia/cli');
  const binary=path.join(cliRoot,'bin',platform==='win32'?'yzj-cli.exe':'yzj-cli');
  const version=JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json'),'utf8')).version;
  const actual=run([runner,binary,locate(childEntrypoints.yzjInstaller),'--version'],{env}).trim();
  if(actual!==`yzj-cli ${version}`)throw Error('packaged_yzj_node_child_failed');
  verified=true;
 }finally{if(verified)fs.rmSync(root,{recursive:true,maxRetries:3});else console.error('Retained failed packaged Node child gate:',root);}
 return {runtimeVerified:true,entries:entries.length,ownerImported:true,keyringLoaded:true,globSearched:true,officeConverted:true,yzjRunner:true};
}
module.exports=async context=>{
 const resources=path.dirname(packagedRuntimePaths(context).asarPath),arch=require('electron-builder').Arch[context.arch];
 const result=verify({resources,projectDir:context.packager.projectDir,platform:context.electronPlatformName,arch});
 console.log('packaged Node children:',JSON.stringify(result));
};
module.exports.verify=verify;
