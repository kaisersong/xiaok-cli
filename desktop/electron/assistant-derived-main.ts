import {createHash} from 'node:crypto';
import type {MemoryStore} from '../../src/ai/memory/store.js';
import type {LoopStore} from './loop-store.js';
import type {CompletionEvidenceStore} from './completion-evidence-store.js';
import type {DesktopLoopPublicationService} from './loop-desktop-publication-service.js';
import type {AssistantCalendarSource} from './assistant-calendar-source.js';
import {DEFAULT_PERSONAL_ASSISTANT_ID} from './assistant-types.js';
import {beginAssistantDerivedCapture,createAssistantDerivedVisibility,assistantDerivedHash} from './assistant-derived-lineage.js';
import {createAssistantPublicationContextReader} from './assistant-publication-context.js';
import type {CreateAssistantRuntimeOptions} from './assistant-runtime.js';
import {ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA,ASSISTANT_CALENDAR_MEMORY_SCHEMA,type AssistantCalendarMemoryInput} from '../shared/assistant-calendar-memory-contract.js';

/** Main's actual composition; fixed local owner/profile, no renderer-supplied
 * identity/cwd, no generic raw-reader capability and no external write tools. */
export function createAssistantDerivedMainPorts(options:{
 store:LoopStore;evidenceStore:CompletionEvidenceStore;publication:DesktopLoopPublicationService;
 calendarSource:AssistantCalendarSource;memoryStore():MemoryStore;
 dataRoot:string;cwd():string;projectCwd(projectId:string):string|undefined;
}){
 const {store,evidenceStore,calendarSource}=options;
 const ownerId='desktop-user:'+createHash('sha256').update(options.dataRoot).digest('hex'),profileId=DEFAULT_PERSONAL_ASSISTANT_ID;
 const key={ownerId,profileId};
 const owner=()=>({...key,cwd:options.cwd()});
 const settings=()=>store.getAssistantCalendarMemorySettings(key);
 let contextReader:ReturnType<typeof createAssistantPublicationContextReader>|undefined;
 const visibility=createAssistantDerivedVisibility({
  readLineage:runId=>store.readAssistantDerivedLineage(runId),
  isTrackedAssistantRun:runId=>store.isAssistantDerivedRunTracked(runId),
  getProfile:id=>id===profileId?store.getAssistantProfile(profileId):undefined,
  currentCalendar:()=>{const context=calendarSource.context(),snapshot=context.read();return context.isCurrent()&&snapshot&&snapshot.status!=='disabled'&&snapshot.status!=='unavailable'?{epoch:snapshot.epoch,events:snapshot.events}:undefined;},
  currentMemorySettings:(requestedOwner,requestedProfile)=>requestedOwner===ownerId&&requestedProfile===profileId?settings():undefined,
  getMemory:id=>options.memoryStore().getById?.(id),
  confirmMemory:record=>contextReader?.confirmMemory(record),
 });
 store.bindAssistantDerivedVisibility(visibility);evidenceStore.bindAssistantDerivedVisibility(visibility);
 contextReader=createAssistantPublicationContextReader({store,evidenceStore,publication:options.publication,derivedVisibility:visibility,memoryOwner:owner,projectCwd:options.projectCwd,
  readMemoryConfirmationFacts:candidateId=>{
   const candidate=store.captureAssistantMemoryConfirmationFacts(candidateId);if(!candidate)return undefined;
   const evidence=evidenceStore.captureAssistantMemoryEvidenceFacts(candidate.run.id,candidate.run.evidenceIds);if(!evidence)return undefined;
   const isCurrent=()=>candidate.isCurrent()&&evidence.isCurrent();
   if(!isCurrent())return undefined;
   return {candidate:candidate.candidate,run:candidate.run,revision:assistantDerivedHash({candidate:candidate.revision,evidence:evidence.revision}),isCurrent};
  },
 });
 const derived:NonNullable<CreateAssistantRuntimeOptions['derived']>={
  visibility,
  recordCollection:(input,isCurrent)=>store.recordAssistantDerivedSourceRun(input,isCurrent),
  beginCapture:input=>beginAssistantDerivedCapture({profile:input.profile,getProfile:()=>store.getAssistantProfile(profileId),owner,calendar:()=>calendarSource.context(),includeCalendar:input.kind==='morning',memorySettings:settings,memoryStore:options.memoryStore(),confirmMemory:record=>contextReader?.confirmMemory(record),visibility,now:input.now}),
 };
 const calendarMemory={
  status(){const current=settings();return ASSISTANT_CALENDAR_MEMORY_SCHEMA.parse({enabled:current.enabled,revision:current.revision});},
  configure(input:AssistantCalendarMemoryInput&{requestSource:'user'}){
   if(input?.requestSource!=='user')throw Error('assistant_calendar_memory_user_only');
   const {requestSource,...raw}=input,value=ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA.parse(raw);
   const current=store.setAssistantCalendarMemorySettings({...key,...value,requestSource});
   return ASSISTANT_CALENDAR_MEMORY_SCHEMA.parse({enabled:current.enabled,revision:current.revision});
  },
 };
 return {contextReader,derived,calendarMemory,visibility};
}
