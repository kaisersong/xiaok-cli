import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {createHash} from 'node:crypto';
import {settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import type {LoopStore} from './loop-store.js';
import type {AssistantYzjClient} from './assistant-yzj-cli.js';
import {ASSISTANT_CALENDAR_OBSERVATION_EVENT_SCHEMA,type AssistantCalendarSnapshot,type AssistantCalendarStatus} from '../shared/assistant-calendar-observation-contract.js';
type Source='user'|'scheduler'|'agent';
/** One Main owner; no path/identity/permission values are accepted from IPC. */
export class AssistantCalendarSource {
 private running?:Promise<AssistantCalendarSnapshot>;
 private collectionAbort?:AbortController;
 private stopped=false;
 private closing?:Promise<void>;
 private readonly pending=new Set<Promise<unknown>>();
 private readonly identity:(signal?:AbortSignal)=>Promise<string>;
 private readonly observe:AssistantYzjClient['observeCalendar'];
 constructor(private readonly options:{store:LoopStore;cloud:Pick<AssistantYzjClient,'identity'|'observeCalendar'>}){
  const cloud=options.cloud,identity=cloud.identity,observe=cloud.observeCalendar;
  this.identity=signal=>Reflect.apply(identity,cloud,[signal]);
  this.observe=(raw,expected,signal)=>Reflect.apply(observe,cloud,[raw,expected,signal]);
 }
 private open(){if(this.stopped)throw Error('assistant_calendar_closed');}
 private track<T>(promise:Promise<T>):Promise<T>{this.pending.add(promise);void promise.then(()=>{this.pending.delete(promise);},()=>{this.pending.delete(promise);});return promise;}
 status():AssistantCalendarStatus{const grant=this.options.store.getAssistantCalendarConnection();return {enabled:grant.enabled,epoch:grant.epoch,lastCompleteWatermark:null,snapshot:this.latest()};}
 enable(input:{requestSource:Source}):Promise<AssistantCalendarStatus>{
  if(input?.requestSource!=='user')return Promise.reject(Error('assistant_calendar_user_only'));
  try{this.open();}catch(raw){return Promise.reject(raw);}
  return this.track(this.enableOwned());
 }
 private async enableOwned():Promise<AssistantCalendarStatus>{
  const before=this.options.store.getAssistantCalendarConnection(),accountId=await this.identity();this.open();
  this.options.store.setAssistantCalendarConnection({enabled:true,accountId,expectedEpoch:before.epoch,requestSource:'user'});this.collectionAbort?.abort();return this.status();
 }
 disable(input:{requestSource:Source}):AssistantCalendarStatus{
  if(input?.requestSource!=='user')throw Error('assistant_calendar_user_only');this.open();
  const grant=this.options.store.getAssistantCalendarConnection();this.options.store.setAssistantCalendarConnection({enabled:false,expectedEpoch:grant.epoch,requestSource:'user'});this.collectionAbort?.abort();return this.status();
 }
 latest():AssistantCalendarSnapshot{
  const grant=this.options.store.getAssistantCalendarConnection();
  if(!grant.enabled)return this.empty('disabled',grant.epoch);
  if(grant.binary!=='bundled-yzj')return this.empty('unavailable',grant.epoch);
  return this.options.store.getAssistantCalendarGeneration(grant.epoch)??this.empty('unavailable',grant.epoch);
 }
 collect(input:{now:number;requestSource:Source;signal?:AbortSignal}):Promise<AssistantCalendarSnapshot>{
  if(!input||!['user','scheduler'].includes(input.requestSource))return Promise.reject(Error('assistant_calendar_read_denied'));
  if(!Number.isSafeInteger(input.now)||input.now<1_000_000_000_000+86400000||!Number.isFinite(new Date(input.now+7*86400000).getTime()))return Promise.reject(Error('assistant_calendar_time_invalid'));
  try{this.open();}catch(raw){return Promise.reject(raw);}
  if(this.running)return this.running;
  const cancellation=new AbortController();this.collectionAbort=cancellation;
  const signal=input.signal?AbortSignal.any([input.signal,cancellation.signal]):cancellation.signal;
  const run=this.track(this.collectOwned({...input,signal}));this.running=run;
  void run.then(()=>{if(this.running===run)this.running=undefined;},()=>{if(this.running===run)this.running=undefined;});return run;
 }
 private async collectOwned(input:{now:number;requestSource:Source;signal?:AbortSignal}):Promise<AssistantCalendarSnapshot>{
  const grant=this.options.store.getAssistantCalendarConnection();if(!grant.enabled)return this.empty('disabled',grant.epoch);
  if(grant.binary!=='bundled-yzj')return this.empty('unavailable',grant.epoch);
  const window={from:input.now-86400000,to:input.now+7*86400000};
  const current=()=>{const next=this.options.store.getAssistantCalendarConnection();return !this.stopped&&!input.signal?.aborted&&next.enabled&&next.binary==='bundled-yzj'&&next.epoch===grant.epoch&&next.accountId===grant.accountId;};
  let snapshot:AssistantCalendarSnapshot;
  try{
   const page=await this.observe(window,grant.accountId,input.signal);if(!current())return this.latest();
   const events=new Map<string,AssistantCalendarSnapshot['events'][number]>();
   for(const record of page.records){
    if(typeof record.id!=='string'||!record.id||record.id.length>512||typeof record.title!=='string'||!record.title.trim()||record.title.length>160
     ||!Number.isSafeInteger(record.startDate)||!Number.isSafeInteger(record.endDate)||(record.endDate as number)<(record.startDate as number))continue;
    const start=record.startDate as number,end=record.endDate as number;if(start>=window.to||end<window.from)continue;
    let timeZone:string|null=null;
    if(typeof record.timeZone==='string'&&record.timeZone.length<=100){try{new Intl.DateTimeFormat('en',{timeZone:record.timeZone});timeZone=record.timeZone;}catch{}}
    const id=createHash('sha256').update(canonicalVerificationJson(['yunzhijia',grant.accountId,record.id])).digest('hex');
    const observationRevision=createHash('sha256').update(canonicalVerificationJson([record.title,start,end,timeZone])).digest('hex');
    const event=ASSISTANT_CALENDAR_OBSERVATION_EVENT_SCHEMA.parse({id,title:record.title,start,end,timeZone,allDay:'unknown',cancelled:'unknown',observationRevision});
    const duplicate=events.get(id);if(duplicate&&duplicate.observationRevision!==observationRevision)throw Error('assistant_calendar_conflicting_records');
    events.set(id,event);
   }
   const previous=this.options.store.getAssistantCalendarGeneration(grant.epoch);
   const prior=new Map((previous?.observation?.records??previous?.events??[]).filter(e=>e.observationRevision).map(e=>[e.id,e]));
   const observation={identity:'provider_record' as const,window:{...window},observedAt:input.now,records:[...events.values()].map(e=>({id:e.id,observationRevision:e.observationRevision!})),enumeration:page.completeness,added:[...events.keys()].filter(id=>!prior.has(id)),changed:[...events.values()].filter(e=>prior.has(e.id)&&prior.get(e.id)!.observationRevision!==e.observationRevision).map(e=>e.id),missingUnconfirmed:[...prior.keys()].filter(id=>!events.has(id))};
   // 0.1.8 does not prove occurrence/cancellation/all-day semantics, even
   // when transport explicitly reports complete. Never promote its watermark.
   snapshot={status:'partial',observation,epoch:grant.epoch,collectedAt:input.now,...window,errorCode:page.completeness==='complete'?'event_semantics_unknown':'completeness_unknown',recordCount:page.records.length,events:[...events.values()]};

  }catch{
   if(!current())return this.latest();
   const baseline=this.options.store.getAssistantCalendarGeneration(grant.epoch)?.observation;
   snapshot={...this.empty('unavailable',grant.epoch),...(baseline?{observation:{...baseline,added:[],changed:[],missingUnconfirmed:[]}}:{}),collectedAt:input.now,...window,errorCode:'source_unavailable'};
  }
  // A persistence failure must escape with its original raw value. Never try a
  // second availability write that could hide the original SDK/transaction error.
  this.options.store.writeAssistantCalendarGeneration(snapshot,input.requestSource,current);return snapshot;
 }
 close():Promise<void>{
  if(this.closing)return this.closing;this.stopped=true;
  this.closing=(async()=>{const errors:unknown[]=[];try{this.collectionAbort?.abort();}catch(raw){errors.push(raw);}
   const results=await settleIntrinsicOperations([...this.pending],value=>value);
   for(const result of results)if(result.status==='rejected')errors.push(result.reason);
   if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'assistant_calendar_close',{cause:errors[0]});})();return this.closing;
 }
 private empty(status:AssistantCalendarSnapshot['status'],epoch:number):AssistantCalendarSnapshot{return {status,epoch,collectedAt:null,from:null,to:null,errorCode:status==='unavailable'?'source_unavailable':null,events:[]};}
}
