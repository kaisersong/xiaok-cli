import {createHash} from 'node:crypto';
import type {LoopStore} from './loop-store.js';
import type {AssistantCalendarConnection} from './assistant-calendar-store.js';
import {ASSISTANT_CALENDAR_EVENT_SCHEMA,type AssistantCalendarSnapshot,type AssistantCalendarStatus} from '../shared/assistant-calendar-contract.js';
type Source='user'|'scheduler'|'agent';
export class AssistantCalendarSource {
 private running?:Promise<AssistantCalendarSnapshot>;
 private collectionAbort?:AbortController;
 constructor(private readonly options:{store:LoopStore;now?:()=>number;connect:()=>Promise<{binary:string;accountId:string}>;read:(grant:AssistantCalendarConnection,window:{from:number;to:number},signal?:AbortSignal)=>Promise<{records:Record<string,unknown>[];accountId:string;grantEpoch:number;completeness:'complete'|'partial'|'unknown'}>}){}
 status():AssistantCalendarStatus{const grant=this.options.store.getAssistantCalendarConnection();return {enabled:grant.enabled,epoch:grant.epoch,lastCompleteWatermark:null,snapshot:this.latest()};}
 async enable(input:{requestSource:Source}):Promise<AssistantCalendarStatus>{
  if(input?.requestSource!=='user')throw Error('assistant_calendar_user_only');
  const before=this.options.store.getAssistantCalendarConnection();const connection=await this.options.connect();
  if(!connection.binary||!connection.accountId)throw Error('assistant_calendar_connection_invalid');
  this.options.store.setAssistantCalendarConnection({...connection,enabled:true,expectedEpoch:before.epoch});this.collectionAbort?.abort();return this.status();
 }
 disable(input:{requestSource:Source}):AssistantCalendarStatus{
  if(input?.requestSource!=='user')throw Error('assistant_calendar_user_only');
  const grant=this.options.store.getAssistantCalendarConnection();this.options.store.setAssistantCalendarConnection({...grant,enabled:false,expectedEpoch:grant.epoch});this.collectionAbort?.abort();return this.status();
 }
 /** Main-private ephemeral capability; never persist its copied bodies without
  * the durable consumer's source-visibility overlay. */
 context(){
  const grant=this.options.store.getAssistantCalendarConnection(),snapshot=this.latest();
  const revision=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const isCurrent=()=>{const next=this.options.store.getAssistantCalendarConnection();return grant.enabled&&next.enabled&&next.epoch===grant.epoch&&next.accountId===grant.accountId&&createHash('sha256').update(JSON.stringify(this.latest())).digest('hex')===revision;};
  return Object.freeze({lineage:Object.freeze({source:'calendar' as const,epoch:grant.epoch,revision}),isCurrent,read:()=>isCurrent()?structuredClone(snapshot):undefined});
 }
 latest():AssistantCalendarSnapshot{
  const grant=this.options.store.getAssistantCalendarConnection();
  if(!grant.enabled)return this.empty('disabled',grant.epoch);
  return this.options.store.getAssistantCalendarGeneration(grant.epoch)??this.empty('unavailable',grant.epoch);
 }
 collect(input:{now:number;requestSource:Source;signal?:AbortSignal}):Promise<AssistantCalendarSnapshot>{
  if(!input||!['user','scheduler'].includes(input.requestSource))return Promise.reject(Error('assistant_calendar_read_denied'));
  if(!Number.isSafeInteger(input.now))return Promise.reject(Error('assistant_calendar_time_invalid'));
  if(this.running)return this.running;
  const cancellation=new AbortController();this.collectionAbort=cancellation;
  const signal=input.signal?AbortSignal.any([input.signal,cancellation.signal]):cancellation.signal;
  const run=this.collectOwned({...input,signal});this.running=run;void run.finally(()=>{if(this.running===run)this.running=undefined;}).catch(()=>{});return run;
 }
 private async collectOwned(input:{now:number;signal?:AbortSignal}):Promise<AssistantCalendarSnapshot>{
  const grant=this.options.store.getAssistantCalendarConnection();if(!grant.enabled)return this.empty('disabled',grant.epoch);
  const window={from:input.now-86400_000,to:input.now+7*86400_000};
  const current=()=>{const next=this.options.store.getAssistantCalendarConnection();return next.enabled&&next.epoch===grant.epoch&&next.accountId===grant.accountId&&!input.signal?.aborted;};
  try{
   const page=await this.options.read(grant,window,input.signal);
   if(!current())return this.latest();
   if(page.accountId!==grant.accountId||page.grantEpoch!==grant.epoch)throw Error('assistant_calendar_grant_changed');
   if(page.records.length>200||Buffer.byteLength(JSON.stringify(page.records))>1024*1024)throw Error('assistant_calendar_limit');
   const events=new Map<string,AssistantCalendarSnapshot['events'][number]>();
   for(const record of page.records){
    if(typeof record.id!=='string'||!record.id||record.id.length>512||typeof record.title!=='string'||!record.title.trim()||record.title.length>160
     ||!Number.isSafeInteger(record.startDate)||!Number.isSafeInteger(record.endDate)||(record.endDate as number)<(record.startDate as number))continue;
    const start=record.startDate as number,end=record.endDate as number;if(start>=window.to||end<window.from)continue;
    let timeZone:string|null=null;
    if(typeof record.timeZone==='string'&&record.timeZone.length<=100){try{new Intl.DateTimeFormat('en',{timeZone:record.timeZone});timeZone=record.timeZone;}catch{}}
    const id=createHash('sha256').update(JSON.stringify(['yunzhijia',grant.accountId,record.id])).digest('hex');
    const observationRevision=createHash('sha256').update(JSON.stringify([record.title,start,end,timeZone])).digest('hex');
    const event=ASSISTANT_CALENDAR_EVENT_SCHEMA.parse({id,title:record.title,start,end,timeZone,allDay:'unknown',cancelled:'unknown',observationRevision});
    const duplicate=events.get(id);if(duplicate&&duplicate.observationRevision!==observationRevision)throw Error('assistant_calendar_conflicting_records');
    events.set(id,event);
   }
   const previous=this.options.store.getAssistantCalendarGeneration(grant.epoch);
   const prior=new Map((previous?.observation?.records??previous?.events??[]).filter(e=>e.observationRevision).map(e=>[e.id,e]));
   const observation={identity:'provider_record' as const,window:{...window},observedAt:input.now,records:[...events.values()].map(e=>({id:e.id,observationRevision:e.observationRevision!})),enumeration:page.completeness,added:[...events.keys()].filter(id=>!prior.has(id)),changed:[...events.values()].filter(e=>prior.has(e.id)&&prior.get(e.id)!.observationRevision!==e.observationRevision).map(e=>e.id),missingUnconfirmed:[...prior.keys()].filter(id=>!events.has(id))};
   // 0.1.8 does not prove occurrence/cancellation/all-day semantics, even
   // when transport explicitly reports complete. Never promote its watermark.
   const snapshot:AssistantCalendarSnapshot={status:'partial',observation,epoch:grant.epoch,collectedAt:input.now,...window,errorCode:page.completeness==='complete'?'event_semantics_unknown':'completeness_unknown',recordCount:page.records.length,events:[...events.values()]};
   this.options.store.writeAssistantCalendarGeneration(snapshot,current);return snapshot;
  }catch{
   if(!current())return this.latest();
   const baseline=this.options.store.getAssistantCalendarGeneration(grant.epoch)?.observation;
   const failure={...this.empty('unavailable',grant.epoch),...(baseline?{observation:{...baseline,added:[],changed:[],missingUnconfirmed:[]}}:{}),collectedAt:input.now,...window,errorCode:'source_unavailable' as const};
   this.options.store.writeAssistantCalendarGeneration(failure,current);return failure;
  }
 }
 private empty(status:AssistantCalendarSnapshot['status'],epoch:number):AssistantCalendarSnapshot{return {status,epoch,collectedAt:null,from:null,to:null,errorCode:status==='unavailable'?'source_unavailable':null,events:[]};}
}
