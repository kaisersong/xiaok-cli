import {createCandidateRepository,createAssistantCandidatePromotionTargets} from './assistant-controller-promotion.js';
export {createAssistantCandidatePromotionTargets} from './assistant-controller-promotion.js';
import type {AssistantCalendarMemorySettingsDto,AssistantCalendarMemoryInput} from '../shared/assistant-calendar-memory-contract.js';
import type {AssistantAnalysisSettings} from './assistant-analysis-settings.js';
import type {AssistantAnalysisSettingsInput} from '../shared/assistant-analysis-settings-contract.js';
import type {AssistantQualityStatus} from '../shared/assistant-quality-contract.js';
import {randomUUID} from 'node:crypto';
import type {AssistantPeriodicPolicyService} from './assistant-periodic-policy.js';
import type {AssistantPeriodicRuntime} from './assistant-periodic-runtime.js';
import {ASSISTANT_PERIODIC_CHECK_SCHEMA,type AssistantPeriodicStatus,type AssistantPeriodicSettings} from '../shared/assistant-periodic-contract.js';
import type {AssistantLaunchService} from './assistant-launch-service.js';
import {ASSISTANT_LAUNCH_SUMMARY_SCHEMA} from '../shared/assistant-launch-contract.js';
import type {AssistantCalendarSource} from './assistant-calendar-source.js';
import {AssistantCandidatePager} from './assistant-candidate-pager.js';
import type {AssistantActionService} from './assistant-action-service.js';
import type {AssistantActionOverviewDto} from '../shared/assistant-ipc-contract.js';
import type {AssistantSourceRun} from '../shared/assistant-coverage-contract.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {publicationFields,publicationIdentity} from './loop-publication-attempt.js';
import type { MemoryStore } from '../../src/ai/memory/store.js';
import {
  AssistantCandidatePromotionService,
  type AssistantCandidatePromotionRecord,
  type AssistantCandidateRequestSource,
} from './assistant-candidate-promotion.js';
import type { AssistantCandidate, AssistantCandidateStatus, AssistantProfile } from './assistant-types.js';
import type { KbStore } from './kb-store.js';

export interface AssistantCandidateStore {
  getLatestAssistantSourceRun?(profileId:string):AssistantSourceRun|undefined;
  getAssistantCandidatePublicationMode?(candidateId:string):'ordinary'|'protected';
  getAssistantCandidate(id: string): AssistantCandidate | undefined;
  listAssistantCandidates(input?: { statuses?: AssistantCandidateStatus[] }): AssistantCandidate[];
  beginAssistantCandidateAccept(
    candidateId: string,
    targetKind: NonNullable<AssistantCandidate['targetKind']>,
    targetId: string,
    now: number,
  ): AssistantCandidate | undefined;
  markAssistantCandidateAccepted(candidateId: string, targetRef: string, now: number): AssistantCandidate | undefined;
  markAssistantCandidateAcceptFailed(candidateId: string, now: number): AssistantCandidate | undefined;
  rejectAssistantCandidate(candidateId: string, now: number,requestSource?:AssistantCandidateRequestSource): AssistantCandidate | undefined;
}

export interface AssistantStatusService {
  bootstrap(): { profile: AssistantProfile };
  setStatus(status: AssistantProfile['status']): AssistantProfile;
}

export interface AssistantOverview {
  profile: AssistantProfile;
  suggestions: Array<{ id: string; title: string; summary: string }>;
  pendingCandidateCount: number;
  candidates: AssistantCandidate[];
}

export interface AssistantControllerOptions {
  calendarMemory?:{status():AssistantCalendarMemorySettingsDto;configure(input:AssistantCalendarMemoryInput&{requestSource:'user'}):AssistantCalendarMemorySettingsDto};
  analysisSettings?:AssistantAnalysisSettings;
  qualityReview?:{status():AssistantQualityStatus|Promise<AssistantQualityStatus>;exportReview(input:{requestSource:'user'}):Promise<{cancelled:boolean;status:AssistantQualityStatus}>;importReview(input:{attestHumanReview:true;requestSource:'user'}):Promise<{cancelled:boolean;status:AssistantQualityStatus}>;revoke(input:{requestSource:'user'}):AssistantQualityStatus|Promise<AssistantQualityStatus>};
  periodicPolicy?:AssistantPeriodicPolicyService;periodicRuntime?:AssistantPeriodicRuntime;notificationReady?:()=>Promise<boolean>;onProfileStatusChanged?:()=>void;isGlobalBackgroundEnabled?:()=>boolean;
  launchService?:AssistantLaunchService;
  calendarSource?:AssistantCalendarSource;
  actionService?:AssistantActionService;
  assistantService: AssistantStatusService;
  candidates: AssistantCandidateStore;
  memoryStore: MemoryStore;
  memoryBackend: 'layered' | 'fallback';
  kbStore: Pick<KbStore, 'getCollection' | 'getSource' | 'addSource' | 'ensureAssistantSource'>;
  resolveProjectCwd?: (projectId: string) => string | undefined;
  listMorningSuggestions?: () => Array<{ id: string; title: string; summary: string }> | Promise<Array<{ id: string; title: string; summary: string }>>;
  assistantPublication?: {acceptAssistantCandidate(input:{candidateId:string;collectionId?:string;requestSource:'user'}):Promise<AssistantCandidate>;recoverAssistantCandidate(input:{candidateId:string;existingThreadId?:string;requestSource:'scheduler'}):Promise<AssistantCandidate>};
  now?: () => number;
}

export class AssistantController {
  private readonly candidatePager=new AssistantCandidatePager();
  private readonly now: () => number;
  private readonly promotion: AssistantCandidatePromotionService;

  constructor(private readonly options: AssistantControllerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.promotion = new AssistantCandidatePromotionService({
      candidates: createCandidateRepository(options.candidates, this.now, options.resolveProjectCwd),
      targets: createAssistantCandidatePromotionTargets({
        memoryStore: options.memoryStore,
        memoryBackend: options.memoryBackend,
        kbStore: options.kbStore,
        now: this.now,
      }),
    });
  }

  async getCalendarMemorySettings(){if(!this.options.calendarMemory)throw Error('assistant_calendar_memory_unavailable');return this.options.calendarMemory.status();}
  async configureCalendarMemory(input:AssistantCalendarMemoryInput&{requestSource:'user'}){if(input?.requestSource!=='user'||!this.options.calendarMemory)throw Error('assistant_calendar_memory_user_only');return this.options.calendarMemory.configure(input);}
  async getAnalysisProvider(){if(!this.options.analysisSettings)throw Error('assistant_analysis_unavailable');return this.options.analysisSettings.status();}
  async configureAnalysisProvider(input:AssistantAnalysisSettingsInput&{requestSource:'user'}){if(input?.requestSource!=='user'||!this.options.analysisSettings)throw Error('assistant_analysis_user_only');return this.options.analysisSettings.configure(input);}
  async listLaunchTargets(input:{cursor?:string;requestSource:'user'}){if(input?.requestSource!=='user'||!this.options.launchService)throw Error('assistant_launch_user_only');return this.options.launchService.listTargets(input);}
  async getQualityStatus(){if(!this.options.qualityReview)throw Error('assistant_quality_unavailable');return this.options.qualityReview.status();}
  async exportQualityReview(input:{requestSource:'user'}){if(input?.requestSource!=='user'||!this.options.qualityReview)throw Error('assistant_quality_user_only');return this.options.qualityReview.exportReview(input);}
  async importQualityReview(input:{attestHumanReview:true;requestSource:'user'}){if(input?.requestSource!=='user'||input.attestHumanReview!==true||!this.options.qualityReview)throw Error('assistant_quality_user_only');return this.options.qualityReview.importReview(input);}
  async revokeQualityReview(input:{requestSource:'user'}){if(input?.requestSource!=='user'||!this.options.qualityReview)throw Error('assistant_quality_user_only');return this.options.qualityReview.revoke(input);}

  async getOverview(): Promise<AssistantOverview> {
    const { profile } = this.options.assistantService.bootstrap();
    const candidates = this.options.candidates.listAssistantCandidates();
    const pending = candidates.filter(candidate => candidate.status === 'pending');
    return {
      profile,
      suggestions: (await this.options.listMorningSuggestions?.() ?? []).slice(0, 3),
      pendingCandidateCount: pending.length,
      candidates,
    };
  }

  async getActionOverview():Promise<AssistantActionOverviewDto> {
    const overview=await this.getOverview();
    const actions=await this.options.actionService?.list({requestSource:'user'});
    const {profile}=this.options.assistantService.bootstrap();
    const run=this.options.candidates.getLatestAssistantSourceRun?.(profile.id);
    const scopes=new Set(profile.dataScopes);
    const enabled={task_snapshots:['threads','tasks','artifacts'],kswarm_projects:['projects'],timed_actions:['automations'],meeting_metadata:['meetings'],knowledge_source_metadata:['artifacts']} as const;
    const candidatePage=this.candidatePager.page(overview.candidates);
    const launches=await this.options.launchService?.list({requestSource:'user'})??[];
    const calendar=this.options.calendarSource?.status();
    const boundedCalendar=calendar?{...calendar,snapshot:{...calendar.snapshot,events:calendar.snapshot.events.slice(0,20)}}:undefined;
    const calendarMemory=this.options.calendarMemory?await this.getCalendarMemorySettings():undefined;
    const analysisProvider=this.options.analysisSettings?await this.getAnalysisProvider():undefined;
    const quality=this.options.qualityReview?await this.getQualityStatus():undefined;
    const periodic=this.options.periodicPolicy&&this.options.periodicRuntime?await this.getPeriodicStatus():undefined;
    return {...overview,...(calendarMemory?{calendarMemory}:{}),...(analysisProvider?{analysisProvider}:{}),...(quality?{quality}:{}),...(periodic?{periodic}:{}),launches:launches.map(op=>ASSISTANT_LAUNCH_SUMMARY_SCHEMA.parse(Object.fromEntries(Object.keys(ASSISTANT_LAUNCH_SUMMARY_SCHEMA.shape).map(key=>[key,op[key as keyof typeof op]])))),...(boundedCalendar?{calendar:boundedCalendar}:{}),profile,candidates:candidatePage.candidates,nextCandidateCursor:candidatePage.nextCursor,proposals:actions?.proposals??[],...(actions?.hasV2Source?{suggestions:actions.proposals.filter(p=>p.decision==='open').map(p=>({id:p.id,title:p.title,summary:p.reason}))}:{}),schemaVersion:2,coverageState:run?'known':'unknown',collectedAt:run?.now??null,
      analysisStatus:run?.analysisStatus??null,coverage:run?.coverage.map(row=>{
        if(enabled[row.sourceId].some(scope=>scopes.has(scope)))return row;
        return {...row,status:'disabled' as const,recordCount:0,includedCount:0,errorCode:undefined};
      })??[]};
  }

  async getPeriodicStatus():Promise<AssistantPeriodicStatus>{
    if(!this.options.periodicPolicy||!this.options.periodicRuntime)throw Error('assistant_periodic_unavailable');
    const readiness=this.options.periodicRuntime.readiness(),profile=this.options.assistantService.bootstrap().profile;
    const notificationsAvailable=readiness.available?await this.options.notificationReady?.()??false:false;
    const policy=this.options.periodicPolicy.status();
    const reason=!readiness.available?(readiness.reason==='budget_unavailable'?'budget_unavailable':'quality_unverified'):profile.status!=='active'?'assistant_paused':this.options.isGlobalBackgroundEnabled?.()===false?'background_disabled':null;
    return {revision:policy.revision,enabled:policy.enabled,notificationsEnabled:policy.notificationsEnabled,intervalMinutes:policy.intervalMinutes,quietHours:policy.quietHours,available:reason===null,reason,notificationsAvailable};
  }
  async configurePeriodic(input:AssistantPeriodicSettings&{requestSource:'user'|'agent'|'scheduler'}){
    if(!this.options.periodicPolicy)throw Error('assistant_periodic_unavailable');this.options.periodicPolicy.configure(input);return this.getPeriodicStatus();
  }
  async checkPeriodic(input:{requestSource:'user'|'agent'|'scheduler'}){
    if(input?.requestSource!=='user')throw Error('assistant_periodic_user_only');if(!this.options.periodicRuntime)throw Error('assistant_periodic_unavailable');
    const result=await this.options.periodicRuntime.check({requestSource:'user',occurrenceId:'manual:'+randomUUID()});
    const value={status:result.status,reason:result.reason??null};return ASSISTANT_PERIODIC_CHECK_SCHEMA.safeParse(value).success?ASSISTANT_PERIODIC_CHECK_SCHEMA.parse(value):{status:'outcome_unknown' as const,reason:'analysis_unavailable' as const};
  }

  cancelLaunch(input:Parameters<AssistantLaunchService['cancel']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.cancel(input);}
  prepareReconfirmation(input:Parameters<AssistantLaunchService['prepareReconfirmation']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.prepareReconfirmation(input);}
  prepareFollowUpLaunch(input:Parameters<AssistantLaunchService['prepareFollowUp']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.prepareFollowUp(input);}
  prepareLaunch(input:Parameters<AssistantLaunchService['prepare']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.prepare(input);}
  confirmLaunch(input:Parameters<AssistantLaunchService['confirm']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.confirm(input);}
  getActionLaunch(input:Parameters<AssistantLaunchService['get']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.get(input);}
  resolveActionLaunch(input:Parameters<AssistantLaunchService['resolve']>[0]){if(!this.options.launchService)throw Error('assistant_launch_unavailable');return this.options.launchService.resolve(input);}

  getCalendarStatus(){if(!this.options.calendarSource)throw Error('assistant_calendar_unavailable');return this.options.calendarSource.status();}
  connectCalendar(input:{requestSource:'user'|'agent'|'scheduler'}){if(!this.options.calendarSource)throw Error('assistant_calendar_unavailable');return this.options.calendarSource.enable(input);}
  disconnectCalendar(input:{requestSource:'user'|'agent'|'scheduler'}){if(!this.options.calendarSource)throw Error('assistant_calendar_unavailable');return this.options.calendarSource.disable(input);}

  getActionCandidatesPage(input:{cursor:string}){
    if(!input||typeof input.cursor!=='string'||!input.cursor||input.cursor.length>160)throw Error('assistant_candidate_cursor_invalid');
    return this.candidatePager.page(this.options.candidates.listAssistantCandidates(),input.cursor);
  }
  dismissAction(input:Parameters<AssistantActionService['dismiss']>[0]){
    if(!this.options.actionService)throw Error('assistant_actions_unavailable');
    return this.options.actionService.dismiss(input);
  }
  snoozeAction(input:Parameters<AssistantActionService['snooze']>[0]){
    if(!this.options.actionService)throw Error('assistant_actions_unavailable');
    return this.options.actionService.snooze(input);
  }

  activate(input: { requestSource: AssistantCandidateRequestSource }): AssistantProfile {
    requireAssistantUser(input.requestSource);
    const profile=this.options.assistantService.setStatus('active');this.options.onProfileStatusChanged?.();return profile;
  }

  pause(input: { requestSource: AssistantCandidateRequestSource }): AssistantProfile {
    requireAssistantUser(input.requestSource);
    const profile=this.options.assistantService.setStatus('paused');this.options.onProfileStatusChanged?.();return profile;
  }

  resume(input: { requestSource: AssistantCandidateRequestSource }): AssistantProfile {
    requireAssistantUser(input.requestSource);
    const profile=this.options.assistantService.setStatus('active');this.options.onProfileStatusChanged?.();return profile;
  }

  async acceptCandidate(input: {
    candidateId: string;
    requestSource: AssistantCandidateRequestSource;
    collectionId?: string;
  }): Promise<AssistantCandidatePromotionRecord> {
    input=captureLoopProducerValue(input);publicationFields(input,['candidateId','requestSource',...(Object.hasOwn(input,'collectionId')?['collectionId']:[])]);publicationIdentity(input.candidateId);
    if(input.requestSource!=='user')throw Error('assistant_candidate_user_only');
    if(this.options.assistantPublication){
      return await this.options.assistantPublication.acceptAssistantCandidate({candidateId:input.candidateId,requestSource:'user',...(input.collectionId!==undefined?{collectionId:input.collectionId}:{})}) as AssistantCandidatePromotionRecord;
    }
    if(this.options.candidates.getAssistantCandidatePublicationMode)throw Error('assistant_publication_host_required');
    return await this.promotion.accept(input);
  }

  rejectCandidate(input: {
    candidateId: string;
    requestSource: AssistantCandidateRequestSource;
  }): AssistantCandidate {
    if (input.requestSource !== 'user') throw new Error('assistant_candidate_user_only');
    const candidate = this.options.candidates.rejectAssistantCandidate(input.candidateId, this.now(),'user');
    if (!candidate) throw new Error('assistant_candidate_not_found');
    if (candidate.status !== 'rejected') throw new Error('assistant_candidate_reject_conflict');
    return candidate;
  }

  async recoverAccepting(input:{requestSource:AssistantCandidateRequestSource}): Promise<Array<{ candidateId: string; status: 'accepted' | 'accept_failed' }>> {
    if(!input)throw Error('assistant_candidate_recovery_source');
    input=captureLoopProducerValue(input);publicationFields(input,['requestSource']);
    if(!['user','scheduler'].includes(input.requestSource))throw Error('assistant_candidate_recovery_source');
    if(this.options.candidates.getAssistantCandidatePublicationMode&&!this.options.assistantPublication)throw Error('assistant_publication_host_required');
    const results:Array<{candidateId:string;status:'accepted'|'accept_failed'}>=[];
    for(const candidate of this.options.candidates.listAssistantCandidates({statuses:['accepting']})){
      try{
        if(this.options.assistantPublication){
          const result=await this.options.assistantPublication.recoverAssistantCandidate({candidateId:candidate.id,requestSource:'scheduler'});
          if(result.status==='accepted')results.push({candidateId:candidate.id,status:'accepted'});
        }else results.push(...await this.promotion.recoverAccepting({candidateId:candidate.id,requestSource:input.requestSource}));
      }catch{/* Preserve the original accepting intent for transient current/permission failures. */}
    }
    return results;
  }
}

function requireAssistantUser(requestSource: AssistantCandidateRequestSource): void {
  if (requestSource !== 'user') throw new Error('assistant_user_only');
}
