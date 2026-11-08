import type {MemoryCredentialSettingsStore} from './memory-credential-settings.js';
import {z} from 'zod';
import {CREDENTIAL_REQUEST_SCHEMA,CREDENTIAL_SUBMIT_SCHEMA,CREDENTIAL_CANCEL_SCHEMA,CREDENTIAL_RESULT_SCHEMA} from '../shared/credential-input-contract.js';
import type {CredentialInputService} from './credential-input-service.js';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
import {registerIpcHandler} from './ipc-runtime.js';
export function registerCredentialInputIpc(ipc:IpcHandleRegistrar,service:CredentialInputService,authorize:(event:unknown)=>boolean,memory?:MemoryCredentialSettingsStore){
 const registrar:IpcHandleRegistrar={handle(channel,listener){ipc.handle(channel,(event,...args)=>{if(!authorize(event))throw Error('credential_user_only');return listener(event,...args);});}};
 const base={registrar,payloadMode:'tuple' as const,sourceFile:'desktop/electron/credential-input-ipc.ts',rolloutRound:21 as const};
 registerIpcHandler({...base,channel:'desktop:credentialInput:list',input:z.tuple([]),output:z.array(CREDENTIAL_REQUEST_SCHEMA).max(50),riskTags:['fs-read'],handler:async()=>service.list('user')});
 registerIpcHandler({...base,channel:'desktop:credentialInput:submit',input:z.tuple([CREDENTIAL_SUBMIT_SCHEMA]),output:CREDENTIAL_RESULT_SCHEMA,riskTags:['fs-write-userData'],handler:async([input])=>service.submit(input,'user')});
 registerIpcHandler({...base,channel:'desktop:credentialInput:cancel',input:z.tuple([CREDENTIAL_CANCEL_SCHEMA]),output:CREDENTIAL_RESULT_SCHEMA,riskTags:['internal-mutation'],handler:async([input])=>service.cancel(input,'user')});
 registerIpcHandler({...base,channel:'desktop:credentialInput:memoryGet',input:z.union([z.tuple([]),z.tuple([z.record(z.unknown()).optional()])]),output:z.record(z.unknown()),riskTags:['fs-read','fs-write-userData'],handler:async(input)=>{if(!memory)throw Error('credential_not_ready');return memory.get(input[0],'user');}});
 registerIpcHandler({...base,channel:'desktop:credentialInput:memorySave',input:z.tuple([z.record(z.unknown())]),output:z.record(z.unknown()),riskTags:['fs-write-userData'],handler:async([input])=>{if(!memory)throw Error('credential_not_ready');return memory.save(input,'user');}});

}
