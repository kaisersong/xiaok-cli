const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const asar=require('../../desktop/node_modules/@electron/asar');
const {packNodeChild}=require('../../desktop/scripts/pack-node-child.cjs');
test('physical closure keeps the executable mode of unpacked packaged binaries',{skip:process.platform==='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'node-child-extract-'));
 try{
  const stage=path.join(root,'source');fs.mkdirSync(path.join(stage,'bin'),{recursive:true});
  fs.writeFileSync(path.join(stage,'package.json'),'{"type":"module"}');
  const executable=path.join(stage,'bin','tool');fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const archive=path.join(root,'app.asar');await asar.createPackageWithOptions(stage,archive,{unpack:'**/bin/tool'});
  assert.equal(asar.statFile(archive,'bin/tool').unpacked,true);
  const app=packNodeChild(archive);
  assert.equal(fs.statSync(path.join(app,'bin','tool')).mode&0o777,0o755);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
