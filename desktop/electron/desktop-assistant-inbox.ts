import {createAssistantReadSourcesTool} from './assistant-read-sources-tool.js';
import {readAssistantAutomationContext} from './assistant-automation-context.js';
import {AssistantCalendarSource} from './assistant-calendar-source.js';
import type {LoopStore} from './loop-store.js';
import {createAssistantMessageTools} from './assistant-message-tools.js';
import {defaultKimDecisionRuntime} from '../../src/ai/kim/runtime.js';
import { join } from 'node:path';
import type {KimDecisionRuntime,KimLease} from '../../src/ai/kim/runtime.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Tool } from '../../src/types.js';
import type { MailSafeStorage } from './mail-account-store.js';
import type { MailConnectorService } from './mail-connector-service.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import { AssistantInboxStore,type AttentionTaskFact } from './assistant-inbox-store.js';
import {triageAssistantRecords} from './assistant-triage.js';
import { AssistantInboxService } from './assistant-inbox-service.js';
import { AssistantOutboxService } from './assistant-outbox-service.js';
import { AssistantYzjClient } from './assistant-yzj-cli.js';
import {createAssistantCalendarTools} from './assistant-calendar-tools.js';
import { readAssistantSources,validateCurrentMailSources } from './assistant-source-reader.js';
import { MAIL_SEND_SCHEMA } from '../shared/mail-connectors-ipc-contract.js';
interface Dependencies {automations?:()=>ReturnType<typeof readAssistantAutomationContext>;calendarStore?:LoopStore;kim?:KimDecisionRuntime;credentialWaitingTasks?:()=>string[];dataRoot:string;crypto:MailSafeStorage;mail:MailConnectorService;llm:LoopLLMPort;profile():{active:boolean;timeZone:string;locale?:'zh'|'en'};search(query:string,signal:AbortSignal):Promise<string>;launch(input:{prompt:string;threadId:string}):Promise<{taskId:string}>;canLaunch():void;changed():void;internal():Promise<Array<{id:string;title:string;summary:string;observedAt?:number}>>;facts():AttentionTaskFact[];reminders:{create(item:import('../shared/assistant-inbox-contract.js').AttentionItem,at:number):string;cancel(id:string):void}}
export function createDesktopAssistantInbox(d:Dependencies){
 let lease:KimLease|undefined;let scanAccounts:string[]=[];
 const store=new AssistantInboxStore(join(d.dataRoot,'assistant-inbox.sqlite'));const cloud=new AssistantYzjClient();
 const calendarSource=d.calendarStore?new AssistantCalendarSource({store:d.calendarStore,cloud}):undefined;
 const outbox=new AssistantOutboxService({store,crypto:d.crypto,mail:{list:()=>d.mail.list(),send:(input,source)=>d.mail.send(input,source),receipt:id=>d.mail.getSendReceipt(id,'user')},yzj:{identity:()=>cloud.identity(),send:(groupId,text,identity)=>cloud.send(groupId,text,identity)},calendar:{identity:()=>cloud.identity(),create:(event,identity)=>cloud.createCalendar(event,identity,'user')},changed:d.changed});
 const service=new AssistantInboxService({store,outbox,credentialWaitingTasks:d.credentialWaitingTasks,reminders:d.reminders,
 beforeCommit:batch=>validateCurrentMailSources(batch,d.mail.list(),Date.now()),
 validate:async(batch,signal)=>{const identities=new Set(scanAccounts);if(!identities.size)return batch;let identity='';try{identity=await cloud.identity(signal);}catch{}const changed=new Set([...identities].filter(id=>id!==identity));return {records:batch.records.filter(r=>!changed.has(r.accountKey)),coverage:batch.coverage.map(c=>[...changed].some(id=>c.key.endsWith(':'+id))?{...c,state:'unavailable',code:'account_changed'}:c)};},
 finalize:async batch=>{if(!d.kim||!lease||await d.kim.current(lease))return batch;lease=await d.kim.begin();return {records:batch.records.filter(r=>r.source!=='yzj_message'),coverage:batch.coverage.map(c=>c.source==='yzj_message'&&c.code!=='account_changed'?{...c,state:'failed' as const,code:'triage_failed' as const}:c)};},
 commitCurrent:()=>!d.kim||!lease||d.kim.currentSync(lease),
 profile:d.profile,launch:d.launch,canLaunch:d.canLaunch,changed:d.changed,
 read:async signal=>{lease=undefined;scanAccounts=[];if(d.kim)lease=await d.kim.begin();const now=Date.now();const batch=await readAssistantSources({mail:d.mail,cloud,search:d.search,now,timeZone:d.profile().timeZone,signal});scanAccounts=batch.coverage.filter(c=>c.source==='yzj_message'||c.source==='yzj_calendar').map(c=>c.key.slice(c.source.length+1)).filter(id=>id&&id!=='none');try{const suggestions=await d.internal();batch.records.push(...suggestions.slice(0,3).map(s=>({source:'internal' as const,accountKey:'assistant',sourceId:s.id,title:s.title.slice(0,200),summary:s.summary.slice(0,1000),reason:'',nextStep:'',priority:'later' as const,observedAt:s.observedAt??0})));batch.coverage.push({key:'internal:assistant',source:'internal',state:'ok',checkedAt:now});}catch{batch.coverage.push({key:'internal:assistant',source:'internal',state:'failed',code:'read_failed',checkedAt:now});}return batch;},
 triage:(records,signal)=>d.kim&&lease?triageAssistantRecords(d.llm,records,signal,{runtime:d.kim,lease}):triageAssistantRecords(d.llm,records,signal),
 });
 outbox.reconcile('scheduler');service.recover(d.facts(),'scheduler');
 const tools:Tool[]=[createAssistantReadSourcesTool({refresh:()=>service.refresh('agent'),state:()=>service.state(),automations:d.automations}),
 {permission:'write',executionPolicy:{waitsForUser:true},definition:{name:'assistant_prepare_reply',description:'为真实关注事项准备邮件或云之家回复草稿。严禁发送或批准草稿，必须由用户在小K助理确认完整收件人与正文。只能使用assistant_read_sources返回的itemId。',inputSchema:{type:'object',properties:{itemId:{type:'string'},text:{type:'string',minLength:1,maxLength:30000}},required:['itemId','text'],additionalProperties:false}},execute:async(input,context)=>{const captured=z.object({itemId:z.string().min(1).max(256),text:z.string().min(1).max(30000)}).strict().parse(input);const item=store.snapshot(Date.now()).items.find(item=>item.id===captured.itemId);if(!item)throw Error('assistant_item_missing');if(item.source==='mail'){const from=item.locator?.from??'',to=from.match(/<([^<>]+)>/)?.[1]??from.trim();const draft=outbox.proposeMail(MAIL_SEND_SCHEMA.parse({accountId:item.accountKey,requestId:randomUUID(),to:[to],subject:`Re: ${item.title.replace(/^re:\s*/i,'')}`.slice(0,200),text:captured.text}),'agent',context?.taskId);return JSON.stringify(await outbox.waitForDecision(draft.id,context?.signal));}if(item.source==='yzj_message'&&item.locator?.groupId&&item.locator.identity){const draft=outbox.proposeYzj({groupId:item.locator.groupId,identity:item.locator.identity,recipient:item.locator.groupName??item.title,text:captured.text},'agent',context?.taskId);return JSON.stringify(await outbox.waitForDecision(draft.id,context?.signal));}throw Error('assistant_reply_unavailable');}}];
 tools.push(...createAssistantCalendarTools({cloud,outbox}),...createAssistantMessageTools({cloud,kim:d.kim??defaultKimDecisionRuntime,timeZone:()=>d.profile().timeZone}));
 return {store,service,outbox,tools,calendarSource,dispose:()=>service.dispose(),drain:()=>service.drain(),close:()=>store.close()};
}
