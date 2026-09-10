// @vitest-environment node
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {createRoomLocalCommandTool} from '../../electron/room-local-command.js';
import type {ToolExecutionContext} from '../../../src/types.js';
it.skipIf(process.platform==='win32')('runs real commands in the bound directory and disposes background descendants',async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'room-command-'));
  const tool=createRoomLocalCommandTool({cwd,onCleanupPending:()=>{throw new Error('cleanup pending');}});
  expect(await tool.execute({command:'pwd'},undefined)).toContain(cwd.replace('/var/','/private/var/'));
  expect(await tool.execute({command:'sleep 60 >/dev/null 2>&1 & echo $! > child.pid; echo done'},undefined)).toContain('done');
  const pid=Number(readFileSync(join(cwd,'child.pid'),'utf8'));
  expect(()=>process.kill(pid,0)).toThrow();
},10000);
it.skipIf(process.platform==='win32')('abort waits for a running command to exit',async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'room-command-abort-')),abort=new AbortController();
  const tool=createRoomLocalCommandTool({cwd,onCleanupPending:()=>{throw new Error('cleanup pending');}});
  const run=tool.execute({command:'sleep 60'}, {signal:abort.signal} as ToolExecutionContext);
  setTimeout(()=>abort.abort(),100);
  await expect(run).rejects.toThrow();
},10000);
