'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {resolvePackagedBrokerRuntime,sanitizeRuntimeEnv,assertRuntimeFileReadsKnown}=require('./broker-runtime-package.cjs');
function mapNodeChildPath(resources,entry){
 const root=path.resolve(resources);
 for(const name of ['app.asar','app.asar.unpacked']){
  const source=path.join(root,name),relative=path.relative(source,entry);
  if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)){
   const result=path.join(root,'node-child','app',relative);
   let stat;try{stat=fs.lstatSync(result);}catch(cause){throw Error('node_child_entry_missing',{cause});}
   if(!stat.isFile()||stat.isSymbolicLink())throw Error('node_child_entry_missing');
   const app=fs.realpathSync(path.join(root,'node-child','app'));
   const physical=fs.realpathSync(result),inside=path.relative(app,physical);
   if(!inside||inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside))throw Error('node_child_entry_escape');
   return result;
  }
 }
 return entry;
}
function resolveNodeChildPackage(resources,env){
 const runtime=resolvePackagedBrokerRuntime({isPackaged:true,resourcesPath:resources,env});
 if(!runtime)throw Error('node_child_runtime_unsupported');
 const bootstrap=path.join(resources,'node-child','bootstrap.mjs');
 const stat=fs.lstatSync(bootstrap);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('node_child_bootstrap_invalid');
 return Object.freeze({command:runtime.command,env:runtime.env,argsPrefix:Object.freeze(['--import',require('node:url').pathToFileURL(bootstrap).href])});
}
module.exports=Object.freeze({mapNodeChildPath,resolveNodeChildPackage,sanitizeRuntimeEnv,assertRuntimeFileReadsKnown});
