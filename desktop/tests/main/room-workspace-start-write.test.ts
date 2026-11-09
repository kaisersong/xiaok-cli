// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runRoomWorkspaceExecutor} from '../../electron/room-workspace-executor.js';
import type {FileHandle} from 'node:fs/promises';
import {managedWorkspaceWrite,prepareWorkspaceRoot} from '../../electron/room-workspace-local.js';
const frame=vi.hoisted(()=>({afterPath:undefined as undefined|(()=>void),afterOpen:undefined as undefined|((handle:FileHandle)=>void)}));
vi.mock('node:fs/promises',async load=>{const actual=await load<typeof import('node:fs/promises')>();return{...actual,
  lstat:async(...args:unknown[])=>{const result=await Reflect.apply(actual.lstat,undefined,args);frame.afterPath?.();return result;},
  open:async(...args:unknown[])=>{const handle:FileHandle=await Reflect.apply(actual.open,undefined,args);frame.afterOpen?.(handle);return handle;},
};});
afterEach(()=>{frame.afterPath=undefined;frame.afterOpen=undefined;});
it.each(['path_return','open_return'] as const)('stops the actual managed file write at %s and closes any already opened own handle',async boundary=>{
  const root=mkdtempSync(join(tmpdir(),'room-write-start-'));let handle:FileHandle|undefined,allowed=true;
  const sentinel=Error('original_workspace_write_revoked');
  try{
    const binding=await prepareWorkspaceRoot(root);
    if(boundary==='path_return')frame.afterPath=()=>{allowed=false;};else frame.afterOpen=value=>{handle=value;allowed=false;};
    let failure:unknown;try{await Reflect.apply(managedWorkspaceWrite,undefined,[binding,'new-parent/result.txt','must not publish',null,()=>{if(!allowed)throw sentinel;}]);}catch(error){failure=error;}
    expect(existsSync(join(root,'new-parent','result.txt'))).toBe(false);expect(failure).toBe(sentinel);
    if(boundary==='path_return')expect(existsSync(join(root,'new-parent'))).toBe(false);
    else{expect(handle).toBeDefined();await expect(handle!.stat()).rejects.toMatchObject({code:'EBADF'});}
  }finally{frame.afterPath=undefined;frame.afterOpen=undefined;await handle?.close();rmSync(root,{recursive:true,force:true});}
});

it('retains an unconfirmed actual file close when the runner consumes the tool error and never releases the claim',async()=>{
  const root=mkdtempSync(join(tmpdir(),'room-close-unknown-')),binding=await prepareWorkspaceRoot(root),release=vi.fn(async()=>{}),sentinel=Error('actual_file_close_unconfirmed');
  let handle:FileHandle|undefined,realClose:(()=>Promise<void>)|undefined,toolReturned=false;
  frame.afterOpen=value=>{handle=value;realClose=value.close.bind(value);value.close=async()=>{throw sentinel;};};
  const context:any={roomId:'r',logicalAgentId:'a',runId:'run',claimId:'claim',executorInstanceId:'ex',workspaceId:'w',bindingId:'b',generation:1,instructionsRevision:0,effectiveCwd:binding.canonicalRoot,workspaceRoot:binding,publishedInstructions:'',contextScope:{kind:'room_only'}};
  let failure:unknown;
  try{
    try{await runRoomWorkspaceExecutor({context,prompt:'write',port:{authorize:async()=>{},acquireChild:async()=>{throw Error('no_child');},release,submitManifest:async()=>{}},createRunner:({registry})=>async()=>{try{await registry.executeTool('write',{file_path:'result.txt',content:'must remain pending'});}catch{}toolReturned=true;}});}catch(error){failure=error;}
    expect(toolReturned).toBe(true);expect(handle).toBeDefined();expect(release).not.toHaveBeenCalled();expect(failure).toBeDefined();
    const causes=(error:unknown):unknown[]=>error instanceof AggregateError?[error,...error.errors.flatMap(causes)]:error instanceof Error&&error.cause?[error,...causes(error.cause)]:[error];
    expect(causes(failure)).toContain(sentinel);
  }finally{frame.afterOpen=undefined;if(realClose)await realClose();rmSync(root,{recursive:true,force:true});}
});
