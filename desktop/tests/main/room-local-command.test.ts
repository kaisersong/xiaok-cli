// @vitest-environment node
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {createRoomLocalCommandTool} from '../../electron/room-local-command.js';
import type {ToolExecutionContext} from '../../../src/types.js';
it.skipIf(process.platform==='win32')('runs guarded commands in the bound directory and disposes known process-group descendants',async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'room-command-'));
  const tool=createRoomLocalCommandTool({cwd,onCleanupPending:()=>{throw new Error('cleanup pending');}});
  const recordUnprovenEffect=vi.fn(),context={recordUnprovenEffect} as unknown as ToolExecutionContext;
  try{
    expect(await tool.execute({command:'pwd'},context)).toContain(cwd.replace('/var/','/private/var/'));
    expect(await tool.execute({command:'sleep 60 >/dev/null 2>&1 & echo $! > child.pid; echo done'},context)).toContain('done');
    const pid=Number(readFileSync(join(cwd,'child.pid'),'utf8'));console.info('owned Room process-group child PID',pid);
    expect(()=>process.kill(pid,0)).toThrow();expect(recordUnprovenEffect).toHaveBeenCalledTimes(2);
  }finally{rmSync(cwd,{recursive:true,force:true});}
},10000);
it.skipIf(process.platform==='win32')('abort waits for a running command to exit',async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'room-command-abort-')),abort=new AbortController();
  const tool=createRoomLocalCommandTool({cwd,onCleanupPending:()=>{throw new Error('cleanup pending');}});
  const recordUnprovenEffect=vi.fn();
  const run=tool.execute({command:'echo $$ > shell.pid; sleep 60'}, {signal:abort.signal,recordUnprovenEffect} as unknown as ToolExecutionContext);
  // Observe the real spawn before aborting; a missing guard is not an abort success.
  try{
    await vi.waitFor(()=>expect(existsSync(join(cwd,'shell.pid'))).toBe(true));
    const pid=Number(readFileSync(join(cwd,'shell.pid'),'utf8'));console.info('owned Room abort shell PID',pid);
    expect(()=>process.kill(pid,0)).not.toThrow();abort.abort();
    await expect(run).rejects.toThrow();expect(()=>process.kill(pid,0)).toThrow();expect(recordUnprovenEffect).toHaveBeenCalledOnce();
  }finally{abort.abort();await run.catch(()=>{});rmSync(cwd,{recursive:true,force:true});}
},10000);
