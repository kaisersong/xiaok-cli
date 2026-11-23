'use strict';
const fs=require('node:fs');
const path=require('node:path');
const asar=require('@electron/asar');
const {packagedRuntimePaths}=require('./verify-packaged-runtime-dependencies.cjs');
function packNodeChild(asarPath){
 const resources=path.dirname(asarPath),destination=path.join(resources,'node-child');
 fs.mkdirSync(destination);
 const app=path.join(destination,'app');
 asar.extractAll(asarPath,app);
 // ASAR metadata omits executable bits for unpacked entries. extractAll then
 // writes them as ordinary data files; preserve the actual packaged source mode.
 if(process.platform!=='win32')for(const entry of asar.listPackage(asarPath)){
  const relative=entry.replace(/^[/\\]+/,'');
  const info=asar.statFile(asarPath,relative);
  if(info.unpacked&&!info.files&&!info.link){
   const source=path.join(asarPath+'.unpacked',relative);
   const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('node_child_unpacked_file_invalid');
   fs.chmodSync(path.join(app,relative),stat.mode&0o777);
  }
 }
 fs.rmSync(path.join(app,'dist','renderer'),{recursive:true,force:true});
 fs.copyFileSync(path.join(__dirname,'..','electron','node-child-bootstrap.mjs'),path.join(destination,'bootstrap.mjs'),fs.constants.COPYFILE_EXCL);
 return app;
}
module.exports=async context=>packNodeChild(packagedRuntimePaths(context).asarPath);
module.exports.packNodeChild=packNodeChild;
