import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
it.skipIf(process.platform!=='darwin'&&process.platform!=='linux')('compiles a native sleep-inclusive monotonic clock and observes real increasing kernel values',()=>{
 const root=mkdtempSync(join(tmpdir(),'continuous-clock-')),helper=join(root,'clock');try{
  const built=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/continuous-clock.c'),'-o',helper],{encoding:'utf8'});expect(built.status,built.stderr).toBe(0);
  const read=()=>{const result=spawnSync(helper,[],{encoding:'utf8',timeout:5000});expect(result.status).toBe(0);const data=JSON.parse(result.stdout);expect(data.kind).toBe(process.platform==='darwin'?'mach-continuous':'linux-boottime');expect(data.nanoseconds).toMatch(/^[0-9]+$/);return BigInt(data.nanoseconds);};const first=read();expect(read()).toBeGreaterThan(first);
 }finally{rmSync(root,{recursive:true,force:true});}
});
