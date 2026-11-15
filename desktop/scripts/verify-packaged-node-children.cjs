'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {packagedRuntimePaths}=require('./verify-packaged-runtime-dependencies.cjs');
const {resolveNodeChildPackage,mapNodeChildPath}=require('../electron/node-child-package.cjs');
function verify({resources,projectDir,platform,arch}){
 const relative=['dist/main/src/runtime/conversation-activity/owner-entry.js','dist/main/src/utils/credential-worker.js','dist/main/src/ai/tools/glob-worker.mjs','dist/main/desktop/electron/office-parser-worker.mjs'];
 const entries=relative.map(file=>mapNodeChildPath(resources,path.join(resources,'app.asar',file)));
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
  const worker=entries[3];
  const response=JSON.parse(run([worker],{env,input:JSON.stringify({protocolVersion:1,absolutePath:input,format:'docx',maxOutputChars:4096})}));
  if(response.ok!==true||response.engine!=='anydoc'||!response.markdown?.includes('fuse-runtime'))throw Error('packaged_office_node_child_failed: '+JSON.stringify(response));
  const cliRoot=path.join(resources,'node-child/app/node_modules/@yunzhijia/cli');
  const binary=path.join(cliRoot,'bin',platform==='win32'?'yzj-cli.exe':'yzj-cli');
  const version=JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json'),'utf8')).version;
  const actual=run([runner,binary,path.join(cliRoot,'scripts/install.js'),'--version'],{env}).trim();
  if(actual!==`yzj-cli ${version}`)throw Error('packaged_yzj_node_child_failed');
  verified=true;
 }finally{if(verified)fs.rmSync(root,{recursive:true,maxRetries:3});else console.error('Retained failed packaged Node child gate:',root);}
 return {runtimeVerified:true,entries:entries.length,officeConverted:true,yzjRunner:true};
}
module.exports=async context=>{
 const resources=path.dirname(packagedRuntimePaths(context).asarPath),arch=require('electron-builder').Arch[context.arch];
 const result=verify({resources,projectDir:context.packager.projectDir,platform:context.electronPlatformName,arch});
 console.log('packaged Node children:',JSON.stringify(result));
};
module.exports.verify=verify;
