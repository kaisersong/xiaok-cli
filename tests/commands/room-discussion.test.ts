import { describe, expect, it, vi } from 'vitest';
import { runRoomDiscussion } from '../../src/commands/room-discussion.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

describe('dedicated external xiaok discussion protocol', () => {
  it('passes only the supplied fresh text and zero tools to its own adapter', async () => {
    const calls: unknown[]=[];
    const text=await runRoomDiscussion({prompt:'ONLY_ROOM_TEXT',config:DEFAULT_CONFIG,createAdapter:()=>({getModelName:()=> 'fixture',async *stream(messages,tools,system){calls.push({messages,tools,system});yield {type:'text',delta:'discussion reply'};}})});
    expect(text).toBe('discussion reply');
    expect(calls).toEqual([{messages:[{role:'user',content:[{type:'text',text:'ONLY_ROOM_TEXT'}]}],tools:[],system:expect.stringContaining('discussion')}]);
  });
  it('rejects even unsolicited tool requests without executing or returning partial success',async()=>{
    await expect(runRoomDiscussion({prompt:'read files',config:DEFAULT_CONFIG,createAdapter:()=>({getModelName:()=> 'fixture',async *stream(){yield {type:'text',delta:'partial'};yield {type:'tool_use',id:'x',name:'bash',input:{command:'touch forbidden'}};}})})).rejects.toThrow('room_discussion_tool_denied');
  });
  it('stops and closes the provider iterator at done, excluding trailing tool requests and text',async()=>{
    const closed=vi.fn(),afterDone=vi.fn();
    const text=await runRoomDiscussion({prompt:'fresh',config:DEFAULT_CONFIG,createAdapter:()=>({getModelName:()=> 'fixture',async *stream(){try{yield {type:'text',delta:'complete'};yield {type:'usage',usage:{inputTokens:1,outputTokens:1}};yield {type:'done'};afterDone();yield {type:'text',delta:'forbidden trailing text'};}finally{closed();}}})});
    expect(text).toBe('complete');expect(afterDone).not.toHaveBeenCalled();expect(closed).toHaveBeenCalledOnce();
  });
  it('refuses a forged strict-provider profile through the real conversation authorization owner',async()=>{
    const stream=vi.fn(async function*(){yield {type:'text' as const,delta:'unauthorized'};});
    await expect(runRoomDiscussion({prompt:'fresh',config:DEFAULT_CONFIG,createAdapter:()=>({getModelName:()=> 'fixture',getHarnessProfileId:()=> 'kimi-k3-coding-openai',stream})})).rejects.toThrow('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
    expect(stream).not.toHaveBeenCalled();
  });
  it('does not open an already aborted request and closes a stream on mid-response abort',async()=>{
    const already=new AbortController();already.abort(new Error('pre-abort'));const factory=vi.fn();
    await expect(runRoomDiscussion({prompt:'fresh',config:DEFAULT_CONFIG,signal:already.signal,createAdapter:factory})).rejects.toThrow('pre-abort');expect(factory).not.toHaveBeenCalled();
    const controller=new AbortController(),closed=vi.fn();let providerSignal:AbortSignal|undefined;
    await expect(runRoomDiscussion({prompt:'fresh',config:DEFAULT_CONFIG,signal:controller.signal,createAdapter:()=>({getModelName:()=> 'fixture',async *stream(_messages,_tools,_system,options){providerSignal=options?.signal;try{yield {type:'text',delta:'partial'};controller.abort(new Error('during-abort'));yield {type:'text',delta:'must not return'};}finally{closed();}}})})).rejects.toThrow('during-abort');
    expect(providerSignal?.aborted).toBe(true);expect(closed).toHaveBeenCalledOnce();
  });
});
