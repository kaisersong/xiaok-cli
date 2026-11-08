import { z } from 'zod';
import { ASSISTANT_STATE_SCHEMA,ATTENTION_ACTION_SCHEMA,ATTENTION_START_SCHEMA,ATTENTION_ITEM_SCHEMA,OUTBOX_APPROVE_SCHEMA,OUTBOX_DECISION_SCHEMA,OUTBOX_DRAFT_SCHEMA } from '../shared/assistant-inbox-contract.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import type { AssistantInboxService } from './assistant-inbox-service.js';
import type { AssistantOutboxService } from './assistant-outbox-service.js';
export function registerAssistantInboxIpc(ipc:IpcHandleRegistrar,service:AssistantInboxService,outbox:AssistantOutboxService,authorize:(event:unknown)=>boolean){
 const registrar:IpcHandleRegistrar={handle(channel,listener){ipc.handle(channel,(event,...args)=>{if(!authorize(event))throw Error('assistant_user_only');return listener(event,...args);});}};
 const base={registrar,payloadMode:'tuple' as const,sourceFile:'desktop/electron/assistant-inbox-ipc.ts',rolloutRound:20 as const};
 registerIpcHandler({...base,channel:'desktop:assistantInbox:state',input:z.tuple([]),output:ASSISTANT_STATE_SCHEMA,riskTags:['fs-read'],handler:async()=>service.state()});
 registerIpcHandler({...base,channel:'desktop:assistantInbox:today',input:z.tuple([]),output:ASSISTANT_STATE_SCHEMA,riskTags:['network','fs-write-userData'],handler:async()=>service.ensureToday('user')});
 registerIpcHandler({...base,channel:'desktop:assistantInbox:refresh',input:z.tuple([]),output:ASSISTANT_STATE_SCHEMA,riskTags:['network','fs-write-userData'],handler:async()=>{await service.refresh('user');return service.state();}});
 registerIpcHandler({...base,channel:'desktop:assistantInbox:act',input:z.tuple([ATTENTION_ACTION_SCHEMA]),output:ATTENTION_ITEM_SCHEMA,riskTags:['fs-write-userData'],handler:async([input])=>service.act(input,'user')});
 registerIpcHandler({...base,channel:'desktop:assistantInbox:start',input:z.tuple([ATTENTION_START_SCHEMA]),output:ATTENTION_ITEM_SCHEMA,riskTags:['internal-mutation','fs-write-userData'],handler:async([input])=>service.start(input,'user')});
 registerIpcHandler({...base,channel:'desktop:assistantInbox:approve',input:z.tuple([OUTBOX_APPROVE_SCHEMA]),output:OUTBOX_DRAFT_SCHEMA,riskTags:['network','fs-write-userData'],handler:async([input])=>outbox.approve(input,'user')});
 registerIpcHandler({...base,channel:'desktop:assistantInbox:refuse',input:z.tuple([OUTBOX_DECISION_SCHEMA]),output:OUTBOX_DRAFT_SCHEMA,riskTags:['fs-write-userData'],handler:async([input])=>outbox.refuse(input,'user')});
}
