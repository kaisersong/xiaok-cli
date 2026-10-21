import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('compiled broker child refuses an ordinary caller before any body read',()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-reader-'));
 try { const bin=join(root,'reader');const compile=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/broker-user-reader.c'),'-o',bin],{encoding:'utf8'});
 expect(compile.status,compile.stderr).toBe(0);
 const denied=spawnSync(bin,[String(process.getuid!()),'/', 'etc/passwd','4096','0','0'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
 expect(denied.status).toBe(77);expect(denied.stdout).toBe('');
 }finally{rmSync(root,{recursive:true,force:true});}
});
