import { types } from 'node:util';
import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { CHANNEL_MCP_READONLY_METHODS, CHANNEL_MCP_READONLY_INPUT_SCHEMA, CHANNEL_MCP_READONLY_OUTPUT_SCHEMAS } from '../shared/channel-mcp-readonly-ipc-contract.js';
const isPromise=types.isPromise,NativePromise=Promise,nativeThen=Promise.prototype.then,apply=Reflect.apply;
const owners=new WeakMap<IpcHandleRegistrar,ReadonlyMap<string,IpcHandlerListener>|null>();
export function registerChannelMcpReadonlyIpc(ipc:IpcHandleRegistrar,rawProducers?:ReadonlyMap<string,IpcHandlerListener>):void {
 const producers=rawProducers??null;
 if(owners.has(ipc)){if(owners.get(ipc)!==producers)throw Error('channel_mcp_registrar_owner_conflict');return;}
 for(const method of CHANNEL_MCP_READONLY_METHODS){
  const channel='desktop:'+method,output=CHANNEL_MCP_READONLY_OUTPUT_SCHEMAS[method];
  const capture=(raw:unknown)=>{const value=captureIpcData(raw,'channel_mcp_projection_unavailable');if(!output.safeParse(value).success)throw Error('channel_mcp_projection_unavailable');return value;};
  registerIpcHandler<unknown[],unknown>({registrar:ipc,channel,input:z.custom<unknown[]>(()=>true).transform(raw=>{const value=captureIpcData(raw,'channel_mcp_input_invalid');if(!CHANNEL_MCP_READONLY_INPUT_SCHEMA.safeParse(value).success)throw Error('channel_mcp_input_invalid');return value;}),output,payloadMode:'tuple',rolloutRound:32,riskTags:['fs-read'],sourceFile:'desktop/electron/channel-mcp-readonly-typed-ipc.ts',handler:async(args,event)=>{
   const producer=producers?.get(channel);if(!producer)throw Error('channel_mcp_runtime_unavailable');const result=producer(event,...args);
   if(!isPromise(result))return capture(result);assertStandardIpcPromise(result,'channel_mcp_projection_unavailable');
   return new NativePromise((resolve,reject)=>apply(nativeThen,result,[(value:unknown)=>{try{resolve(capture(value));}catch(error){reject(error);}},reject]));
  }});
 }
 owners.set(ipc,producers);
}
