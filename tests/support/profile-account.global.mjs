import {mkdtempSync,realpathSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProfileAccountOwnership,teardownProfileAccount} from './profile-account-ownership.mjs';

/** Test infrastructure only. No production path or environment override. */
export default function setup(project){
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
 return ()=>teardownProfileAccount(ownership);
}
