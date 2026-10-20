const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Arch}=require('electron-builder');

/** Artifact completeness only. Runtime qualification and original OS-owner
 * receipts remain mandatory; this does not import code or access credentials. */
const AUTH_OWNER_BINARY_SHA256='5319f2e03161415f75a88ccf251fc43fbc9a86c62481e2f8430f6b831cd54c6c';
function verify({resources,platform,arch}){
 if(platform!=='darwin'||arch!=='arm64')return {qualified:false};
 const root=path.resolve(resources,'services');
 function file(relative){
  const target=path.join(root,relative);
  if(fs.realpathSync(target)!==target||!fs.lstatSync(target).isFile())throw new Error('packaged continuity resource missing or escaping: '+relative);
  return target;
 }
 const authBinary=path.resolve(resources,'continuity-auth','darwin-arm64','codex-app-server');
 if(fs.realpathSync(authBinary)!==authBinary||!fs.lstatSync(authBinary).isFile())throw new Error('packaged continuity-auth binary missing or escaping');
 const authSha256=crypto.createHash('sha256').update(fs.readFileSync(authBinary)).digest('hex');
 if(authSha256!==AUTH_OWNER_BINARY_SHA256)throw new Error('packaged continuity-auth binary hash mismatch');
 const packages=[
  ['continuity-sync','@xiaok/continuity-sync','0.1.0'],['continuity-device','@xiaok/continuity-device','0.1.0'],
  ['continuity-sync/node_modules/libsodium-wrappers','libsodium-wrappers','0.8.4'],
  ['continuity-sync/node_modules/libsodium','libsodium','0.8.4'],
  ['continuity-device/node_modules/@napi-rs/keyring','@napi-rs/keyring','2.1.1'],
  ['continuity-device/node_modules/@napi-rs/keyring-darwin-arm64','@napi-rs/keyring-darwin-arm64','2.1.1'],
 ];
 for(const [directory,name,version]of packages){const metadata=JSON.parse(fs.readFileSync(file(directory+'/package.json'),'utf8'));if(metadata.name!==name||metadata.version!==version)throw new Error('packaged continuity version mismatch: '+name);}
 for(const name of ['device-owner','outbox','journal','transport','sync-driver','receiver','crypto','identity','content-revocation','event-entry','private-files'])file('continuity-sync/src/'+name+'.mjs');
 for(const name of ['device-lock','os-backend','os-guard'])file('continuity-device/src/'+name+'.mjs');
 for(const pkg of ['libsodium','libsodium-wrappers'])for(const [directory,extension]of [['modules','js'],['modules-esm','mjs']])file(`continuity-sync/node_modules/${pkg}/dist/${directory}/${pkg}.${extension}`);
 file('continuity-device/node_modules/@napi-rs/keyring/index.js');
 file('continuity-device/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node');
 return {qualified:true,scope:'resource-completeness-only'};
}
module.exports=async context=>{
 const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`,'Contents','Resources'):path.join(context.appOutDir,'resources');
 verify({resources,platform:context.electronPlatformName,arch:Arch[context.arch]});
};
module.exports.verify=verify;
