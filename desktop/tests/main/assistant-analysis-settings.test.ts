import {it,expect,vi} from 'vitest';import {LoopStore} from '../../electron/loop-store.js';import {AssistantAnalysisSettings} from '../../electron/assistant-analysis-settings.js';
it('requires explicit user selection, persists only this feature model and never silently falls back',async()=>{
 const store=new LoopStore(':memory:'),bootstrap=vi.fn(async()=>{throw Error('resources unavailable');});const service=new AssistantAnalysisSettings({store,models:()=>[{modelId:'supported',label:'Explicit supported model'}],bootstrap,onInvalidated:()=>{}});
 try{expect(service.status().selectedModelId).toBeNull();expect(bootstrap).not.toHaveBeenCalled();await expect(service.configure({modelId:'supported',expectedRevision:0,requestSource:'agent'})).rejects.toThrow('user_only');
 await expect(service.configure({modelId:'forged',expectedRevision:0,requestSource:'user'})).rejects.toThrow('model_unavailable');expect(bootstrap).not.toHaveBeenCalled();
 expect((await service.configure({modelId:'supported',expectedRevision:0,requestSource:'user'})).state).toBe('unavailable');expect(service.status().selectedModelId).toBe('supported');expect(bootstrap).toHaveBeenCalledOnce();expect(service.current()).toBeUndefined();
 await expect(service.configure({modelId:'supported',expectedRevision:0,requestSource:'user'})).rejects.toThrow('conflict');
 }finally{store.close();}
});
it('rejects a bootstrapped provider with a different model and never revives a drifted provider implicitly',async()=>{
 const store=new LoopStore(':memory:');const identity={modelEpoch:1,configFingerprint:'a'.repeat(64)};let drift=false;
 const port={contract:{id:'test',provider:'test',model:'wire',tokenizer:'test',protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const},measureInput:()=>1,complete:async()=>({text:'',usage:'unknown' as const,finish:'complete' as const})};
 let modelId='wrong';const service=new AssistantAnalysisSettings({store,models:()=>[{modelId:'selected',label:'Selected'}],bootstrap:async()=>({modelId,identity,port,readCurrentModel:()=>drift?{...identity,modelEpoch:2}:identity}),readCurrentModel:()=>identity,onInvalidated:()=>{}});
 try{expect((await service.configure({modelId:'selected',expectedRevision:0,requestSource:'user'})).state).toBe('unavailable');expect(service.current()).toBeUndefined();modelId='selected';expect((await service.configure({modelId:'selected',expectedRevision:1,requestSource:'user'})).state).toBe('ready');drift=true;expect(service.current()).toBeUndefined();drift=false;expect(service.current()).toBeUndefined();}finally{store.close();}
});
