import type {AssistantController,AssistantControllerOptions} from './assistant-controller.js';
import type {AssistantCandidatePager} from './assistant-candidate-pager.js';
import type {AssistantActionOverviewDto} from '../shared/assistant-ipc-contract.js';
import {ASSISTANT_LAUNCH_SUMMARY_SCHEMA} from '../shared/assistant-launch-contract.js';
/** Same Main read composition; no renderer state or authority is introduced. */
export async function readAssistantActionOverview(controller:Pick<AssistantController,'getOverview'|'getCalendarMemorySettings'|'getAnalysisProvider'|'getQualityStatus'|'getPeriodicStatus'>,options:AssistantControllerOptions,pager:AssistantCandidatePager):Promise<AssistantActionOverviewDto>{
    const overview=await controller.getOverview();
    const actions=await options.actionService?.list({requestSource:'user'});
    const {profile}=options.assistantService.bootstrap();
    const run=options.candidates.getLatestAssistantSourceRun?.(profile.id);
    const scopes=new Set(profile.dataScopes);
    const enabled={task_snapshots:['threads','tasks','artifacts'],kswarm_projects:['projects'],timed_actions:['automations'],meeting_metadata:['meetings'],knowledge_source_metadata:['artifacts']} as const;
    const candidatePage=pager.page(overview.candidates);
    const launches=await options.launchService?.list({requestSource:'user'})??[];
    const calendar=options.calendarSource?.status();
    const boundedCalendar=calendar?{...calendar,snapshot:{...calendar.snapshot,events:calendar.snapshot.events.slice(0,20)}}:undefined;
    const calendarMemory=options.calendarMemory?await controller.getCalendarMemorySettings():undefined;
    const analysisProvider=options.analysisSettings?await controller.getAnalysisProvider():undefined;
    const quality=options.qualityReview?await controller.getQualityStatus():undefined;
    const periodic=options.periodicPolicy&&options.periodicRuntime?await controller.getPeriodicStatus():undefined;
    return {...overview,...(calendarMemory?{calendarMemory}:{}),...(analysisProvider?{analysisProvider}:{}),...(quality?{quality}:{}),...(periodic?{periodic}:{}),launches:launches.map(op=>ASSISTANT_LAUNCH_SUMMARY_SCHEMA.parse(Object.fromEntries(Object.keys(ASSISTANT_LAUNCH_SUMMARY_SCHEMA.shape).map(key=>[key,op[key as keyof typeof op]])))),...(boundedCalendar?{calendar:boundedCalendar}:{}),profile,candidates:candidatePage.candidates,nextCandidateCursor:candidatePage.nextCursor,proposals:actions?.proposals??[],...(actions?.hasV2Source?{suggestions:actions.proposals.filter(p=>p.decision==='open').map(p=>({id:p.id,title:p.title,summary:p.reason}))}:{}),schemaVersion:2,coverageState:run?'known':'unknown',collectedAt:run?.now??null,
      analysisStatus:run?.analysisStatus??null,coverage:run?.coverage.map(row=>{
        if(enabled[row.sourceId].some(scope=>scopes.has(scope)))return row;
        return {...row,status:'disabled' as const,recordCount:0,includedCount:0,errorCode:undefined};
      })??[]};
  }
