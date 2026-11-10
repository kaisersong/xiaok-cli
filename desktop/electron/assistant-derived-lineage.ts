import {assertOrdinaryLoopOwner} from './loop-run-context.js';
import {assistantDerivedHash,captureAssistantDerivedValue} from './assistant-derived-data.js';
export {assistantDerivedHash} from './assistant-derived-data.js';
import type {MemoryRecord,MemoryStore} from '../../src/ai/memory/store.js';
import {readAssistantCalendarMemory} from './assistant-calendar-context.js';

import {ASSISTANT_DERIVED_LINEAGE_SCHEMA,type AssistantDerivedLineage} from '../../src/runtime/assistant/derived-lineage-contract.js';
export {ASSISTANT_DERIVED_LINEAGE_SCHEMA,type AssistantDerivedLineage} from '../../src/runtime/assistant/derived-lineage-contract.js';
export type DerivedProfile=object&{id:string;status:string};
export interface AssistantMemoryConfirmation {candidateId:string;confirmationRevision:string;contentHash:string;isCurrent():boolean}
export interface DerivedMemorySettings {ownerId:string;profileId:string;enabled:boolean;revision:number}
export function assistantMemoryContentHash(record:MemoryRecord):string{return assistantDerivedHash(record);}
/** All ancestors remain visibility dependencies; only verified internal parents
 * are exempt from external routing restrictions. Legacy refs stay conservative. */
export function hasAssistantExternalLineage(lineage:AssistantDerivedLineage):boolean{return !!(lineage.calendar||lineage.memory||lineage.parents.some(parent=>parent.external!==false));}
export interface AssistantDerivedVisibility {
 readLineage(runId:string):AssistantDerivedLineage|undefined;
 isRunVisible(runId:string):boolean;
 isCandidateVisible(candidate:{runId:string}):boolean;
 isEvidenceVisible(evidence:{ownerKind:string;ownerId:string}):boolean;
}
/** Same synchronous gate for LoopStore, evidence and publication readers. No
 * original body is returned on a missing permission, damaged ref or cycle. */
export function createAssistantDerivedVisibility(options:{
 readLineage(runId:string):AssistantDerivedLineage|undefined;
 isTrackedAssistantRun(runId:string):boolean;
 getProfile(id:string):DerivedProfile|undefined;
 currentCalendar():{epoch:number;events:Array<{id:string;observationRevision?:string}>}|undefined;
 currentMemorySettings(ownerId:string,profileId:string):DerivedMemorySettings|undefined;
 getMemory(id:string):MemoryRecord|undefined;
 confirmMemory(record:MemoryRecord):AssistantMemoryConfirmation|undefined;
}):AssistantDerivedVisibility{
 if(typeof options.isTrackedAssistantRun!=='function')throw Error('assistant_derived_owner_marker_required');
 const active=new Set<string>();
 function isRunVisible(runId:string):boolean{
  if(active.has(runId)||active.size>=32)return false;
  active.add(runId);
  try{
   const raw=options.readLineage(runId);
   if(!raw)return !options.isTrackedAssistantRun(runId);
   const lineage=ASSISTANT_DERIVED_LINEAGE_SCHEMA.parse(raw);
   if(hasAssistantExternalLineage(lineage))assertOrdinaryLoopOwner('loop_run',runId);
   const profile=options.getProfile(lineage.profileId);
   if(!profile||profile.status!=='active'||profile.id!==lineage.profileId||assistantDerivedHash(profile)!==lineage.profileRevision)return false;
   if(lineage.calendar){const current=options.currentCalendar();if(!current||current.epoch!==lineage.calendar.epoch||lineage.calendar.events.some(ref=>!current.events.some(event=>event.id===ref.id&&event.observationRevision===ref.observationRevision)))return false;}
   if(lineage.memory){
    const settings=options.currentMemorySettings(lineage.memory.ownerId,lineage.profileId);
    if(!settings?.enabled||settings.ownerId!==lineage.memory.ownerId||settings.profileId!==lineage.profileId||settings.revision!==lineage.memory.consentRevision)return false;
    for(const ref of lineage.memory.records){const record=options.getMemory(ref.id);if(!record||assistantMemoryContentHash(record)!==ref.contentHash)return false;const confirmation=options.confirmMemory(record);if(!confirmation||!confirmation.isCurrent()||confirmation.contentHash!==ref.contentHash||confirmation.candidateId!==ref.candidateId||confirmation.confirmationRevision!==ref.confirmationRevision)return false;}
   }
   for(const parent of lineage.parents){const current=options.readLineage(parent.runId);if(!current||assistantDerivedHash(current)!==parent.lineageHash||parent.external===false&&hasAssistantExternalLineage(current)||!isRunVisible(parent.runId))return false;}
   return true;
  }catch{return false;}finally{active.delete(runId);}
 }
 return {readLineage:options.readLineage,isRunVisible,isCandidateVisible:c=>isRunVisible(c.runId),isEvidenceVisible:e=>e.ownerKind!=='loop_run'||isRunVisible(e.ownerId)};
}
export interface AssistantDerivedCapture {
 lineage:AssistantDerivedLineage;
 context:{kind:'data';calendar:{status:string;observedAt:number|null;enumeration:string;events:Array<Record<string,unknown>>};personalization:{kind:'data';status:string;memories:Array<{id:string;title:string;summary:string;updatedAt:number}>}};
 items:Array<{reference:{kind:string;id:string}}>;
 isCurrent():boolean;
}
export interface AssistantDerivedCaptureSession {finish(snapshot:unknown):Promise<AssistantDerivedCapture>}
/** Called BEFORE collect. finish runs AFTER collect, so refresh may change the
 * snapshot but may not change account/grant/owner/profile/consent mid-flight. */
export function beginAssistantDerivedCapture(options:{
 profile:DerivedProfile;getProfile():DerivedProfile|undefined;
 includeCalendar?:boolean;
 owner():{ownerId:string;profileId:string;cwd:string};
 calendar():{lineage:{epoch:number;revision:string};isCurrent():boolean;read():unknown};
 memorySettings():DerivedMemorySettings;
 memoryStore:Pick<MemoryStore,'listRelevant'|'getById'>;
 confirmMemory(record:MemoryRecord):AssistantMemoryConfirmation|undefined;
 visibility:Pick<AssistantDerivedVisibility,'readLineage'|'isRunVisible'>;
 now:number;
}):AssistantDerivedCaptureSession{
 const profileRevision=assistantDerivedHash(options.profile),owner={...options.owner()},settings={...options.memorySettings()},initialEpoch=options.calendar().lineage.epoch;
 const authorizationCurrent=()=>{try{return options.getProfile()?.status==='active'&&assistantDerivedHash(options.getProfile())===profileRevision&&assistantDerivedHash(options.owner())===assistantDerivedHash(owner)&&(options.includeCalendar===false||assistantDerivedHash(options.memorySettings())===assistantDerivedHash(settings)&&options.calendar().lineage.epoch===initialEpoch)&&owner.profileId===options.profile.id&&settings.ownerId===owner.ownerId&&settings.profileId===owner.profileId;}catch{return false;}};
 return {async finish(snapshot){
  if(!authorizationCurrent())throw Error('assistant_derived_stale');
  const calendar=options.calendar(),raw=calendar.read() as {status?:string;epoch?:number;collectedAt?:number|null;events?:Array<Record<string,any>>;observation?:{changed?:string[];enumeration?:string}}|undefined;
  const changed=new Set(raw?.observation?.changed??[]);
  const events=(options.includeCalendar!==false&&raw&&raw.status!=='disabled'&&raw.status!=='unavailable'?raw.events??[]:[]).filter(event=>changed.has(event.id)||(event.start>=options.now&&event.start<options.now+48*3600000)).slice(0,20).map(event=>({id:event.id,title:event.title,start:event.start,end:event.end,timeZone:event.timeZone,allDay:event.allDay,cancelled:event.cancelled,observationRevision:event.observationRevision,change:changed.has(event.id)?'observed_changed':'scheduled'}));
  const certificates=new Map<string,AssistantMemoryConfirmation>();
  const isCurrent=()=>{try{return authorizationCurrent()&&(!events.length||calendar.isCurrent())&&[...certificates.values()].every(c=>c.isCurrent());}catch{return false;}};
  const memory=events.length?await readAssistantCalendarMemory({enabled:settings.enabled,ownerId:owner.ownerId,profileId:owner.profileId,cwd:owner.cwd,query:events.map(e=>e.title).join(' ').slice(0,2048),store:options.memoryStore,isCurrent,canUse(record){
   const proof=options.confirmMemory(record);if(!proof||proof.contentHash!==assistantMemoryContentHash(record)||!proof.isCurrent())return false;certificates.set(record.id,proof);return true;
  }}):{kind:'data' as const,status:settings.enabled?'empty' as const:'disabled' as const,memories:[]};
  const parents:AssistantDerivedLineage['parents']=[];
  const data=captureAssistantDerivedValue(snapshot) as {derivedRunIds?:unknown};
  if(Array.isArray(data?.derivedRunIds))for(const runId of new Set(data.derivedRunIds)){
   if(typeof runId!=='string'||!options.visibility.isRunVisible(runId))throw Error('assistant_derived_stale');
   const parent=options.visibility.readLineage(runId);if(parent)parents.push({runId,lineageHash:assistantDerivedHash(parent),external:hasAssistantExternalLineage(parent)});
  }
  const lineage=ASSISTANT_DERIVED_LINEAGE_SCHEMA.parse({version:1,profileId:owner.profileId,profileRevision,parents,
   ...(events.length?{calendar:{epoch:initialEpoch,observationRevision:calendar.lineage.revision,events:events.map(e=>({id:e.id,observationRevision:e.observationRevision}))}}:{}),
   ...(settings.enabled&&events.length?{memory:{ownerId:owner.ownerId,consentRevision:settings.revision,records:memory.memories.map(record=>{const proof=certificates.get(record.id)!;return {id:record.id,contentHash:proof.contentHash,candidateId:proof.candidateId,confirmationRevision:proof.confirmationRevision};})}}:{}),
  });
  const current=()=>isCurrent()&&parents.every(ref=>{try{const parent=options.visibility.readLineage(ref.runId);return !!parent&&assistantDerivedHash(parent)===ref.lineageHash&&options.visibility.isRunVisible(ref.runId);}catch{return false;}})&&memory.memories.every(record=>{const now=options.memoryStore.getById?.(record.id),proof=certificates.get(record.id);return !!now&&!!proof&&assistantMemoryContentHash(now)===proof.contentHash;});
  if(!current())throw Error('assistant_derived_stale');
  return {lineage,context:{kind:'data',calendar:{status:options.includeCalendar===false?'not_used':raw?.status??'unavailable',observedAt:options.includeCalendar===false?null:raw?.collectedAt??null,enumeration:options.includeCalendar===false?'not_used':raw?.observation?.enumeration??'unknown',events},personalization:memory},items:[...events.map(e=>({reference:{kind:'calendar_observation',id:e.id}})),...memory.memories.map(m=>({reference:{kind:'memory_context',id:m.id}}))],isCurrent:current};
 }};
}
/** External source text from the legacy collector is never an implicit grant. */
export function attachAssistantDerivedContext(snapshot:unknown,capture?:AssistantDerivedCapture):unknown{
 const captured=captureAssistantDerivedValue(snapshot);
 const outer=captured&&typeof captured==='object'&&!Array.isArray(captured)?captured as Record<string,any>:{};
 const wrapped=outer.current&&typeof outer.current==='object'&&!Array.isArray(outer.current),base={...(wrapped?outer.current:outer)};
 const keys=['calendar','personalization','memories','p2Context'];
 if(!capture&&(keys.some(key=>Object.hasOwn(base,key)||Object.hasOwn(outer,key))||Array.isArray(outer.derivedRunIds)&&outer.derivedRunIds.length>0))throw Error('assistant_derived_capture_required');
 if(!capture)return snapshot;
 for(const key of keys)delete base[key];
 base.items=[...(Array.isArray(base.items)?base.items:[]),...capture.items];
 const result=wrapped?{...outer,current:base}:{...base};for(const key of keys)delete result[key];
 return captureAssistantDerivedValue({...result,p2Context:capture.context});
}

/** Keep the existing protected publication input internal-only. Derived ids
 * are private dependency metadata, never a caller approval or Native proof. */
export function prepareAssistantProtectedInternalContext(snapshot:unknown,visibility:AssistantDerivedVisibility):{snapshot:unknown;isCurrent():boolean}{
 const data=captureAssistantDerivedValue(snapshot);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('assistant_derived_capture_required');
 const outer=data as Record<string,unknown>,ids=Object.hasOwn(outer,'derivedRunIds')?outer.derivedRunIds:[];
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>512)||new Set(ids).size!==ids.length)throw Error('assistant_derived_capture_required');
 const refs=ids.map(id=>{const lineage=visibility.readLineage(id);if(!lineage||hasAssistantExternalLineage(lineage)||!visibility.isRunVisible(id))throw Error('assistant_derived_capture_required');return {id,hash:assistantDerivedHash(lineage)};});
 const isCurrent=()=>{try{return refs.every(ref=>{const lineage=visibility.readLineage(ref.id);return !!lineage&&!hasAssistantExternalLineage(lineage)&&assistantDerivedHash(lineage)===ref.hash&&visibility.isRunVisible(ref.id);});}catch{return false;}};
 if(!isCurrent())throw Error('assistant_derived_stale');
 const clean={...outer};delete clean.derivedRunIds;
 return Object.freeze({snapshot:attachAssistantDerivedContext(clean),isCurrent});
}
