// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createContextResolverTool } from '../../electron/context-continuity/tool.js';
it('derives the caller solely from the trusted execution context and rejects input identity fields', async () => {
  const resolveReference = vi.fn(() => ({ messages: [] }));
  const service = { assertActor: vi.fn(), resolveReference };
  const tool = createContextResolverTool(() => ({ service: service as never, actor: { requestSource: 'user', profileId: 'p', actorId: 'desktop-user:p' } }));
  const refId = 'a'.repeat(32);
  expect(await tool.execute({ refId }, undefined)).toContain('not_readable');
  expect(await tool.execute({ refId, taskId: 'forged' }, { taskId: 'real' } as never)).toContain('invalid_argument');
  expect(resolveReference).not.toHaveBeenCalled();
  await tool.execute({ refId }, { taskId: 'real' } as never);
  expect(resolveReference).toHaveBeenCalledWith({ requestSource: 'agent', profileId: 'p', actorId: 'desktop-user:p', taskId: 'real' }, { refId });
});
it('uses the main-bound source task for child readers without granting an agentId execution ownership',async()=>{
 const resolveReference=vi.fn(()=>({messages:[]}));const tool=createContextResolverTool(()=>({service:{assertActor:vi.fn(),resolveReference} as never,actor:{requestSource:'user',profileId:'p',actorId:'desktop-user:p'}}));
 await tool.execute({refId:'a'.repeat(32)},{taskId:'agent-child',contextReaderTaskId:'task_actual_parent'} as never);
 expect(resolveReference.mock.calls[0][0]).toMatchObject({taskId:'task_actual_parent'});
 expect(await tool.execute({refId:'a'.repeat(32),contextReaderTaskId:'task_forged'},{taskId:'agent-child'} as never)).toContain('invalid_argument');
});
