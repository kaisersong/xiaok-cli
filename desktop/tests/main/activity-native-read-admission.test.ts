import {expect,it,vi} from 'vitest';
import * as ipc from '../../electron/conversation-activity-ipc.js';
import {projectActivityAttention} from '../../../src/runtime/conversation-activity/attention-projector.js';
function fixture(){const handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>();let taskAllowed=true,destroyed=false;const sender={id:1,isDestroyed:()=>destroyed,on:vi.fn(),once:vi.fn(),removeListener:vi.fn(),send:vi.fn()},event={sender};const service={getWork:vi.fn(),dismissAttention:vi.fn(),nativeQuestions:vi.fn(),nativeAnswer:vi.fn(),assertNativeReadResultCurrent:vi.fn()} as unknown as ipc.ConversationActivityIpcService;
 const close=ipc.registerConversationActivityIpc({handle:(channel,handler)=>{handlers.set(channel,handler as never);}},service,()=>({actorId:'user'}),{authorize:()=>taskAllowed&&!destroyed?{actorId:'user'}:null});
 const watch={operationId:'operation',watchId:'watch',source:'task_host' as const,logicalSourceId:'host',sourceDataEpoch:'session',workId:'task',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'},status:'active' as const,generation:0,preference:'normal' as const,policyRevision:0,nextReportDueAt:0},projection={watchId:'watch',executionState:'running' as const,businessOutcome:'unknown' as const,freshness:'fresh' as const,sourceSequence:0,revision:0,lastProgressAt:null,lastHeartbeatAt:null,lastReportAt:null,evidenceRefs:[]};const view={watch,projection,presentation:projectActivityAttention(watch,projection)};
 return{handlers,service,event,close,view,revoke:()=>{taskAllowed=false;},destroy:()=>{destroyed=true;}};
}
it('mints a short-lived original-handler read admission and rejects clones, other facade owners and settled calls',async()=>{
 const f=fixture();let captured:unknown;vi.mocked(f.service.getWork).mockImplementation(async(_watch,actor,frame)=>{captured=frame;expect(frame).toBeDefined();expect(ipc.inspectNativeActivityReadAdmission(frame,f.service).actor).toEqual(actor);expect(()=>ipc.inspectNativeActivityReadAdmission(structuredClone(frame),f.service)).toThrow('activity_native_read_forbidden');expect(()=>ipc.inspectNativeActivityReadAdmission(frame,{})).toThrow('activity_native_read_forbidden');return f.view;});
 try{await f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'});expect(()=>ipc.inspectNativeActivityReadAdmission(captured,f.service)).toThrow('activity_native_read_forbidden');}finally{f.close();}
});
it('rechecks actual task permission after a suspended read and retires its original frame on error',async()=>{
 const f=fixture();let release!:()=>void,enter!:()=>void,captured:unknown;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});vi.mocked(f.service.getWork).mockImplementation(async(_watch,_actor,frame)=>{captured=frame;enter();await gate;return f.view;});
 const pending=f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'}),rejected=expect(pending).rejects.toThrow('activity_native_read_forbidden');await entered;f.revoke();release();try{await rejected;expect(()=>ipc.inspectNativeActivityReadAdmission(captured,f.service)).toThrow('activity_native_read_forbidden');}finally{f.close();}
});
it('requires the original TaskActor port for Native forms even when broader activity authorization allows the window',async()=>{
 const f=fixture();f.revoke();try{await expect(f.handlers.get('desktop:activity:nativeQuestions')!(f.event,{watchId:'watch'})).rejects.toThrow('activity_native_read_forbidden');expect(f.service.nativeQuestions).not.toHaveBeenCalled();}finally{f.close();}
});
it('checks the original TaskActor at the real outer output stage after closed parsing, and expires the frame on rejection',async()=>{
 const f=fixture();let frame:unknown;const raw={...f.view};Object.defineProperty(raw,'presentation',{enumerable:true,get(){queueMicrotask(f.revoke);return f.view.presentation;}});vi.mocked(f.service.getWork).mockImplementation(async(_watch,_actor,scope)=>{frame=scope;return raw;});
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow('activity_native_read_forbidden');expect(f.service.assertNativeReadResultCurrent).not.toHaveBeenCalled();expect(()=>ipc.inspectNativeActivityReadAdmission(frame,f.service)).toThrow('activity_native_read_forbidden');}finally{f.close();}
});
it('requires the fixed original output proof verifier and rejects an asynchronously returned guard',async()=>{
 const f=fixture();vi.mocked(f.service.getWork).mockResolvedValue(f.view);try{
  f.service.assertNativeReadResultCurrent=undefined;await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow('activity_native_read_forbidden');
  f.service.assertNativeReadResultCurrent=vi.fn(async()=>{});await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow('activity_native_read_guard_invalid');
 }finally{f.close();}
});
it('checks a Native source proof at final output and releases the original frame if that proof was withdrawn',async()=>{
 const f=fixture();let frame:unknown;vi.mocked(f.service.getWork).mockImplementation(async(_watch,_actor,scope)=>{frame=scope;return f.view;});vi.mocked(f.service.assertNativeReadResultCurrent!).mockImplementation(()=>{throw Error('native_question_inventory_stale');});
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow('native_question_inventory_stale');expect(()=>ipc.inspectNativeActivityReadAdmission(frame,f.service)).toThrow('activity_native_read_forbidden');}finally{f.close();}
});
it('keeps the ordinary MCP path once when initial TaskActor capture denies, with no admission fallback after a started read fails',async()=>{
 const f=fixture();const watch={...f.view.watch,source:'mcp' as const,logicalSourceId:'endpoint'},view={...f.view,watch,presentation:projectActivityAttention(watch,f.view.projection)};vi.mocked(f.service.getWork).mockResolvedValue(view);f.revoke();
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).resolves.toEqual(view);expect(f.service.getWork).toHaveBeenCalledTimes(1);expect(f.service.getWork).toHaveBeenCalledWith('watch',{requestSource:'user',actorId:'user'});}finally{f.close();}
});
it('returns the original accepted void answer ACK even if the window is revoked after its decision',async()=>{
 const f=fixture();let frame:unknown;vi.mocked(f.service.nativeAnswer!).mockImplementation(async(_watch,_input,_actor,scope)=>{frame=scope;ipc.inspectNativeActivityReadAdmission(scope,f.service);f.revoke();});
 try{await expect(f.handlers.get('desktop:activity:nativeAnswer')!(f.event,{watchId:'watch',questionRef:'native-question:example',expectedDigest:'a'.repeat(64),choiceId:'approve'})).resolves.toBeUndefined();expect(f.service.nativeAnswer).toHaveBeenCalledTimes(1);expect(f.service.assertNativeReadResultCurrent).not.toHaveBeenCalled();expect(()=>ipc.inspectNativeActivityReadAdmission(frame,f.service)).toThrow('activity_native_read_forbidden');}finally{f.close();}
});
it('rejects unknown Native question form fields and actor or owner routing fields before exposing them',async()=>{
 const f=fixture();vi.mocked(f.service.nativeQuestions!).mockResolvedValue([{questionRef:'native-question:example',questionId:'c3be498e-0c2c-4e61-a00b-ae40d7da1c74',expectedDigest:'a'.repeat(64),sourceRevision:1,prompt:'original request',choices:['approve','deny'],nativeSessionId:'caller-selected'}] as never);
 try{await expect(f.handlers.get('desktop:activity:nativeQuestions')!(f.event,{watchId:'watch'})).rejects.toThrow();for(const extra of [{actorId:'other'},{nativeSessionId:'other'},{requestSource:'agent'}])await expect(f.handlers.get('desktop:activity:nativeAnswer')!(f.event,{watchId:'watch',questionRef:'q',expectedDigest:'a'.repeat(64),choiceId:'approve',...extra})).rejects.toThrow();expect(f.service.nativeAnswer).not.toHaveBeenCalled();}finally{f.close();}
});
