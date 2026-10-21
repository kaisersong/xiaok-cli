// @vitest-environment node
import {expect,it} from 'vitest';
import {CONNECTORS_CONFIG_SCHEMA} from '../../shared/connectors-ipc-contract.js';
import {captureConnectorsOutput,registerConnectorsIpc} from '../../electron/connectors-typed-ipc.js';
import type {IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';

it('accepts DeepSeek provider DTOs with both key fields absent',()=>{
 expect(CONNECTORS_CONFIG_SCHEMA.safeParse({search:{provider:'deepseek'},fetch:{provider:'deepseek'}}).success).toBe(true);
});
const leakedConfigs=[
 {search:{provider:'deepseek',deepseekApiKey:'sk-owned-schema-only'},fetch:{provider:'deepseek'}},
 {search:{provider:'deepseek'},fetch:{provider:'deepseek',deepseekApiKey:'sk-owned-schema-only'}},
 {search:{provider:'deepseek',deepseekApiKey:undefined},fetch:{provider:'deepseek'}},
 {search:{provider:'deepseek'},fetch:{provider:'deepseek',deepseekApiKey:undefined}},
];
it.each(leakedConfigs)('rejects a DeepSeek key property even when its value is undefined: %j',config=>{
 expect(CONNECTORS_CONFIG_SCHEMA.safeParse(config).success).toBe(false);
});
it.each(leakedConfigs)('rejects a synthetic secret projection with fixed reader/mutation errors: %j',config=>{
 const snapshot={config,loadStatus:'ok',providers:[]};
 expect(()=>captureConnectorsOutput('getConnectorsConfig',snapshot)).toThrow(/^connectors_projection_unavailable$/);
 expect(()=>captureConnectorsOutput('saveConnectorsConfig',snapshot)).toThrow(/^connectors_operation_unknown$/);
});
it.each([
 {search:{provider:'deepseek',deepseekApiKey:42},fetch:{provider:'deepseek'}},
 {search:{provider:'deepseek'},fetch:{provider:'deepseek',deepseekApiKey:null}},
 {search:{provider:'unexpected-provider'},fetch:{provider:'deepseek'}},
 {search:{provider:'deepseek'},fetch:{provider:'unexpected-provider'}},
 {search:{provider:'deepseek',unknown:true},fetch:{provider:'deepseek'}},
 {search:{provider:'deepseek'},fetch:{provider:'deepseek',unknown:true}},
 {search:{provider:'deepseek'},fetch:{provider:'deepseek'},unknown:true},
])('keeps provider/key types and every object boundary strict: %j',config=>{
 expect(CONNECTORS_CONFIG_SCHEMA.safeParse(config).success).toBe(false);
});

it.each(['getConnectorsConfig','saveConnectorsConfig'])('preserves the original %s producer failure instead of replacing it with a projection error',async method=>{
 const producers=new Map<string,IpcHandlerListener>(),handlers=new Map<string,IpcHandlerListener>();
 registerConnectorsIpc({handle(channel,listener){handlers.set(channel,listener);}},producers);
 const channel='desktop:'+method,listener=handlers.get(channel);if(!listener)throw Error('missing connector handler');
 const failure=Error('owned producer failure');
 producers.set(channel,()=>{throw failure;});
 await expect(Promise.resolve().then(()=>Reflect.apply(listener,undefined,[undefined]))).rejects.toBe(failure);
 producers.set(channel,()=>Promise.reject(failure));
 await expect(Reflect.apply(listener,undefined,[undefined])).rejects.toBe(failure);
});
