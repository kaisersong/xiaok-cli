import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Test infrastructure only. No production path or environment override. */
export default function setup(project){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-vitest-accounts-')));
 project.provide('profileTestAccountRoot',root);
 return ()=>rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
}
