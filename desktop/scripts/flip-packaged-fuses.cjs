'use strict';
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const {flipFuses,getCurrentFuseWire,FuseVersion,FuseV1Options}=require('@electron/fuses');
async function secureElectron(appPath,resetAdHocDarwinSignature=false){
 await flipFuses(appPath,{version:FuseVersion.V1,
  [FuseV1Options.RunAsNode]:false,[FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,
  [FuseV1Options.EnableNodeCliInspectArguments]:false,[FuseV1Options.OnlyLoadAppFromAsar]:true});
 if(resetAdHocDarwinSignature){
  // Do not --deep resign the pinned official Node runtime: its byte hash
  // remains the immutable runtime lock. Repair only the mutated framework
  // and its enclosing app seal using anonymous identities.
  const frameworks=path.join(appPath,'Contents','Frameworks');
  for(const name of fs.readdirSync(frameworks))if(name.endsWith('.framework')||name.endsWith('.app'))execFileSync('codesign',['--force','--sign','-',path.join(frameworks,name)]);
  execFileSync('codesign',['--force','--sign','-',appPath]);
 }
 const wire=await getCurrentFuseWire(appPath);
 for(const key of [FuseV1Options.RunAsNode,FuseV1Options.EnableNodeOptionsEnvironmentVariable,FuseV1Options.EnableNodeCliInspectArguments])if(wire[key]!==48)throw Error('packaged_fuse_not_disabled');
 if(wire[FuseV1Options.OnlyLoadAppFromAsar]!==49)throw Error('packaged_asar_fuse_not_enabled');
 return wire;
}
module.exports=async context=>{
 const mac=context.electronPlatformName==='darwin',name=context.packager.appInfo.productFilename;
 const executable=path.join(context.appOutDir,mac?name+'.app':name+(context.electronPlatformName==='win32'?'.exe':''));
 // Anonymous Mach-O repair only; release distribution signing follows afterPack.
 console.log('packaged Electron fuse wire:',JSON.stringify(await secureElectron(executable,mac&&process.platform==='darwin')));
};
module.exports.secureElectron=secureElectron;
