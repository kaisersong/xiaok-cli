import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createProfileAccountOwnership,teardownProfileAccount} from './profile-account-ownership.mjs';

/** Test infrastructure only. No production path or environment override. */
export default async function setup(project){
 // Every fixture gets a private-at-birth ancestor. Shared runner TEMP ACLs
 // and 8.3 aliases are host facts, never ownership proof for a test Store.
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP};let privateTemp;
 if(process.platform==='win32'){
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
 project.provide('profileTestAccountRoot',root);
 project.provide('profileTestAccountOwnership',ownership);
 return async()=>{
  await teardownProfileAccount(ownership);
  if(privateTemp){
   rmSync(privateTemp,{recursive:true,maxRetries:3});
   for(const key of ['TEMP','TMP'])if(process.env[key]===privateTemp){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  }
 };
}
