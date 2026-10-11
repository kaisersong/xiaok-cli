import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpClientConnection } from '../../../src/platform/mcp/transport.js';
import { callMcpToolWithTasks } from '../../../src/platform/mcp/tasks.js';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationMcpActivities } from '../../../src/runtime/conversation-activity/mcp.js';
const actor = { requestSource: 'user' as const, actorId: 'user' };
async function fixture(drop = false) {
  const root = mkdtempSync(join(tmpdir(),'activity-wire-input-'));
  const connection = await createMcpClientConnection('input-task',{type:'stdio',command:process.execPath,args:[join(process.cwd(),'tests/support/mcp-tasks-stdio-server.js')],env:{XIAOK_TEST_TASK_DELAY_MS:'20',...(drop ? {XIAOK_TEST_STREAM_DROP:'1'} : {})},protocol:{mode:'modern',version:'2026-07-28'}});
  const store = new ConversationActivityStore(join(root,'activity.sqlite')); let mcp!: ConversationMcpActivities;
  const service = new ConversationActivityService({store,profileId:'profile',actorId:'user',getThread: threadId=>({threadId,profileId:'profile',workspaceId:'workspace',deleteState:'none'}),canObserveWork:watch=>mcp.canObserve(watch)});
  mcp = new ConversationMcpActivities({store,service,actorId:'user',originThread:async()=> 'thread'});mcp.register(connection);
  const observer = await mcp.observer('task','call',connection);
  await callMcpToolWithTasks(connection,{name:'work',arguments:{ask:true}},{observer,detachOnTask:true,timeout:2000});
  await vi.waitFor(()=>expect(store.getProjection('mcp:call')?.executionState).toBe('input_required'),{timeout:3000});
  return {store,service,mcp,connection,async close(){ mcp.dispose();service.dispose();await connection.close();store.close();rmSync(root,{recursive:true,force:true}); },async stats(){const r=await connection.client.callTool({name:'stats',arguments:{}});return JSON.parse((r.content[0] as {text:string}).text);} };
}
describe('pending elicitation on the real modern wire',()=>{
  it('never chooses the SDK implicit cancel when waiting, stopping observation or disposing the client',async()=>{
    const f=await fixture();try{
      await new Promise(resolve=>setTimeout(resolve,100));expect(await f.stats()).toEqual({calls:1,updates:0,cancels:0});
      await f.service.stopWatch('mcp:call',0,actor);f.mcp.stopWatch('mcp:call');
      await new Promise(resolve=>setTimeout(resolve,50));expect(await f.stats()).toEqual({calls:1,updates:0,cancels:0});
      expect((await f.connection.tasks!.task(f.store.getMcpReference('mcp:call')!.taskId).snapshot()).status).toBe('input_required');
    }finally{await f.close();}
  });
  it('re-establishes a remotely ended acknowledged stream without recreating the task or answering the pending input',async()=>{
    const f=await fixture(true);try{
      await vi.waitFor(async()=>expect((await f.stats()).listens).toBeGreaterThanOrEqual(2),{timeout:4000});
      const stats=await f.stats();expect(stats.calls).toBe(1);expect(stats.updates).toBe(0);expect(stats.cancels).toBe(0);
      expect(f.store.getProjection('mcp:call')?.executionState).toBe('input_required');
    }finally{await f.close();}
  });
  it('validates the complete requested schema before the one explicit user update and restores only the original task',async()=>{
    const f=await fixture();try{
      const [form]=await f.mcp.inputs('mcp:call',actor);
      for(const count of [0,1.5,4]) await expect(f.mcp.answerInput('mcp:call',{inputId:form.inputId,expectedDigest:form.expectedDigest,action:'accept',content:{format:'pdf',count}},actor)).rejects.toThrow('activity_mcp_input_invalid');
      expect((await f.stats()).updates).toBe(0);
      await f.mcp.answerInput('mcp:call',{inputId:form.inputId,expectedDigest:form.expectedDigest,action:'accept',content:{format:'pdf',count:2}},actor);
      expect(await f.stats()).toEqual({calls:1,updates:1,cancels:0});
      expect(f.store.getProjection('mcp:call')?.executionState).toBe('completed');
    }finally{await f.close();}
  });
});
