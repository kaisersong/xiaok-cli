import {it,expect} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
it.skipIf(process.platform!=='darwin')('reads actual kernel process identity and executable twice, rejecting unknown PID and malformed arguments',()=>{
 const root=mkdtempSync(join(tmpdir(),'process-observation-'));try{
  const exe=join(root,'observe');execFileSync('/usr/bin/clang',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/process-observation.c'),'-o',exe]);
  const read=()=>JSON.parse(execFileSync(exe,[String(process.pid)],{encoding:'utf8'}));
  const first=read(),second=read();expect(first).toEqual(second);expect(first).toMatchObject({pid:process.pid,uid:process.getuid!(),realUid:process.getuid!(),executable:realpathSync(process.execPath)});expect(first.startIdentity).toMatch(/^\d+:\d+$/);
  expect(spawnSync(exe,['2147483647']).status).not.toBe(0);expect(spawnSync(exe,['1x']).status).not.toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
},10000);
