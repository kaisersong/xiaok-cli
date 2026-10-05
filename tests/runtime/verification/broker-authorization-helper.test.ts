import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
it.skipIf(process.platform!=='darwin'||process.getuid?.()===0)('ordinary processes cannot invoke the privileged GUI broker child',()=>{
 const root=mkdtempSync(join(tmpdir(),'os-authorization-'));
 try {const bin=join(root,'authorize');const build=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/broker-authorize.c'),resolve('src/runtime/verification/native/review-panel.m'),'-framework','Security','-framework','CoreFoundation','-framework','AppKit','-lbsm','-o',bin],{encoding:'utf8'});expect(build.status,build.stderr).toBe(0);
 const result=spawnSync(bin,[String(process.getuid!()),'1'],{input:'untrusted approve=true',encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});expect(result.status).toBe(77);expect(result.stdout).toBe('');
 }finally{rmSync(root,{recursive:true,force:true});}
});
