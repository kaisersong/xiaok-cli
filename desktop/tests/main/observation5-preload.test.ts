// @vitest-environment node
// POSTAPPLY supplemental candidate; no change to frozen DESIGN15 proposal.
// Copy to desktop/tests/main/observation5-preload.test.ts.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as os from 'node:os';
import {expect,it} from 'vitest';
import {createPreloadApi} from '../../electron/preload-api.js';
import {fixture,getNativeSurrogate} from './observation5-fixture.js';
const methods=['prepareObservationTask','createObservationTask','getObservationTaskStatus','stopObservationTask','revokeObservationTask'] as const;
const semantic={mode:'mechanism-experiment',state:'compacted',reason:'changed',attempts:1,maxAttempts:2,reservedCostUnits:1000,maxCostUnits:50000000};
const compound={mode:'mechanism-experiment',edit:'succeeded',validation:'unknown',pendingOperations:0,unknownOperations:1,completedOperations:0};
function bind(mode:'ts'|'cjs',invoke:(channel:string,...args:unknown[])=>Promise<unknown>) {
 // Simulate Electron inbound public-data serialization before the fake Main port.
 // Preserve the same API string inputs; never clone Main-private approval/control.
 const ipc={invoke:(channel:string,...args:unknown[])=>invoke(channel,...structuredClone(args)),on(){},off(){},removeListener(){},send(){}};let api!:ReturnType<typeof createPreloadApi>;
 if(mode==='ts')api=createPreloadApi(ipc as never);
 else runInNewContext(readFileSync(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_key:string,value:typeof api){api=value;}}};if(name==='os')return os;throw Error('unowned_require');}});
 return api;
}
const rows=(['ts','cjs'] as const).flatMap(mode=>methods.map(method=>({mode,method})));
it.each(rows)('$mode actual binding $method calls real Main exactly once with original tuple and complete public DTO',async({mode,method})=>{
 const f=await fixture(),ordinary=f.installControllerSurrogate(),calls:unknown[][]=[];
 f.service.observationTaskDiagnostics=(()=>({semantic,compound})) as never;
 const api=bind(mode,async(channel,...args)=>{calls.push([channel,...args]);return Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},...args]);});
 let args:unknown[]=[],wire:unknown[]=[],expected:unknown;
 if(method==='createObservationTask'){const draft=await api.prepareObservationTask();args=[{draftId:draft!.draftId,prompt:'  prompt exactly  ',threadId:'thread_1'}];wire=args;expected={taskId:'owned-task'};}
 else if(method==='stopObservationTask'||method==='revokeObservationTask'){const draft=await api.prepareObservationTask();await api.createObservationTask({draftId:draft!.draftId,prompt:'owned'});args=['owned-task'];wire=[{taskId:'owned-task'}];expected={mode:'active',semantic,compound};}
 else if(method==='getObservationTaskStatus'){args=['owned-task'];wire=[{taskId:'owned-task'}];expected={mode:'active',semantic,compound};}
 calls.length=0;const value=await Reflect.apply(api[method],api,args);
 expect(calls).toEqual([['desktop:'+method,...wire]]);
 if(method==='prepareObservationTask')expect(value).toEqual({draftId:expect.any(String),expiresAt:expect.any(Number),model:'deepseek-flash'});else expect(value).toEqual(expected);
 if(method==='createObservationTask'){expect(ordinary.calls).toHaveLength(1);expect((ordinary.calls[0] as any).input.prompt).toBe('  prompt exactly  ');expect(Object.keys(value as object)).toEqual(['taskId']);}
 if(method==='stopObservationTask')expect((ordinary.stops[0] as any).context.control).toBe(ordinary.control);
 if(method==='revokeObservationTask')expect((ordinary.revokes[0] as any).context.control).toBe(ordinary.control);
});
it.each(rows)('$mode actual binding $method preserves rejection through actual registrar; no fallback DTO or retry',async({mode,method})=>{
 const f=await fixture();f.installControllerSurrogate();const failure=Error('owned-original-observation-reject'),calls:unknown[][]=[];
 const api=bind(mode,async(channel,...args)=>{calls.push([channel,...args]);return Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},...args]);});
 let args:unknown[]=[],wire:unknown[]=[];
 if(method==='prepareObservationTask')getNativeSurrogate().pickerProducer=()=>{throw failure;};
 else if(method==='createObservationTask'){const draft=await api.prepareObservationTask();args=[{draftId:draft!.draftId,prompt:'owned'}];wire=args;f.service.createObservationTask=(()=>{throw failure;}) as never;}
 else if(method==='stopObservationTask'||method==='revokeObservationTask'){const draft=await api.prepareObservationTask();await api.createObservationTask({draftId:draft!.draftId,prompt:'owned'});args=['owned-task'];wire=[{taskId:'owned-task'}];f.service[method]=(()=>{throw failure;}) as never;}
 else{args=['owned-task'];wire=[{taskId:'owned-task'}];f.service.observationTaskStatus=(()=>{throw failure;}) as never;}
 calls.length=0;await expect(Reflect.apply(api[method],api,args)).rejects.toBe(failure);expect(calls).toEqual([['desktop:'+method,...wire]]);expect(f.gate.outstanding).toBe(0);
});
it.each(['ts','cjs'] as const)('%s actual binding does not turn native chooser cancellation into an approved draft',async mode=>{const f=await fixture();getNativeSurrogate().pickerProducer=()=>Promise.resolve({canceled:true,filePaths:[]});const api=bind(mode,async(channel,...args)=>Reflect.apply(f.listeners.get(channel)!,undefined,[{sender:f.sender,senderFrame:f.frame},...args]));expect(await api.prepareObservationTask()).toBeNull();});
// Native dialogs/controller are ordinary surrogates; this is real TS+CJS binding/Main authority only.
