import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
it.skipIf(process.platform!=='darwin').each(['audit','uid'])('keeps actual socket %s peer helper nonblocking for bidirectional maximum frames',kind=>{
 const root=mkdtempSync(join(tmpdir(),'peer-nonblock-')),helper=join(root,'peer');
 try{
  const source=resolve('src/runtime/verification/native/'+(kind==='audit'?'socket-audit-peer.c':'socket-peer.c'));
  const compiled=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',source,...(kind==='audit'?['-lbsm']:[]),'-o',helper],{encoding:'utf8'});expect(compiled.status,compiled.stderr).toBe(0);
  // External watchdog catches regressions that block the child's JS timers too.
  const actual=spawnSync(process.execPath,['--import','tsx',resolve('tests/runtime/verification/fixtures/socket-peer-large-frame.ts'),join(root,'s.sock'),helper,kind],{encoding:'utf8',timeout:5000,maxBuffer:65536});
  expect(actual.error).toBeUndefined();expect(actual.status,actual.stderr).toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
