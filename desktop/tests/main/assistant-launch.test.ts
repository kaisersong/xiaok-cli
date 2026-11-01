import {it,expect,vi} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';
import {AssistantLaunchService} from '../../electron/assistant-launch-service.js';
const profileId='default-personal-assistant' as const,now=Date.parse('2026-11-01T00:00:00Z');
const rec={title:'Review evidence',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'source-task'}],action:{kind:'review' as const,reason:'Review delivered work',nextStep:'Read evidence',instruction:'Review this result without modifying source data.'}};
function fixture(){
 const store=new LoopStore(':memory:');let current=true,clock=now;
 const source=()=>({profileId,runId:'run',publishedAt:now,sourceVector:'a'.repeat(64),recommendations:[rec],isCurrent:()=>current});
 const proposal=store.projectAssistantActions(source(),now)[0]!;
 const domain={lane:'local' as const,workspaceId:'workspace',cwd:'/explicit-workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'};
 let snapshot:unknown;const allocate=vi.fn(()=>({taskId:'task-one',control:{}}));
 const ensure=vi.fn(async(input:any,commit:()=>void)=>{snapshot={taskId:input.taskId,status:'understanding',prompt:input.instruction,context:{threadId:input.threadId},assistantBinding:{operationId:input.operationId,requestDigest:input.requestDigest,threadId:input.threadId}};commit();snapshot={...snapshot as object,status:'running'};});
 const service=new AssistantLaunchService({store,isSourceLaunchable:()=>true,readSource:async()=>source(),now:()=>clock,port:{domain:async()=>domain,assertDomain:()=>{},allocate,ensure,lookup:async()=>snapshot as any}});
 return {store,service,proposal,ensure,allocate,setCurrent:(value:boolean)=>{current=value;},setNow:(value:number)=>{clock=value;}};
}
it('double confirmation uses a durable draft and dispatches the formal port once',async()=>{const f=fixture();try{
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});
 const input={draftId:draft.id,instruction:draft.instruction,requestSource:'user' as const};
 const [a,b]=await Promise.all([f.service.confirm(input),f.service.confirm(input)]);
 expect(a.operationId).toBe(b.operationId);expect(f.ensure).toHaveBeenCalledTimes(1);
 expect((await f.service.get({draftId:draft.id,requestSource:'user'})).operation?.state).toBe('attached');
 await expect(f.service.confirm({...input,instruction:'Different confirmed work'})).rejects.toThrow('conflict');
}finally{f.store.close();}});
it('checks source again at the actual lane commit and never retries an unknown dispatch',async()=>{const f=fixture();try{
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});
 f.ensure.mockImplementationOnce(async(_input,commit)=>{f.setCurrent(false);commit();});
 const result=await f.service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});
 expect(result.state).toBe('outcome_unknown');f.setCurrent(true);
 await f.service.get({draftId:draft.id,requestSource:'user'});expect(f.ensure).toHaveBeenCalledTimes(1);
}finally{f.store.close();}});
it('rejects agent/scheduler mutations and expired confirmation without allocating a task',async()=>{const f=fixture();try{
 for(const requestSource of ['agent','scheduler'] as const)await expect(f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource})).rejects.toThrow('user_only');
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});f.setNow(now+600001);
 await expect(f.service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'})).rejects.toThrow('expired');expect(f.allocate).not.toHaveBeenCalled();
}finally{f.store.close();}});
it('keeps a durable operation after restart and only looks up its original task',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const root=mkdtempSync(join(tmpdir(),'assistant-launch-reopen-'));
 const path=join(root,'loop.sqlite');let store=new LoopStore(path),calls=0;
 const source=()=>({profileId,runId:'run',publishedAt:now,sourceVector:'a'.repeat(64),recommendations:[rec],isCurrent:()=>true});
 const domain={lane:'local' as const,workspaceId:'workspace',cwd:'/explicit-workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'};
 let snapshot:any;
 const port={domain:async()=>domain,assertDomain:()=>{},allocate:()=>({taskId:'durable-task',control:{}}),ensure:async(input:any,commit:()=>void)=>{calls++;commit();snapshot={taskId:input.taskId,status:'running',prompt:input.instruction,context:{threadId:input.threadId},assistantBinding:{operationId:input.operationId,requestDigest:input.requestDigest,threadId:input.threadId}};},lookup:async()=>snapshot};
 try{
  const proposal=store.projectAssistantActions(source(),now)[0]!;
  const service=new AssistantLaunchService({store,port,readSource:async()=>source(),isSourceLaunchable:()=>true,now:()=>now});
  const draft=await service.prepare({proposalId:proposal.id,expectedRevision:1,requestSource:'user'});
  const first=await service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});
  store.close();store=new LoopStore(path);
  const recovered=new AssistantLaunchService({store,port,readSource:async()=>source(),isSourceLaunchable:()=>true,now:()=>now+1});
  const second=await recovered.get({draftId:draft.id,requestSource:'user'});
  expect(second.operation?.operationId).toBe(first.operationId);expect(second.operation?.taskId).toBe('durable-task');expect(calls).toBe(1);
  snapshot={...snapshot,status:'failed',sessionId:'session',events:[],result:{summary:'A failed task'}};
  const terminal=(await recovered.get({draftId:draft.id,requestSource:'user'})).operation!;
  await recovered.resolve({draftId:draft.id,expectedResultDigest:terminal.resultDigest!,requestSource:'user'});
  expect(snapshot.status).toBe('failed');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
it('defaults launch eligibility to deny when the source owner provides no common fence',async()=>{const f=fixture();try{
 const service=new AssistantLaunchService({store:f.store,readSource:async()=>({profileId,runId:'run',publishedAt:now,sourceVector:'a'.repeat(64),recommendations:[rec],isCurrent:()=>true}),port:{} as never,now:()=>now});
 await expect(service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'})).rejects.toThrow('source_unavailable');
}finally{f.store.close();}});
it('starts an accepted follow-up only after its own explicit prepare and confirm',async()=>{const f=fixture();try{
 const domain={lane:'local' as const,workspaceId:'workspace',cwd:'/explicit-workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'};
 const source=()=>({profileId,runId:'evening-run',publishedAt:now,sourceVector:'c'.repeat(64),recommendations:[{...rec,action:{...rec.action,kind:'follow_up' as const}}],isCurrent:()=>true});
 const service=new AssistantLaunchService({store:f.store,now:()=>now,isSourceLaunchable:()=>true,readSource:async()=>undefined,readFollowUpSource:async id=>id==='accepted-candidate'?source():undefined,port:{domain:async()=>domain,assertDomain:()=>{},allocate:f.allocate,ensure:f.ensure,lookup:async()=>undefined}});
 await expect(service.prepareFollowUp({candidateId:'memory-candidate',requestSource:'user'})).rejects.toThrow('source_unavailable');
 const draft=await service.prepareFollowUp({candidateId:'accepted-candidate',requestSource:'user'});expect(f.ensure).not.toHaveBeenCalled();
 await service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});expect(f.ensure).toHaveBeenCalledOnce();
}finally{f.store.close();}});
it('reconfirms a blocked undispatched operation without replacing its durable identity',async()=>{const f=fixture();try{
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});
 // Simulate a pre-allocation admission failure; no formal task can exist.
 f.allocate.mockImplementationOnce(()=>{throw Error('workspace_not_ready');});
 const blocked=await f.service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});
 expect(blocked).toMatchObject({state:'blocked',taskId:null});
 const retry=await f.service.prepareReconfirmation({draftId:draft.id,requestSource:'user'});
 const actual=await f.service.confirm({draftId:retry.id,instruction:'New complete confirmed requirements.',requestSource:'user'});
 expect(actual.operationId).toBe(blocked.operationId);expect(f.ensure).toHaveBeenCalledOnce();
 expect((await f.service.get({draftId:draft.id,requestSource:'user'})).operation?.operationId).toBe(actual.operationId);
 await expect(f.service.prepareReconfirmation({draftId:retry.id,requestSource:'user'})).rejects.toThrow('reconfirmation_denied');
}finally{f.store.close();}});
it.each(['agent','scheduler'] as const)('denies %s across every launch mutation sibling before dispatch',async requestSource=>{const f=fixture();try{
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});
 await expect(f.service.prepareFollowUp({candidateId:'candidate',requestSource})).rejects.toThrow('user_only');
 await expect(f.service.prepareReconfirmation({draftId:draft.id,requestSource})).rejects.toThrow('user_only');
 await expect(f.service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource})).rejects.toThrow('user_only');
 await expect(f.service.resolve({draftId:draft.id,expectedResultDigest:'a'.repeat(64),requestSource})).rejects.toThrow('user_only');
 await expect(f.service.cancel({draftId:draft.id,requestSource})).rejects.toThrow('user_only');
 expect(f.ensure).not.toHaveBeenCalled();
}finally{f.store.close();}});
it('cancels proven undispatched work and never reopens it through reconfirmation',async()=>{const f=fixture();try{
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});f.allocate.mockImplementationOnce(()=>{throw Error('not-ready');});
 await f.service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});
 expect((await f.service.cancel({draftId:draft.id,requestSource:'user'})).state).toBe('cancelled');
 await expect(f.service.prepareReconfirmation({draftId:draft.id,requestSource:'user'})).rejects.toThrow('reconfirmation_denied');
 expect(f.ensure).not.toHaveBeenCalled();
}finally{f.store.close();}});
it('cancel requested before the lane commit prevents execution without releasing an unknown claim',async()=>{const f=fixture();let release!:()=>void;try{
 let enter!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;});
 f.ensure.mockImplementationOnce(async(_input,commit)=>{enter();await pending;commit();});
 const draft=await f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user'});
 const confirming=f.service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});void confirming.catch(()=>{});await entered;
 const cancelled=await f.service.cancel({draftId:draft.id,requestSource:'user'});expect(cancelled.state).toBe('outcome_unknown');
 release();expect((await confirming).state).toBe('outcome_unknown');expect(f.ensure).toHaveBeenCalledOnce();
}finally{release?.();f.store.close();}});
it('persists an existing target, binds its digest and rejects changed ownership before allocation',async()=>{
 const f=fixture();try{
 const target={kind:'existing' as const,threadId:'00000000-0000-4000-8000-000000000001',title:'Owned thread',profileId:'p',workspaceId:'workspace',revision:1,goalBinding:null};
 let valid=true;const assert=()=>{if(!valid)throw Error('assistant_thread_target_stale');};
 const service=new AssistantLaunchService({store:f.store,now:()=>now,isSourceLaunchable:()=>true,readSource:async()=>({profileId,runId:'run',publishedAt:now,sourceVector:'a'.repeat(64),recommendations:[rec],isCurrent:()=>true}),threadTargets:{prepare:async()=>target,validate:async()=>assert(),assertCurrent:assert},port:{domain:async()=>({lane:'local',workspaceId:'workspace',cwd:'/explicit-workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'}),assertDomain:()=>{},allocate:f.allocate,ensure:f.ensure,lookup:async()=>undefined}});
 const input={proposalId:f.proposal.id,expectedRevision:1,requestSource:'user' as const};
 const fresh=await service.prepare(input),draft=await service.prepare({...input,existingThreadId:target.threadId});
 expect(draft.id).not.toBe(fresh.id);expect(draft.threadId).toBe(target.threadId);expect(f.store.readAssistantLaunchDraft(draft.id)?.threadTarget).toEqual(target);
 valid=false;await expect(service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'})).rejects.toThrow('stale');expect(f.allocate).not.toHaveBeenCalled();
 valid=true;await service.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});expect(f.store.readAssistantLaunchOperation(draft.id,'draft_id')?.threadTarget).toEqual(target);
 }finally{f.store.close();}
});
it('fails closed for existing targets without main target ownership capability',async()=>{const f=fixture();try{
 await expect(f.service.prepare({proposalId:f.proposal.id,expectedRevision:1,requestSource:'user',existingThreadId:'00000000-0000-4000-8000-000000000001'})).rejects.toThrow('existing_thread_unsupported');expect(f.allocate).not.toHaveBeenCalled();
}finally{f.store.close();}});
it('rechecks target at start and never replays a changed Goal target',async()=>{
 const f=fixture();try{
 let changed=false,starts=0;
 const target={kind:'existing' as const,threadId:'local-owned',title:'Owned',profileId:'p',workspaceId:'workspace',revision:1,goalBinding:null};
 const service=new AssistantLaunchService({store:f.store,now:()=>now,isSourceLaunchable:()=>true,readSource:async()=>({profileId,runId:'run',publishedAt:now,sourceVector:'a'.repeat(64),recommendations:[rec],isCurrent:()=>true}),threadTargets:{prepare:async()=>target,validate:async()=>{},assertCurrent:()=>{if(changed)throw Error('goal_requires_new_thread');}},port:{domain:async()=>({lane:'local',workspaceId:'workspace',cwd:'/explicit-workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'}),assertDomain:()=>{},allocate:f.allocate,ensure:async(_input,commit)=>{changed=true;commit();starts++;},lookup:async()=>undefined}});
 const draft=await service.prepare({proposalId:f.proposal.id,expectedRevision:1,existingThreadId:'local-owned',requestSource:'user'});
 const input={draftId:draft.id,instruction:draft.instruction,requestSource:'user' as const};
 expect((await service.confirm(input)).state).toBe('outcome_unknown');expect(starts).toBe(0);
 await service.confirm(input);expect(f.allocate).toHaveBeenCalledTimes(1);
 }finally{f.store.close();}
});
it('lists bounded main targets using actual domain, user-only and revalidates after read',async()=>{
 const f=fixture();try{
 const domain={lane:'local' as const,workspaceId:'workspace',cwd:'/explicit-workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'};
 let changed=false,page:any={items:[{threadId:'local-owned',title:'Owned',available:true,reason:null}],nextCursor:null};
 const list=vi.fn(async(actual:any,input:any)=>{expect(actual).toEqual(domain);expect(input).toEqual({cursor:'next'});return page;});
 const service=new AssistantLaunchService({store:f.store,readSource:async()=>undefined,threadTargets:{list,prepare:async()=>{throw Error();},validate:async()=>{},assertCurrent:()=>{}},port:{domain:async()=>domain,assertDomain:()=>{if(changed)throw Error('domain_changed');}} as any});
 await expect(service.listTargets({cursor:'next',requestSource:'agent'})).rejects.toThrow('user_only');expect(list).not.toHaveBeenCalled();
 expect((await service.listTargets({cursor:'next',requestSource:'user'})).items).toHaveLength(1);
 page={items:Array.from({length:51},()=>({threadId:'x',title:'x',available:true,reason:null})),nextCursor:null};await expect(service.listTargets({cursor:'next',requestSource:'user'})).rejects.toThrow();
 page={items:[{threadId:'x',title:'x'.repeat(160*1024),available:true,reason:null}],nextCursor:null};await expect(service.listTargets({cursor:'next',requestSource:'user'})).rejects.toThrow('page_too_large');
 changed=true;await expect(service.listTargets({requestSource:'user'})).rejects.toThrow('domain_changed');
 }finally{f.store.close();}
});
