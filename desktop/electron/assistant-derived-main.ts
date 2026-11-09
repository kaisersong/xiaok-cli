import {createHash} from 'node:crypto';
import type {MemoryStore} from '../../src/ai/memory/store.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import type {DesktopLoopPublicationService} from './loop-desktop-publication-service.js';
import type {AssistantCalendarSource} from './assistant-calendar-source.js';
import {DEFAULT_PERSONAL_ASSISTANT_ID} from './assistant-types.js';
import {beginAssistantDerivedCapture,createAssistantDerivedVisibility,type AssistantMemoryConfirmation} from './assistant-derived-lineage.js';
import {createAssistantMemoryConfirmationReader} from './assistant-memory-confirmation.js';
import {createAssistantPublicationContextReader} from './assistant-publication-context.js';
import {ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA,ASSISTANT_CALENDAR_MEMORY_SCHEMA,type AssistantCalendarMemoryInput} from '../shared/assistant-calendar-memory-contract.js';
import {captureAssistantDerivedValue} from './assistant-derived-data.js';
/** Main owns the fixed Store/Source/member tuple. IPC cannot choose this owner,
 * profile, cwd, provider, database, approval callback or memory reader. */
export function createAssistantDerivedMainPorts(options:{store:LoopStore;evidenceStore:CompletionEvidenceStore;publication:DesktopLoopPublicationService;calendarSource:AssistantCalendarSource;memoryStore():MemoryStore;dataRoot:string;cwd():string;projectCwd(projectId:string):string|undefined}){
 const {store,evidenceStore,calendarSource}=options,ownerId='desktop-user:'+createHash('sha256').update(options.dataRoot).digest('hex'),profileId=DEFAULT_PERSONAL_ASSISTANT_ID,key={ownerId,profileId};
 const owner=()=>({...key,cwd:options.cwd()}),settings=()=>store.getAssistantCalendarMemorySettings(key);
 const originalMemory=options.memoryStore(),originalGet=originalMemory.getById,originalRecall=originalMemory.listRelevant,apply=Reflect.apply;
 const memoryPort={listRelevant:(input:Parameters<MemoryStore['listRelevant']>[0])=>apply(originalRecall,originalMemory,[input]),...(originalGet?{getById:(id:string)=>apply(originalGet,originalMemory,[id])}: {})};
 let confirm:ReturnType<typeof createAssistantMemoryConfirmationReader>|undefined;
 const visibility=createAssistantDerivedVisibility({readLineage:id=>store.readAssistantDerivedLineage(id),isTrackedAssistantRun:id=>store.isAssistantDerivedRunTracked(id),getProfile:id=>id===profileId?store.getAssistantProfile(profileId):undefined,
  currentCalendar:()=>{const context=calendarSource.context(),value=context.read();return context.isCurrent()&&value.status!=='disabled'&&value.status!=='unavailable'?{epoch:value.epoch,events:value.events}:undefined;},
  currentMemorySettings:(id,profile)=>id===ownerId&&profile===profileId?settings():undefined,getMemory:id=>memoryPort.getById?.(id),confirmMemory:record=>confirm?.(record)});
 confirm=createAssistantMemoryConfirmationReader({store,evidenceStore,visibility,owner,projectCwd:options.projectCwd});
 store.bindAssistantDerivedVisibility(visibility);evidenceStore.bindAssistantDerivedVisibility(visibility);
 const contextReader=createAssistantPublicationContextReader({store,evidenceStore,publication:options.publication,derivedVisibility:visibility});
 const derived=Object.freeze({visibility,
  recordCollection:(runId:string,lineage:Parameters<LoopStore['recordAssistantDerivedLineage']>[1],current:()=>boolean)=>store.recordAssistantDerivedLineage(runId,lineage,current),
  beginCapture:(input:{kind:'morning'|'evening';profile:Parameters<typeof beginAssistantDerivedCapture>[0]['profile'];now:number})=>beginAssistantDerivedCapture({profile:input.profile,getProfile:()=>store.getAssistantProfile(profileId),owner,calendar:()=>calendarSource.context(),includeCalendar:input.kind==='morning',memorySettings:settings,memoryStore:memoryPort,confirmMemory:record=>confirm?.(record),visibility,now:input.now}),
 });
 const calendarMemory=Object.freeze({
  status(){const value=settings();return ASSISTANT_CALENDAR_MEMORY_SCHEMA.parse({enabled:value.enabled,revision:value.revision});},
  configure(raw:AssistantCalendarMemoryInput&{requestSource:'user'|'agent'|'scheduler'}){
   const input=captureAssistantDerivedValue(raw);if(input.requestSource!=='user')throw Error('assistant_calendar_memory_user_only');
   const {requestSource,...data}=input,value=ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA.parse(data),result=store.setAssistantCalendarMemorySettings({...key,...value,requestSource});return ASSISTANT_CALENDAR_MEMORY_SCHEMA.parse({enabled:result.enabled,revision:result.revision});
  },
 });
 return Object.freeze({contextReader,derived,calendarMemory,visibility,confirmMemory:(record:Parameters<NonNullable<typeof confirm>>[0]):AssistantMemoryConfirmation|undefined=>confirm?.(record)});
}
export type AssistantDerivedRuntimePorts=ReturnType<typeof createAssistantDerivedMainPorts>['derived'];
