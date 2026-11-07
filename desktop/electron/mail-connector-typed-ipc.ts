import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import type { MailConnectorService } from './mail-connector-service.js';
import { MAIL_ACCESS_SCHEMA,MAIL_ACCOUNT_SCHEMA,MAIL_CONNECT_SCHEMA,MAIL_ACCOUNT_REQUEST_SCHEMA,MAIL_OAUTH_INPUT_SCHEMA,MAIL_OAUTH_STATE_SCHEMA,MAIL_SEARCH_SCHEMA,MAIL_SEARCH_RESULT_SCHEMA,MAIL_READ_SCHEMA,MAIL_READ_RESULT_SCHEMA } from '../shared/mail-connectors-ipc-contract.js';
export function registerMailConnectorIpc(ipc:IpcHandleRegistrar,service:MailConnectorService,authorize:(event:Electron.IpcMainInvokeEvent)=>boolean):void{
 const beforeInput=(event:Electron.IpcMainInvokeEvent):undefined=>{if(!authorize(event))throw Error('mail_sender_forbidden');return undefined;};
 const base={registrar:ipc,rolloutRound:37 as const,sourceFile:'desktop/electron/mail-connector-typed-ipc.ts',beforeInput,beforeOutput:beforeInput,payloadMode:'tuple' as const};
 registerIpcHandler({...base,channel:'desktop:mail:list',input:z.tuple([]),output:MAIL_ACCOUNT_SCHEMA.array(),riskTags:['fs-read'],handler:async()=>service.list()});
 registerIpcHandler({...base,channel:'desktop:mail:connect',input:z.tuple([MAIL_CONNECT_SCHEMA]),output:MAIL_ACCOUNT_SCHEMA,riskTags:['network','fs-write-userData'],handler:async([input])=>service.connect(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:disconnect',input:z.tuple([MAIL_ACCOUNT_REQUEST_SCHEMA]),output:z.object({ok:z.literal(true)}).strict(),riskTags:['fs-write-userData'],handler:async([input])=>service.disconnect(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:access',input:z.tuple([MAIL_ACCESS_SCHEMA]),output:MAIL_ACCOUNT_SCHEMA,riskTags:['fs-write-userData'],handler:async([input])=>service.setAccess(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:test',input:z.tuple([MAIL_ACCOUNT_REQUEST_SCHEMA]),output:MAIL_ACCOUNT_SCHEMA,riskTags:['network'],handler:async([input])=>service.test(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:search',input:z.tuple([MAIL_SEARCH_SCHEMA]),output:MAIL_SEARCH_RESULT_SCHEMA,riskTags:['network'],handler:async([input])=>service.search(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:read',input:z.tuple([MAIL_READ_SCHEMA]),output:MAIL_READ_RESULT_SCHEMA,riskTags:['network'],handler:async([input])=>service.read(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:oauthState',input:z.tuple([]),output:MAIL_OAUTH_STATE_SCHEMA,riskTags:['fs-read'],handler:async()=>service.getOAuthState()});
 registerIpcHandler({...base,channel:'desktop:mail:oauthStart',input:z.tuple([MAIL_OAUTH_INPUT_SCHEMA]),output:MAIL_OAUTH_STATE_SCHEMA,riskTags:['network','shell-open','fs-write-userData'],handler:async([input])=>service.beginOAuth(input,'user')});
 registerIpcHandler({...base,channel:'desktop:mail:oauthCancel',input:z.tuple([z.string().uuid().optional()]),output:MAIL_OAUTH_STATE_SCHEMA,riskTags:['internal-mutation'],handler:async([id])=>service.cancelOAuth(id,'user')});
}
