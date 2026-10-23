import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';

/** Test infrastructure only. No production path or environment override. */
export default function setup(project){
 const installedRuntime=join(homedir(),'.xiaok','runtime','python-env');
 // Only the installed-plugin integration fixture uses these explicit paths.
 project.provide('installedSlidePythonRuntime',{
  python:process.platform==='win32'?join(installedRuntime,'Scripts','python.exe'):join(installedRuntime,'bin','python3'),
  marker:join(installedRuntime,'.deps-installed'),
 });
 const root=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-vitest-accounts-')));
 project.provide('profileTestAccountRoot',root);
 return ()=>rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
}
