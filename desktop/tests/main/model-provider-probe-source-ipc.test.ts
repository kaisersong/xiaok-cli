// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {registerModelProviderIpc} from '../../electron/model-provider-typed-ipc.js';
import type {IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';

function fixture(operation:()=>unknown,deny?:unknown){
 const handlers=new Map<string,IpcHandlerListener>(),proof=Object.freeze({}),events:unknown[]=[],releases:unknown[]=[];
 const source={openModelProbe:vi.fn((event:unknown,body:unknown,requestSource:unknown)=>{events.push({event,body,requestSource});if(deny)throw deny;return {proof,release(){releases.push(proof);}};})};
 const service={testProviderConnection:vi.fn(operation)};
 const ipc={handle(channel:string,handler:IpcHandlerListener){handlers.set(channel,handler);}};
 registerModelProviderIpc(ipc,service as never,undefined,source as never);
 return {service,source,proof,events,releases,ipc,call:(event:unknown,input:unknown)=>handlers.get('desktop:testProviderConnection')!(event as never,input)};
}
it('passes the fixed probe proof only to the original service and retains its frame until that service settles',async()=>{
 let resolve!:(value:unknown)=>void;const work=new Promise(yes=>{resolve=yes;}),f=fixture(()=>work),event={sender:{}};
 const result=f.call(event,{providerId:'openai'});await new Promise(yes=>setImmediate(yes));
 expect(f.events).toEqual([{event,body:{schemaVersion:1,purpose:'test_provider_connection',providerId:'openai',modelId:null},requestSource:'user'}]);
 expect(f.service.testProviderConnection).toHaveBeenCalledExactlyOnceWith({providerId:'openai'},'user',f.proof);expect(f.releases).toEqual([]);
 resolve({success:true,latencyMs:1});await expect(result).resolves.toEqual({success:true,latencyMs:1});expect(f.releases).toEqual([f.proof]);
});
it('rejects the original Source denial before service IO and releases a failed accepted invocation exactly once',async()=>{
 const denied=Error('original source denied'),first=fixture(()=>({success:true}),denied);
 await expect(first.call({}, {providerId:'openai',modelId:'model'})).rejects.toBe(denied);expect(first.service.testProviderConnection).not.toHaveBeenCalled();expect(first.releases).toEqual([]);
 const raw=Error('original service rejected'),second=fixture(()=>Promise.reject(raw));
 await expect(second.call({}, {providerId:'openai',modelId:'model'})).rejects.toBe(raw);expect(second.releases).toEqual([second.proof]);
});
it('rejects replacing the source of an existing registrar',()=>{
 const f=fixture(()=>({success:true}));expect(()=>registerModelProviderIpc(f.ipc,f.service as never,undefined,{} as never)).toThrow('model_config_registrar_owner_conflict');
});
