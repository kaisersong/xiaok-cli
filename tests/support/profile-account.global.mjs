import {mkdtempSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createProfileAccountOwnership,teardownProfileAccount} from './profile-account-ownership.mjs';

/** Test infrastructure only. No production path or environment override. */
export default async function setup(project){
 // Every fixture gets a private-at-birth ancestor. Shared runner TEMP ACLs
 // and 8.3 aliases are host facts, never ownership proof for a test Store.
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP};let privateTemp;
 if(process.platform==='win32'){
  if(!existsSync(new URL('../../src/runtime/native/win32-x64/windows_owner_security.node',import.meta.url))){
   const prepared=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/verification/prepare-windows-owner-security.mjs',import.meta.url)),'source'],{encoding:'utf8',windowsHide:true,timeout:180000});
   if(prepared.error||prepared.status!==0||prepared.signal)throw Error('test_private_temp_security_unavailable',{cause:prepared.error??prepared.stderr});
  }
  const {createExclusiveWindowsPrivateDirectory}=await import('../../src/runtime/windows-owner-security.js');
  privateTemp=join(realpathSync(tmpdir()),'xiaok-vitest-temp-'+randomUUID());
  createExclusiveWindowsPrivateDirectory(privateTemp);
  privateTemp=realpathSync(privateTemp);process.env.TEMP=privateTemp;process.env.TMP=privateTemp;
 }
 const installedRuntime=join(homedir(),'.xiaok','runtime','python-env');
 // Only the installed-plugin integration fixture uses these explicit paths.
 project.provide('installedSlidePythonRuntime',{
  python:process.platform==='win32'?join(installedRuntime,'Scripts','python.exe'):join(installedRuntime,'bin','python3'),
  marker:join(installedRuntime,'.deps-installed'),
 });
 const root=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-vitest-accounts-')));
 const ownership=createProfileAccountOwnership(root);
 project.provide('profileTestTempRoot',privateTemp??null);
 project.provide('profileTestAccountRoot',root);
 project.provide('profileTestAccountOwnership',ownership);
 return async()=>{
  await teardownProfileAccount(ownership);
  if(privateTemp){
   rmSync(privateTemp,{recursive:true,maxRetries:3});
   if(existsSync(privateTemp))throw Error('test_private_temp_cleanup_unconfirmed');
   console.log(JSON.stringify({kind:'test-private-temp-cleanup',root:privateTemp,removed:true}));
   for(const key of ['TEMP','TMP'])if(process.env[key]===privateTemp){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
 };
}
