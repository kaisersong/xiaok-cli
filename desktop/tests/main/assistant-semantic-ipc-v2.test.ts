import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LoopStore} from '../../electron/loop-store.js';import {TimedActionStore} from '../../electron/timed-action-store.js';import {TimedActionService} from '../../electron/timed-action-service.js';import {AssistantService} from '../../electron/assistant-service.js';import {AssistantController} from '../../electron/assistant-controller.js';import {registerSemanticDesktopIpc} from '../../electron/semantic-ipc.js';
import {fixture} from './assistant-semantic-ipc-fixture.js';
import {afterEach,it,expect,vi} from 'vitest';import {IPC_SCHEMA_REGISTRY,resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';afterEach(()=>resetIpcSchemaRegistryForTests());
it('v2 overview reads durable coverage while the legacy DTO keeps its original domain',async()=>{const f=fixture();try{
 const legacy=await f.handlers.get('desktop:assistant:getOverview')!({});
 const view=await f.handlers.get('desktop:assistant:getActionOverview')!({});
 expect(view).toMatchObject({schemaVersion:2,coverageState:'unknown',coverage:[],analysisStatus:null});
 expect(Object.keys(legacy).sort()).toEqual(['profile','suggestions','pendingCandidateCount','candidates'].sort());
 expect(()=>f.handlers.get('desktop:assistant:getActionOverview')!({}, {profileId:'other'})).toThrow();
}finally{f.close();}});
it('v2 coverage rechecks current scopes and redacts disabled source counts',async()=>{const f=fixture();try{
 f.service.bootstrap();
 const {ASSISTANT_SOURCE_IDS}=await import('../../shared/assistant-coverage-contract.js');
 const profile=f.store.getAssistantProfile('default-personal-assistant')!;
 f.store.recordAssistantSourceRun({runId:'coverage',profileId:profile.id,kind:'morning',now:100,coverage:ASSISTANT_SOURCE_IDS.map(sourceId=>({sourceId,status:'checked',requestedWindow:{from:1,to:100},recordCount:7,includedCount:7,checkedAt:100,freshUntil:1000}))});
 // Exercise the public controller with a current owner profile that disables all scopes.
 const controller=new AssistantController({assistantService:{bootstrap:()=>({profile:{...profile,dataScopes:[]}}),setStatus:()=>profile},candidates:f.store,memoryStore:{} as never,memoryBackend:'layered',kbStore:{} as never});
 const dto=await controller.getActionOverview();
 expect(dto.coverage).toHaveLength(5);
 expect(dto.coverage.every(row=>row.status==='disabled'&&row.recordCount===0&&row.includedCount===0)).toBe(true);
}finally{f.close();}});
it('v2 read remains auth-first and unavailable when the controller version is old',async()=>{
 const handlers=new Map<string,Function>();
 registerSemanticDesktopIpc({handle:(channel:string,handler:Function)=>handlers.set(channel,handler)} as never,{assistant:{} as never,kswarm:{} as never});
 expect(()=>handlers.get('desktop:assistant:getActionOverview')!({})).toThrow('assistant_ipc_denied');
 const allowed=new Map<string,Function>();
 registerSemanticDesktopIpc({handle:(channel:string,handler:Function)=>allowed.set(channel,handler)} as never,{assistant:{} as never,kswarm:{} as never,authorizeAssistant:()=>true});
 await expect(allowed.get('desktop:assistant:getActionOverview')!({})).rejects.toThrow('assistant_v2_unavailable');
});
it('passes an actual durable coverage receipt through main handler, preload and home projection',async()=>{const f=fixture();try{
 f.service.bootstrap();
 const {ASSISTANT_SOURCE_IDS}=await import('../../shared/assistant-coverage-contract.js');
 const {createPreloadApi}=await import('../../electron/preload-api.js');
 const {buildAssistantHomeProjection}=await import('../../renderer/src/components/welcome-home-projection.js');
 f.store.recordAssistantSourceRun({runId:'transport-run',profileId:'default-personal-assistant',kind:'morning',now:100,coverage:ASSISTANT_SOURCE_IDS.map(sourceId=>({sourceId,status:'checked',requestedWindow:{from:1,to:100},recordCount:1,includedCount:1,checkedAt:100,freshUntil:1000}))});
 f.store.finishAssistantSourceAnalysis('transport-run','complete');
 const preload=createPreloadApi({invoke:async(channel,...args)=>f.handlers.get(channel)!({},...args),on:()=>{},off:()=>{}});
 const receipt=await preload.getAssistantActionOverview();
 const view=buildAssistantHomeProjection(receipt);
 expect(view).toMatchObject({coverageState:'known',analysisStatus:'complete',collectedAt:100});
 expect(view.coverage?.find(row=>row.sourceId==='task_snapshots')).toMatchObject({status:'checked',recordCount:1,includedCount:1});
 expect(view.suggestions).toHaveLength(3);
}finally{f.close();}});
it('keeps the old candidate list complete and pages the new production DTO through preload',async()=>{const f=fixture();try{
 f.service.bootstrap();
 f.controller.activate({requestSource:'user'});
 const begin=f.store.beginLoopRun('personal-assistant-evening-reflection',{kind:'manual'},300,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');
 f.store.stageAssistantCandidates(begin.run.id,Array.from({length:61},(_,i)=>({kind:'memory' as const,title:'Candidate '+i,content:'Content '+i,scope:'global' as const,confidence:1,evidenceRefs:[{kind:'task',id:String(i)}],dedupeKey:'memory-'+i})),301);
 f.store.finishAssistantLoopRunSuccess(begin.run.id,['evidence'],302,'Completed');
 const {createPreloadApi}=await import('../../electron/preload-api.js');
 const api=createPreloadApi({invoke:async(channel,...args)=>f.handlers.get(channel)!({},...args),on:()=>{},off:()=>{}});
 expect((await api.getAssistantOverview()).candidates).toHaveLength(61);
 const first=await api.getAssistantActionOverview();expect(first.candidates).toHaveLength(50);expect(first.nextCandidateCursor).toBeTruthy();
 const rest=await api.getAssistantCandidatePage({cursor:first.nextCandidateCursor!});expect(rest.candidates).toHaveLength(11);expect(rest.nextCursor).toBeNull();
 expect(new Set([...first.candidates,...rest.candidates].map(c=>c.id)).size).toBe(61);
 await expect(f.handlers.get('desktop:assistant:getActionCandidatesPage')!({}, {cursor:first.nextCandidateCursor,profileId:'other'})).rejects.toThrow('assistant_ipc_input');
}finally{f.close();}});
it('connects and revokes the actual calendar service through semantic main and preload without accepting actor/profile fields',async()=>{const f=fixture();try{
 const {AssistantCalendarSource}=await import('../../electron/assistant-calendar-source.js');
 const calendar=new AssistantCalendarSource({store:f.store,connect:async()=>({binary:'/verified/yzj-cli',accountId:'account'}),read:async grant=>({accountId:grant.accountId,grantEpoch:grant.epoch,records:[],completeness:'unknown'})});
 const controller=new AssistantController({calendarSource:calendar,assistantService:f.service,candidates:f.store,memoryStore:{} as never,memoryBackend:'layered',kbStore:{} as never});
 const handlers=new Map<string,Function>();registerSemanticDesktopIpc({handle:(name:string,handler:Function)=>handlers.set(name,handler)} as never,{assistant:controller,kswarm:{} as never,authorizeAssistant:()=>true});
 const {createPreloadApi}=await import('../../electron/preload-api.js');const preload=createPreloadApi({invoke:async(channel,...args)=>handlers.get(channel)!({},...args),on:()=>{},off:()=>{}});
 expect((await preload.getAssistantCalendarStatus()).enabled).toBe(false);
 expect((await preload.connectAssistantCalendar()).enabled).toBe(true);
 expect((await preload.getAssistantActionOverview()).calendar?.enabled).toBe(true);
 expect(()=>handlers.get('desktop:assistant:connectCalendar')!({},{requestSource:'agent',profile:'other'})).toThrow('assistant_ipc_input');
 expect((await preload.disconnectAssistantCalendar()).enabled).toBe(false);
}finally{f.close();}});
it('passes durable launch confirmation and original receipt through real main/preload, rejecting injected permissions',async()=>{const f=fixture();try{
 const {AssistantLaunchService}=await import('../../electron/assistant-launch-service.js');
 const source=()=>({profileId:'default-personal-assistant' as const,runId:'run',sourceVector:'a'.repeat(64),publishedAt:100,recommendations:[{title:'Read a result',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'real-task'}],action:{kind:'review' as const,reason:'Review evidence',nextStep:'Read result',instruction:'Read the result without modifying source data.'}}],isCurrent:()=>true});
 const proposal=f.store.projectAssistantActions(source(),100)[0]!;let runs=0,snapshot:any;
 const domain={lane:'local' as const,workspaceId:'workspace',cwd:'/owned/workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'};
 const launchService=new AssistantLaunchService({store:f.store,now:()=>100,isSourceLaunchable:()=>true,readSource:async()=>source(),port:{domain:async()=>domain,assertDomain:()=>{},allocate:()=>({taskId:'actual-task',control:{}}),ensure:async(input,commit)=>{commit();runs++;snapshot={taskId:input.taskId,status:'running',prompt:input.instruction,context:{threadId:input.threadId},assistantBinding:{operationId:input.operationId,requestDigest:input.requestDigest,threadId:input.threadId}};},lookup:async()=>snapshot}});
 const controller=new AssistantController({launchService,assistantService:f.service,candidates:f.store,memoryStore:{} as never,memoryBackend:'layered',kbStore:{} as never});
 const handlers=new Map<string,Function>();registerSemanticDesktopIpc({handle:(name:string,handler:Function)=>handlers.set(name,handler)} as never,{assistant:controller,kswarm:{} as never,authorizeAssistant:()=>true});
 const {createPreloadApi}=await import('../../electron/preload-api.js');const preload=createPreloadApi({invoke:async(channel,...args)=>handlers.get(channel)!({},...args),on:()=>{},off:()=>{}});
 const draft=await preload.prepareAssistantLaunch({proposalId:proposal.id,expectedRevision:1});
 await expect(handlers.get('desktop:assistant:confirmLaunch')!({},{draftId:draft.id,instruction:draft.instruction,permissionMode:'auto'})).rejects.toThrow();expect(runs).toBe(0);
 const first=await preload.confirmAssistantLaunch({draftId:draft.id,instruction:draft.instruction});
 const second=await preload.confirmAssistantLaunch({draftId:draft.id,instruction:draft.instruction});
 expect(first.operationId).toBe(second.operationId);expect(runs).toBe(1);
 expect((await preload.getAssistantLaunch({draftId:draft.id})).operation).toMatchObject({threadId:draft.threadId,taskId:'actual-task',state:'attached'});
}finally{f.close();}});
it('quality review mutations require a trusted sender, native selection and explicit human attestation',async()=>{
 const calls:unknown[]=[];const status={state:'review_required',populationCount:100,sampleCount:100,needsAction:0,seriousMisses:0,precision:null,recall:null,unknownRate:null,reason:'labels_required'};
 const handlers=new Map<string,Function>(),controller={getOverview:()=>({}),getQualityStatus:async()=>status,exportQualityReview:async(input:unknown)=>{calls.push(input);return {cancelled:false,status};},importQualityReview:async(input:unknown)=>{calls.push(input);return {cancelled:false,status};},revokeQualityReview:async(input:unknown)=>{calls.push(input);return status;}};
 registerSemanticDesktopIpc({handle:(n:string,h:Function)=>handlers.set(n,h)} as never,{assistant:controller as never,kswarm:{} as never,authorizeAssistant:event=>(event as {trusted?:boolean}).trusted===true});
 const event={trusted:true},importer=handlers.get('desktop:assistant:importQualityReview')!;
 expect(()=>importer({trusted:false},{attestHumanReview:true})).toThrow('denied');
 for(const value of [{attestHumanReview:false},{attestHumanReview:true,path:'/tmp/forged'},{attestHumanReview:true,qualified:true},{attestHumanReview:true,requestSource:'scheduler'}])await expect(Promise.resolve().then(()=>importer(event,value))).rejects.toThrow();
 expect(calls).toEqual([]);expect(await importer(event,{attestHumanReview:true})).toMatchObject({cancelled:false,status});expect(calls).toEqual([{attestHumanReview:true,requestSource:'user'}]);
 await handlers.get('desktop:assistant:exportQualityReview')!(event);expect(calls[1]).toEqual({requestSource:'user'});
 await handlers.get('desktop:assistant:revokeQualityReview')!(event);expect(calls[2]).toEqual({requestSource:'user'});
});
it('keeps analysis model selection and existing-thread listing semantic and user-only',async()=>{
 const calls:unknown[]=[],h=new Map<string,Function>(),status={revision:0,selectedModelId:null,models:[],state:'not_configured',reason:null};
 registerSemanticDesktopIpc({handle:(n:string,fn:Function)=>h.set(n,fn)} as never,{assistant:{getOverview:()=>({}),getAnalysisProvider:async()=>status,configureAnalysisProvider:async(input:unknown)=>{calls.push(input);return status;},listLaunchTargets:async(input:unknown)=>{calls.push(input);return {items:[],nextCursor:null};}} as never,kswarm:{} as never,authorizeAssistant:()=>true});
 for(const input of [{modelId:'m',expectedRevision:0,requestSource:'agent'},{modelId:'m',expectedRevision:0,apiKey:'forged'},{modelId:'m',expectedRevision:0,pythonExecutable:'/arbitrary'}])await expect(Promise.resolve().then(()=>h.get('desktop:assistant:configureAnalysisProvider')!({},input))).rejects.toThrow();
 await h.get('desktop:assistant:configureAnalysisProvider')!({},{modelId:'m',expectedRevision:0});expect(calls[0]).toEqual({modelId:'m',expectedRevision:0,requestSource:'user'});
 await h.get('desktop:assistant:listLaunchTargets')!({},{});expect(calls[1]).toEqual({requestSource:'user'});
});
it('keeps calendar memory opt-in independent and prevents caller-selected owner scope',async()=>{
 const calls:unknown[]=[],h=new Map<string,Function>();registerSemanticDesktopIpc({handle:(n:string,fn:Function)=>h.set(n,fn)} as never,{assistant:{getOverview:()=>({}),getCalendarMemorySettings:async()=>({enabled:false,revision:0}),configureCalendarMemory:async(input:unknown)=>{calls.push(input);return {enabled:true,revision:1};}} as never,kswarm:{} as never,authorizeAssistant:()=>true});
 const configure=h.get('desktop:assistant:configureCalendarMemory')!;for(const value of [{enabled:true,expectedRevision:0,ownerId:'other'},{enabled:true,expectedRevision:0,profileId:'other'},{enabled:true,expectedRevision:0,requestSource:'agent'}])await expect(Promise.resolve().then(()=>configure({},value))).rejects.toThrow();
 expect(calls).toEqual([]);expect(await configure({},{enabled:true,expectedRevision:0})).toMatchObject({enabled:true,revision:1});expect(calls).toEqual([{enabled:true,expectedRevision:0,requestSource:'user'}]);
});
