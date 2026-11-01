import type {AssistantCalendarMemorySettingsDto,AssistantCalendarMemoryInput} from '../api/types';
import {AssistantLaunchTargetPicker} from './assistant/AssistantLaunchTargetPicker';
import type {AssistantThreadTargetPage,AssistantAnalysisStatus,AssistantAnalysisSettingsInput} from '../api/types';
import type {AssistantQualityStatus} from '../api/types';
import type {AssistantPeriodicStatus,AssistantPeriodicSettings,AssistantPeriodicCheck} from '../api/types';
import {AssistantLaunchConfirm} from './assistant/AssistantLaunchConfirm';
import {AssistantLaunchHistory} from './assistant/AssistantLaunchHistory';
import type {AssistantLaunchDraft,AssistantLaunchOperation,AssistantLaunchSummary} from '../api/types';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, FolderKanban } from 'lucide-react';
import { ChatInput } from './ChatInput';
import { api } from '../api';
import type { AutomationOverviewSnapshotView, AssistantCandidatePageDto, AssistantActionOverviewDto, AssistantActionDecisionResultDto, AssistantProfileDto, AssistantCandidateDto, AssistantAcceptResultDto, AssistantOverviewDto } from '../api/types';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';
import { useKSwarm } from '../contexts/KSwarmContext';
import { AssistantHomeCard } from './assistant/AssistantHomeCard';
import { AssistantDetailPanel } from './assistant/AssistantDetailPanel';
import type {
  AssistantCandidateView,
  AssistantHomeSnapshot,
} from './assistant/view-types';
import {
  automationFailureRoute,
  buildAssistantHomeProjection,
  buildWelcomeHomeProjection,
  type WelcomeAttentionItem,
  type WelcomeHomeProjection,
} from './welcome-home-projection';

interface AssistantDesktopApi {
  getAssistantCalendarMemorySettings?():Promise<AssistantCalendarMemorySettingsDto>;
  configureAssistantCalendarMemory?(input:AssistantCalendarMemoryInput):Promise<AssistantCalendarMemorySettingsDto>;
  getAssistantLaunchTargets?(input:{cursor?:string}):Promise<AssistantThreadTargetPage>;
  configureAssistantAnalysisProvider?(input:AssistantAnalysisSettingsInput):Promise<AssistantAnalysisStatus>;
  exportAssistantQualityReview?():Promise<{cancelled:boolean;status:AssistantQualityStatus}>;
  importAssistantQualityReview?(input:{attestHumanReview:true}):Promise<{cancelled:boolean;status:AssistantQualityStatus}>;
  revokeAssistantQualityReview?():Promise<AssistantQualityStatus>;
  configureAssistantPeriodic?(input:AssistantPeriodicSettings):Promise<AssistantPeriodicStatus>;
  checkAssistantPeriodic?():Promise<AssistantPeriodicCheck>;
  cancelAssistantLaunch?(input:{draftId:string}):Promise<AssistantLaunchOperation>;
  prepareAssistantReconfirmation?(input:{draftId:string;existingThreadId?:string}):Promise<AssistantLaunchDraft>;
  prepareAssistantFollowUpLaunch?(input:{candidateId:string;existingThreadId?:string}):Promise<AssistantLaunchDraft>;
  prepareAssistantLaunch?(input:{proposalId:string;expectedRevision:number;existingThreadId?:string}):Promise<AssistantLaunchDraft>;
  confirmAssistantLaunch?(input:{draftId:string;instruction:string;goalConsentChecked?:boolean}):Promise<AssistantLaunchOperation>;
  getAssistantLaunch?(input:{draftId:string}):Promise<{draft:AssistantLaunchDraft;operation:AssistantLaunchOperation|null}>;
  resolveAssistantLaunch?(input:{draftId:string;expectedResultDigest:string}):Promise<AssistantLaunchOperation>;
  connectAssistantCalendar?():Promise<import('../api/types').AssistantCalendarStatus>;
  disconnectAssistantCalendar?():Promise<import('../api/types').AssistantCalendarStatus>;
  getAssistantCandidatePage?(input:{cursor:string}):Promise<AssistantCandidatePageDto>;
  dismissAssistantAction?(input:{proposalId:string;expectedRevision:number}):Promise<AssistantActionDecisionResultDto>;
  snoozeAssistantAction?(input:{proposalId:string;expectedRevision:number;snoozeUntil:number}):Promise<AssistantActionDecisionResultDto>;
  getAssistantActionOverview?():Promise<AssistantActionOverviewDto>;
  getAssistantOverview(): Promise<AssistantOverviewDto>;
  activateAssistant(): Promise<AssistantProfileDto>;
  pauseAssistant(): Promise<AssistantProfileDto>;
  resumeAssistant(): Promise<AssistantProfileDto>;
  acceptAssistantCandidate(input: { candidateId: string; collectionId?: string }): Promise<AssistantAcceptResultDto>;
  rejectAssistantCandidate(input: { candidateId: string }): Promise<AssistantCandidateDto>;
  kbListCollections(): Promise<unknown[]>;
}

function getAssistantDesktopApi(): Partial<AssistantDesktopApi> | null {
  return getDesktopApi() as unknown as Partial<AssistantDesktopApi> | null;
}

function useProfileName() {
  const [name, setName] = useState(() =>
    localStorage.getItem('xiaok_display_name')
    || getDesktopApi()?.systemUsername
    || ''
  );
  useEffect(() => {
    const handler = () => {
      setName(
        localStorage.getItem('xiaok_display_name')
        || getDesktopApi()?.systemUsername
        || ''
      );
    };
    window.addEventListener('xiaok-profile-changed', handler);
    return () => window.removeEventListener('xiaok-profile-changed', handler);
  }, []);
  return name;
}

function useTypewriter(text: string, speed = 80) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;
    if (!text) return;

    const timer = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(timer);
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  return displayed;
}

export function WelcomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [assistantDraftPrepared,setAssistantDraftPrepared]=useState(false);
  const [assistantActionConflict,setAssistantActionConflict]=useState(false);
  const [automation, setAutomation] = useState<AutomationOverviewSnapshotView | null>(null);
  const [automationLoadState, setAutomationLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [assistantSnapshot, setAssistantSnapshot] = useState<AssistantHomeSnapshot | null>(null);
  const assistantReadEpoch=useRef(0);
  const assistantPageFlight=useRef(false);
  const [assistantCandidateCursor,setAssistantCandidateCursor]=useState<string|null>(null);
  const [assistantPageBusy,setAssistantPageBusy]=useState(false);
  const [assistantCandidates, setAssistantCandidates] = useState<AssistantCandidateView[]>([]);
  const [assistantLoadState, setAssistantLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [calendarError,setCalendarError]=useState(false);
  type LaunchTargetRequest={kind:'action';proposalId:string;revision:number}|{kind:'follow_up';candidateId:string}|{kind:'reconfirm';draftId:string};
  const [launchTargetRequest,setLaunchTargetRequest]=useState<LaunchTargetRequest|null>(null);
  const [launchTargets,setLaunchTargets]=useState<AssistantThreadTargetPage['items']>([]);
  const [launchTargetCursor,setLaunchTargetCursor]=useState<string|null>(null);
  const [launchTargetsUnavailable,setLaunchTargetsUnavailable]=useState(false);const launchTargetEpoch=useRef(0);
  const [periodicResult,setPeriodicResult]=useState<AssistantPeriodicCheck['status']|null>(null);
  const [launchDraft,setLaunchDraft]=useState<AssistantLaunchDraft|null>(null);
  const [launchUnknown,setLaunchUnknown]=useState(false);
  const [assistantOperationUnknown, setAssistantOperationUnknown] = useState(false);
  const [assistantBusyCandidateId, setAssistantBusyCandidateId] = useState<string | null>(null);
  const [assistantDetailsOpen, setAssistantDetailsOpen] = useState(false);
  const [assistantKnowledgeCollections, setAssistantKnowledgeCollections] = useState<Array<{ id: string; name: string }>>([]);
  const { t } = useLocale();
  const { projects, projectsLoaded } = useKSwarm();

  const username = useProfileName();
  const greeting = `${username}${t.welcome.greetingSuffix}`;
  const typedGreeting = useTypewriter(greeting, 60);
  const projection = useMemo(() => buildWelcomeHomeProjection(projects, automation), [automation, projects]);
  const projectsUnavailable = projects.length === 0 && !projectsLoaded;
  const automationLoading = automationLoadState === 'loading';
  const automationUnavailable = automationLoadState === 'error';

  const loadAssistantOverview = useCallback(async () => {
    const epoch=++assistantReadEpoch.current;
    const assistantApi = getAssistantDesktopApi();
    if (!assistantApi?.getAssistantOverview) {
      setAssistantSnapshot(null);
      setAssistantCandidates([]);
      setAssistantLoadState('unavailable');
      return;
    }
    try {
      const overview = await (assistantApi.getAssistantActionOverview?.() ?? assistantApi.getAssistantOverview());
      if(epoch!==assistantReadEpoch.current)return;
      setAssistantCandidateCursor('nextCandidateCursor' in overview&&typeof overview.nextCandidateCursor==='string'?overview.nextCandidateCursor:null);
      setAssistantSnapshot(buildAssistantHomeProjection(overview));
      setAssistantCandidates(overview.candidates ?? []);
      setAssistantLoadState('ready');
      setAssistantOperationUnknown(false);
    } catch {
      if(epoch!==assistantReadEpoch.current)return;
      setAssistantCandidateCursor(null);
      setAssistantOperationUnknown(true);
      setAssistantSnapshot(null);
      setAssistantCandidates([]);
      setAssistantLoadState('unavailable');
    }
  }, []);

  useEffect(() => {
    let active = true;
    api.getAutomationOverviewSnapshot()
      .then(snapshot => {
        if (active) {
          setAutomation(snapshot);
          setAutomationLoadState('ready');
        }
      })
      .catch(() => {
        if (active) {
          setAutomation(null);
          setAutomationLoadState('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadAssistantOverview();
  }, [loadAssistantOverview]);

  useEffect(()=>()=>{assistantReadEpoch.current++;},[]);
  const loadMoreAssistantCandidates=async()=>{
    const assistantApi=getAssistantDesktopApi();
    if(!assistantCandidateCursor||!assistantApi?.getAssistantCandidatePage||assistantPageFlight.current)return;
    assistantPageFlight.current=true;setAssistantPageBusy(true);
    const epoch=assistantReadEpoch.current;
    try{
      const page=await assistantApi.getAssistantCandidatePage({cursor:assistantCandidateCursor});
      if(epoch!==assistantReadEpoch.current)return;
      setAssistantCandidates(current=>{
        const ids=new Set(current.map(candidate=>candidate.id));
        return [...current,...page.candidates.filter(candidate=>!ids.has(candidate.id))];
      });
      setAssistantCandidateCursor(page.nextCursor);
    }catch{if(epoch===assistantReadEpoch.current)setAssistantOperationUnknown(true);}
    finally{assistantPageFlight.current=false;setAssistantPageBusy(false);}
  };

  const decideAssistantAction=async(proposalId:string,revision:number,decision:'dismiss'|'snooze')=>{
    const assistantApi=getAssistantDesktopApi();
    if(!assistantApi?.dismissAssistantAction||!assistantApi.snoozeAssistantAction){setAssistantOperationUnknown(true);return;}
    assistantReadEpoch.current++;
    setAssistantBusy(true);setAssistantActionConflict(false);
    try{
      const result=decision==='dismiss'
        ?await assistantApi.dismissAssistantAction({proposalId,expectedRevision:revision})
        :await assistantApi.snoozeAssistantAction({proposalId,expectedRevision:revision,snoozeUntil:Date.now()+2*60*60_000});
      await loadAssistantOverview();
      if(result.status==='conflict')setAssistantActionConflict(true);
    }catch{setAssistantOperationUnknown(true);}
    finally{setAssistantBusy(false);}
  };

  const updateAssistantStatus = async (action: 'activateAssistant' | 'pauseAssistant' | 'resumeAssistant') => {
    const assistantApi = getAssistantDesktopApi();
    const mutation = assistantApi?.[action];
    if (!mutation) {
      setAssistantLoadState('unavailable');
      return;
    }
    assistantReadEpoch.current++;
    setAssistantOperationUnknown(false);
    setAssistantBusy(true);
    try {
      await mutation.call(assistantApi);
      await loadAssistantOverview();
    } catch {
      setAssistantOperationUnknown(true);
    } finally {
      setAssistantBusy(false);
    }
  };

  const decideAssistantCandidate = async (candidateId: string, decision: 'accept' | 'reject', collectionId?: string) => {
    const assistantApi = getAssistantDesktopApi();
    const mutation = decision === 'accept' ? assistantApi?.acceptAssistantCandidate : assistantApi?.rejectAssistantCandidate;
    if (!mutation) {
      setAssistantLoadState('unavailable');
      return;
    }
    assistantReadEpoch.current++;
    setAssistantOperationUnknown(false);
    setAssistantBusyCandidateId(candidateId);
    try {
      await mutation.call(assistantApi, { candidateId, ...(collectionId ? { collectionId } : {}) });
      await loadAssistantOverview();
    } catch {
      setAssistantOperationUnknown(true);
    } finally {
      setAssistantBusyCandidateId(null);
    }
  };

  const openAssistantDetails = async () => {
    setAssistantDetailsOpen(true);
    const assistantApi = getAssistantDesktopApi();
    if (!assistantApi?.kbListCollections) return;
    try {
      const collections = await assistantApi.kbListCollections();
      setAssistantKnowledgeCollections(collections.flatMap(value => {
        if (!value || typeof value !== 'object') return [];
        const record = value as Record<string, unknown>;
        return typeof record.id === 'string' && typeof record.name === 'string'
          ? [{ id: record.id, name: record.name }]
          : [];
      }));
    } catch {
      setAssistantKnowledgeCollections([]);
    }
  };

  const openLaunch=async(item:AssistantLaunchSummary)=>{
    const owner=getAssistantDesktopApi();if(!owner?.getAssistantLaunch)return;
    const actual=(await owner.getAssistantLaunch({draftId:item.draftId})).operation;
    if(!actual||actual.state!=='attached'||!actual.taskId){setAssistantOperationUnknown(true);await loadAssistantOverview();return;}
    await api.cacheAssistantLaunchThread({threadId:actual.threadId,taskId:actual.taskId,title:actual.title,updatedAt:actual.createdAt});
    navigate(`/t/${actual.threadId}`);
  };
  const prepareLaunch=async(proposalId:string,expectedRevision:number,existingThreadId?:string)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.prepareAssistantLaunch)return;
    setAssistantBusy(true);setLaunchUnknown(false);
    try{setLaunchDraft(await owner.prepareAssistantLaunch({proposalId,expectedRevision,...existingThreadId?{existingThreadId}:{}}));}
    catch{await loadAssistantOverview();setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };
  const prepareFollowUpLaunch=async(candidateId:string,existingThreadId?:string)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.prepareAssistantFollowUpLaunch)return;
    setAssistantBusy(true);setLaunchUnknown(false);
    try{setLaunchDraft(await owner.prepareAssistantFollowUpLaunch({candidateId,...existingThreadId?{existingThreadId}:{}}));setAssistantDetailsOpen(false);}
    catch{await loadAssistantOverview();setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };
  const prepareReconfirmation=async(item:Pick<AssistantLaunchSummary,'draftId'>,existingThreadId?:string)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.prepareAssistantReconfirmation)return;setAssistantBusy(true);
    try{setLaunchDraft(await owner.prepareAssistantReconfirmation({draftId:item.draftId,...existingThreadId?{existingThreadId}:{}}));setLaunchUnknown(false);}
    catch{setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };
  const cancelLaunch=async(item:AssistantLaunchSummary)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.cancelAssistantLaunch)return;setAssistantBusy(true);
    try{await owner.cancelAssistantLaunch({draftId:item.draftId});await loadAssistantOverview();}
    catch{setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };
  const confirmLaunch=async(instruction:string,goalConsentChecked?:boolean)=>{
    if(!launchDraft||assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.confirmAssistantLaunch)return;
    setAssistantBusy(true);
    try{const actual=await owner.confirmAssistantLaunch({draftId:launchDraft.id,instruction,...goalConsentChecked!==undefined?{goalConsentChecked}:{}});
      if(actual.state==='attached'&&actual.taskId){setLaunchDraft(null);await openLaunch(actual);}else setLaunchUnknown(true);
      await loadAssistantOverview();
    }catch{setLaunchUnknown(true);}finally{setAssistantBusy(false);}
  };
  const lookupLaunch=async(draftId:string)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.getAssistantLaunch)return;setAssistantBusy(true);
    try{const actual=await owner.getAssistantLaunch({draftId});
      if(launchDraft?.id===draftId){if(actual.operation?.state==='attached')setLaunchDraft(null);else setLaunchUnknown(actual.operation!==null);}
      await loadAssistantOverview();
    }catch{setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };
  const resolveLaunch=async(item:AssistantLaunchSummary)=>{
    if(assistantBusy||!item.resultDigest)return;const owner=getAssistantDesktopApi();if(!owner?.resolveAssistantLaunch)return;setAssistantBusy(true);
    try{await owner.resolveAssistantLaunch({draftId:item.draftId,expectedResultDigest:item.resultDigest});await loadAssistantOverview();}
    catch{setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };

  const chooseLaunchTarget=async(request:LaunchTargetRequest)=>{
    if(assistantBusy)return;const epoch=++launchTargetEpoch.current;setLaunchTargetRequest(request);setLaunchTargets([]);setLaunchTargetCursor(null);setLaunchTargetsUnavailable(false);setAssistantBusy(true);
    try{const owner=getAssistantDesktopApi();if(!owner?.getAssistantLaunchTargets)throw Error('unavailable');const page=await owner.getAssistantLaunchTargets({});if(epoch===launchTargetEpoch.current){setLaunchTargets(page.items);setLaunchTargetCursor(page.nextCursor);}}
    catch{if(epoch===launchTargetEpoch.current)setLaunchTargetsUnavailable(true);}finally{if(epoch===launchTargetEpoch.current)setAssistantBusy(false);}
  };
  const moreLaunchTargets=async()=>{
    if(assistantBusy||!launchTargetCursor)return;const owner=getAssistantDesktopApi();if(!owner?.getAssistantLaunchTargets)return;const epoch=launchTargetEpoch.current;setAssistantBusy(true);
    try{const page=await owner.getAssistantLaunchTargets({cursor:launchTargetCursor});if(epoch===launchTargetEpoch.current){setLaunchTargets(items=>{const byId=new Map(items.map(item=>[item.threadId,item]));for(const item of page.items)byId.set(item.threadId,item);return [...byId.values()];});setLaunchTargetCursor(page.nextCursor);}}
    catch{if(epoch===launchTargetEpoch.current)setLaunchTargetsUnavailable(true);}finally{if(epoch===launchTargetEpoch.current)setAssistantBusy(false);}
  };
  const continueLaunchTarget=async(existingThreadId?:string)=>{
    if(assistantBusy||!launchTargetRequest)return;const request=launchTargetRequest;setLaunchTargetRequest(null);++launchTargetEpoch.current;
    if(request.kind==='action')await prepareLaunch(request.proposalId,request.revision,existingThreadId);
    else if(request.kind==='follow_up')await prepareFollowUpLaunch(request.candidateId,existingThreadId);
    else await prepareReconfirmation({draftId:request.draftId},existingThreadId);
  };
  const configureAnalysis=async(input:AssistantAnalysisSettingsInput)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.configureAssistantAnalysisProvider)return;setAssistantBusy(true);
    try{await owner.configureAssistantAnalysisProvider(input);await loadAssistantOverview();}catch{await loadAssistantOverview();setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };

  const qualityReview=async(kind:'export'|'import'|'revoke')=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner)return;setAssistantBusy(true);
    try{if(kind==='export')await owner.exportAssistantQualityReview?.();else if(kind==='import')await owner.importAssistantQualityReview?.({attestHumanReview:true});else await owner.revokeAssistantQualityReview?.();await loadAssistantOverview();}
    catch{await loadAssistantOverview();setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };

  const configurePeriodic=async(input:AssistantPeriodicSettings)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.configureAssistantPeriodic)return;setAssistantBusy(true);setPeriodicResult(null);
    try{await owner.configureAssistantPeriodic(input);await loadAssistantOverview();}
    catch{await loadAssistantOverview();setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };
  const checkPeriodic=async()=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();if(!owner?.checkAssistantPeriodic)return;setAssistantBusy(true);setPeriodicResult(null);
    try{const result=await owner.checkAssistantPeriodic();setPeriodicResult(result.status);await loadAssistantOverview();}
    catch{setPeriodicResult('outcome_unknown');}finally{setAssistantBusy(false);}
  };

  const configureCalendarMemory=async(input:AssistantCalendarMemoryInput)=>{
    if(assistantBusy)return;const owner=getAssistantDesktopApi();
    if(!owner?.configureAssistantCalendarMemory){setAssistantOperationUnknown(true);return;}
    ++assistantReadEpoch.current;setAssistantBusy(true);
    try{await owner.configureAssistantCalendarMemory({enabled:input.enabled,expectedRevision:input.expectedRevision});await loadAssistantOverview();}
    catch{await loadAssistantOverview();setAssistantOperationUnknown(true);}finally{setAssistantBusy(false);}
  };

  const changeCalendar=async(enabled:boolean)=>{
    if(assistantBusy)return;
    const owner=getAssistantDesktopApi();const action=enabled?owner?.connectAssistantCalendar:owner?.disconnectAssistantCalendar;
    if(!action)return;
    ++assistantReadEpoch.current;
    setAssistantSnapshot(previous=>previous?{...previous,calendar:undefined}:previous);
    setAssistantBusy(true);setCalendarError(false);
    try{await action.call(owner);await loadAssistantOverview();}
    catch{setCalendarError(true);await loadAssistantOverview();}
    finally{setAssistantBusy(false);}
  };

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    const thread = await api.createThread({ title: text.slice(0, 40) });

    try {
      let taskId: string;
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.filePath);
        const result = await api.createTaskWithFiles({ prompt: text, filePaths, context: { threadId: thread.id } });
        taskId = result.taskId;
      } else {
        const result = await api.createTask({ prompt: text, materials: [], context: { threadId: thread.id } });
        taskId = result.taskId;
      }
      await api.updateThreadTaskId(thread.id, taskId);
    } catch (e) {
      console.error('[WelcomePage] createTask failed:', (e as Error).message);
    }

    navigate(`/t/${thread.id}`, {
      state: {
        initialPrompt: text,
        ...(files && files.length > 0
          ? { initialFiles: files.map(file => ({ filePath: file.filePath, name: file.name })) }
          : {}),
      },
    });
  };

  const handleQuickPrompt = (p: string) => {
    setAssistantDraftPrepared(false);
    setPrompt(p);
  };

  const handleGoalQuickPrompt = async () => {
    const thread = await api.createThread({ title: t.goalBar.createGoal });
    navigate(`/t/${thread.id}`, { state: { createGoal: true } });
  };

  const openAttentionItem = (item: WelcomeAttentionItem) => {
    navigate(item.kind === 'project' ? `/projects/${item.id}` : automationFailureRoute(item.failure));
  };

  return (
    <div className="flex min-h-full flex-1 flex-col px-6 pt-[clamp(4rem,12vh,6.25rem)] sm:px-8">
      {assistantActionConflict&&<p role="status" className="mx-auto mb-3 w-full max-w-[920px] text-xs text-[var(--c-text-secondary)]">{t.assistant.actionConflict}</p>}
      {assistantOperationUnknown && (
        <div role="alert" className="mx-auto mb-4 flex w-full max-w-[920px] items-center gap-3 text-sm text-[var(--c-text-secondary)]">
          <span>{t.assistant.operationUnknown}</span>
          <button type="button" disabled={assistantBusy || assistantBusyCandidateId !== null} onClick={() => void loadAssistantOverview()} className="shrink-0 underline">
            {t.assistant.refreshStatus}
          </button>
        </div>
      )}
      {launchTargetRequest&&<AssistantLaunchTargetPicker items={launchTargets} busy={assistantBusy} unavailable={launchTargetsUnavailable} hasMore={!!launchTargetCursor} onMore={()=>{void moreLaunchTargets();}} onContinue={id=>{void continueLaunchTarget(id);}} onClose={()=>{++launchTargetEpoch.current;setLaunchTargetRequest(null);}}/>}
      {launchDraft&&<AssistantLaunchConfirm key={launchDraft.id} draft={launchDraft} busy={assistantBusy} unknown={launchUnknown} onClose={()=>setLaunchDraft(null)} onConfirm={(instruction,checked)=>{void confirmLaunch(instruction,checked);}} onLookup={()=>{void lookupLaunch(launchDraft.id);}}/>}
      {periodicResult&&<p role="status" className="mx-auto mb-3 w-full max-w-[920px] text-xs text-[var(--c-text-secondary)]">{t.assistant.periodicResult(periodicResult)}</p>}
      <ConversationFirstHome
        onConfigureCalendarMemory={input=>{void configureCalendarMemory(input);}}
        onConfigureAnalysis={input=>{void configureAnalysis(input);}}
        onExportQuality={()=>{void qualityReview('export');}} onImportQuality={()=>{void qualityReview('import');}} onRevokeQuality={()=>{void qualityReview('revoke');}}
        onSavePeriodic={input=>{void configurePeriodic(input);}} onCheckPeriodic={()=>{void checkPeriodic();}}
        calendarError={calendarError}
        onConnectCalendar={()=>{void changeCalendar(true);}}
        onDisconnectCalendar={()=>{void changeCalendar(false);}}
        onStartAssistantFollowUp={candidateId=>{void chooseLaunchTarget({kind:'follow_up',candidateId});}}
        onStartAssistantAction={(id,revision)=>{void chooseLaunchTarget({kind:'action',proposalId:id,revision});}}
        typedGreeting={typedGreeting}
        prompt={prompt}
        setPrompt={value=>{setPrompt(value);if(!value.trim())setAssistantDraftPrepared(false);}}
        onSubmit={handleSubmit}
        onQuickPrompt={handleQuickPrompt}
        onGoalQuickPrompt={handleGoalQuickPrompt}
        projection={projection}
        onOpenItem={openAttentionItem}
        automationLoading={automationLoading}
        automationUnavailable={automationUnavailable}
        projectsUnavailable={projectsUnavailable}
        assistantDraftPrepared={assistantDraftPrepared}
        onPrepareAssistantDraft={instruction=>{if(!prompt.trim()){setPrompt(instruction);setAssistantDraftPrepared(true);}}}
        onDismissAssistantAction={(id,revision)=>decideAssistantAction(id,revision,'dismiss')}
        onSnoozeAssistantAction={(id,revision)=>decideAssistantAction(id,revision,'snooze')}
        assistantSnapshot={assistantSnapshot}
        hasMoreAssistantCandidates={assistantCandidateCursor!==null}
        assistantPageBusy={assistantPageBusy}
        onLoadMoreAssistantCandidates={loadMoreAssistantCandidates}
        assistantCandidates={assistantCandidates}
        assistantLoadState={assistantLoadState}
        assistantBusy={assistantBusy}
        assistantBusyCandidateId={assistantBusyCandidateId}
        assistantDetailsOpen={assistantDetailsOpen}
        assistantKnowledgeCollections={assistantKnowledgeCollections}
        onActivateAssistant={() => updateAssistantStatus('activateAssistant')}
        onPauseAssistant={() => updateAssistantStatus('pauseAssistant')}
        onResumeAssistant={() => updateAssistantStatus('resumeAssistant')}
        onOpenAssistantDetails={openAssistantDetails}
        onCloseAssistantDetails={() => setAssistantDetailsOpen(false)}
        onAcceptAssistantCandidate={(candidateId, collectionId) => decideAssistantCandidate(candidateId, 'accept', collectionId)}
        onRejectAssistantCandidate={candidateId => decideAssistantCandidate(candidateId, 'reject')}
      />
      <div className="mx-auto w-full max-w-[920px]"><AssistantLaunchHistory items={assistantSnapshot?.launches??[]} busy={assistantBusy} onCancel={item=>{void cancelLaunch(item);}} onReconfirm={item=>{void chooseLaunchTarget({kind:'reconfirm',draftId:item.draftId});}} onOpen={item=>{void openLaunch(item).catch(()=>setAssistantOperationUnknown(true));}} onLookup={item=>{void lookupLaunch(item.draftId);}} onResolve={item=>{void resolveLaunch(item);}}/></div>
    </div>
  );
}

type HomeContentProps = {
  onConfigureCalendarMemory:(input:AssistantCalendarMemoryInput)=>void;
  onConfigureAnalysis:(input:AssistantAnalysisSettingsInput)=>void;
  onExportQuality:()=>void;onImportQuality:(input:{attestHumanReview:true})=>void;onRevokeQuality:()=>void;
  onSavePeriodic:(input:AssistantPeriodicSettings)=>void;onCheckPeriodic:()=>void;
  calendarError:boolean;onConnectCalendar:()=>void;onDisconnectCalendar:()=>void;
  onStartAssistantAction:(id:string,revision:number)=>void;
  onStartAssistantFollowUp:(candidateId:string)=>void;
  typedGreeting: string;
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: (text: string, files?: Array<{ filePath: string; name: string }>) => Promise<void>;
  projection: WelcomeHomeProjection;
  onOpenItem: (item: WelcomeAttentionItem) => void;
  automationLoading: boolean;
  automationUnavailable: boolean;
  projectsUnavailable: boolean;
  assistantDraftPrepared:boolean;
  onPrepareAssistantDraft:(instruction:string)=>void;
  onDismissAssistantAction:(id:string,revision:number)=>Promise<void>;
  onSnoozeAssistantAction:(id:string,revision:number)=>Promise<void>;
  assistantSnapshot: AssistantHomeSnapshot | null;
  hasMoreAssistantCandidates:boolean;
  assistantPageBusy:boolean;
  onLoadMoreAssistantCandidates:()=>Promise<void>;
  assistantCandidates: AssistantCandidateView[];
  assistantLoadState: 'loading' | 'ready' | 'unavailable';
  assistantBusy: boolean;
  assistantBusyCandidateId: string | null;
  assistantDetailsOpen: boolean;
  assistantKnowledgeCollections: Array<{ id: string; name: string }>;
  onActivateAssistant: () => Promise<void>;
  onPauseAssistant: () => Promise<void>;
  onResumeAssistant: () => Promise<void>;
  onOpenAssistantDetails: () => void;
  onCloseAssistantDetails: () => void;
  onAcceptAssistantCandidate: (candidateId: string, collectionId?: string) => Promise<void>;
  onRejectAssistantCandidate: (candidateId: string) => Promise<void>;
};

function ConversationFirstHome({
  onConfigureCalendarMemory,
  onConfigureAnalysis,
  onExportQuality,onImportQuality,onRevokeQuality,
  onSavePeriodic,onCheckPeriodic,
  calendarError,onConnectCalendar,onDisconnectCalendar,onStartAssistantAction,onStartAssistantFollowUp,
  typedGreeting,
  prompt,
  setPrompt,
  onSubmit,
  projection,
  onOpenItem,
  onQuickPrompt,
  automationLoading,
  automationUnavailable,
  projectsUnavailable,
  assistantDraftPrepared,onPrepareAssistantDraft,onDismissAssistantAction,onSnoozeAssistantAction,
  assistantSnapshot,
  hasMoreAssistantCandidates,assistantPageBusy,onLoadMoreAssistantCandidates,
  assistantCandidates,
  assistantLoadState,
  assistantBusy,
  assistantBusyCandidateId,
  assistantDetailsOpen,
  assistantKnowledgeCollections,
  onActivateAssistant,
  onPauseAssistant,
  onResumeAssistant,
  onOpenAssistantDetails,
  onCloseAssistantDetails,
  onAcceptAssistantCandidate,
  onRejectAssistantCandidate,
  onGoalQuickPrompt,
}: HomeContentProps & { onQuickPrompt: (prompt: string) => void; onGoalQuickPrompt: () => Promise<void> }) {
  const { t } = useLocale();
  const attentionUnavailable = projectsUnavailable || automationLoading || automationUnavailable;
  const availabilityMessages = [
    projectsUnavailable ? t.welcome.projectsUnavailable : '',
    automationLoading ? t.welcome.automationLoading : '',
    automationUnavailable ? t.welcome.automationUnavailable : '',
  ].filter(Boolean);
  const attentionEmptyLabel = availabilityMessages.join(' · ') || t.welcome.noAttention;
  return (
    <div data-testid="welcome-home" className="mx-auto flex w-full max-w-[920px] flex-col items-center pb-24">
      <div data-testid="welcome-brand" aria-hidden="true" className="punctum-brand">{t.welcome.brandName}</div>
      <h1 className="min-h-[2.5rem] text-center text-3xl font-medium text-[var(--c-text-primary)]">{typedGreeting}</h1>
      <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{t.welcome.conversationSubtitle}</p>
      <div className="mt-6 w-full max-w-2xl">
        {assistantDraftPrepared&&prompt.trim()&&<p className="mb-2 text-xs text-[var(--c-text-secondary)]">{t.assistant.draftPreparedNotice}</p>}
        <ChatInput value={prompt} onChange={setPrompt} onSubmit={onSubmit} placeholder={t.welcome.inputPlaceholder} autoFocus />
      </div>
      <QuickPrompts onSelect={onQuickPrompt} onGoalSelect={onGoalQuickPrompt} />
      <div className="mt-[clamp(4.5rem,14vh,8rem)] w-full">
        {calendarError&&<p role="status" className="mb-2 text-xs text-[var(--c-text-secondary)]">{t.assistant.calendarError}</p>}
        <AssistantHomeCard
          onConfigureCalendarMemory={onConfigureCalendarMemory}
          onConfigureAnalysis={onConfigureAnalysis}
          onExportQuality={onExportQuality} onImportQuality={onImportQuality} onRevokeQuality={onRevokeQuality}
          onSavePeriodic={onSavePeriodic} onCheckPeriodic={onCheckPeriodic}
          onConnectCalendar={onConnectCalendar}
          onDisconnectCalendar={onDisconnectCalendar}
          onStartAction={onStartAssistantAction}
          onPrepareDraft={onPrepareAssistantDraft}
          canPrepareDraft={!prompt.trim()}
          onDismissAction={onDismissAssistantAction}
          onSnoozeAction={onSnoozeAssistantAction}
          snapshot={assistantSnapshot}
          loadState={assistantLoadState}
          busy={assistantBusy}
          onActivate={onActivateAssistant}
          onPause={onPauseAssistant}
          onResume={onResumeAssistant}
          onOpenDetails={onOpenAssistantDetails}
        />
      </div>
      <section className="mt-[clamp(5rem,15vh,8rem)] w-full border-y border-[var(--c-border)] py-4" aria-labelledby="welcome-overview-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="welcome-overview-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.welcome.overviewTitle}</h2>
          <span className="text-xs text-[var(--c-text-tertiary)]">{t.welcome.readOnlySummary}</span>
        </div>
        <MetricStrip
          projection={projection}
          projectsUnavailable={projectsUnavailable}
          attentionUnavailable={attentionUnavailable}
          automationLoading={automationLoading}
          automationUnavailable={automationUnavailable}
        />
        {availabilityMessages.length > 0 && projection.attentionItems.length > 0 && (
          <p className="mt-3 text-xs text-[var(--c-text-tertiary)]">
            {availabilityMessages.join(' · ')}
          </p>
        )}
      </section>
      <section className="mt-5 w-full" aria-labelledby="welcome-continue-title">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="welcome-continue-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.welcome.continueWork}</h2>
          <span className="text-xs text-[var(--c-text-tertiary)]">{t.welcome.topItemsOnly}</span>
        </div>
        <AttentionList items={projection.attentionItems.slice(0, 3)} onOpen={onOpenItem} emptyLabel={attentionEmptyLabel} />
      </section>
      {assistantSnapshot && (
        <AssistantDetailPanel
        onStartFollowUp={onStartAssistantFollowUp}
          open={assistantDetailsOpen}
          profile={assistantSnapshot.profile}
          hasMoreCandidates={hasMoreAssistantCandidates}
          loadingMore={assistantPageBusy}
          onLoadMore={onLoadMoreAssistantCandidates}
          candidates={assistantCandidates}
          knowledgeCollections={assistantKnowledgeCollections}
          busyCandidateId={assistantBusyCandidateId}
          onClose={onCloseAssistantDetails}
          onAcceptCandidate={onAcceptAssistantCandidate}
          onRejectCandidate={onRejectAssistantCandidate}
        />
      )}
    </div>
  );
}

function QuickPrompts({ onSelect, onGoalSelect }: { onSelect: (prompt: string) => void; onGoalSelect: () => Promise<void> }) {
  const { t } = useLocale();
  const buttonClassName = 'whitespace-nowrap rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:border-[var(--c-accent)] hover:bg-[var(--c-bg-card)] hover:text-[var(--c-accent)]';
  return (
    <div className="mt-4 w-full max-w-3xl">
      <div data-testid="quick-prompts" className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => void onGoalSelect()}
          title={t.welcome.goalQuickPrompt}
          className={buttonClassName}
        >
          {t.welcome.goalQuickPrompt}
        </button>
        <button
          type="button"
          onClick={() => onSelect(t.welcome.subagentPrompt)}
          title={t.welcome.subagentPrompt}
          className={buttonClassName}
        >
          {t.welcome.subagentQuickPrompt}
        </button>
        {t.welcome.quickPrompts.map(prompt => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            title={prompt}
            className={buttonClassName}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricStrip({
  projection,
  projectsUnavailable,
  attentionUnavailable,
  automationLoading,
  automationUnavailable,
}: {
  projection: WelcomeHomeProjection;
  projectsUnavailable: boolean;
  attentionUnavailable: boolean;
  automationLoading: boolean;
  automationUnavailable: boolean;
}) {
  const { t } = useLocale();
  const metrics = [
    { testId: 'welcome-metric-active-projects', label: t.welcome.activeProjects, value: projectsUnavailable ? '—' : projection.counts.activeProjects, icon: <FolderKanban size={15} /> },
    { testId: 'welcome-metric-attention', label: t.welcome.needsAttention, value: attentionUnavailable ? '—' : projection.counts.attention, icon: <AlertTriangle size={15} /> },
    { testId: 'welcome-metric-automations', label: t.welcome.activeAutomations, value: (automationLoading || automationUnavailable) ? '—' : projection.counts.activeAutomations, icon: <Bot size={15} /> },
    { testId: 'welcome-metric-completed', label: t.welcome.recentlyCompleted, value: projectsUnavailable ? '—' : projection.counts.completedProjects, icon: <CheckCircle2 size={15} /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {metrics.map(metric => (
        <div key={metric.testId} className="flex items-center gap-3 px-2 py-1">
          <span className="grid size-8 place-items-center rounded-md bg-[var(--c-bg-deep)] text-[var(--c-accent)]">{metric.icon}</span>
          <div>
            <p data-testid={metric.testId} className="punctum-number tabular-nums text-[var(--c-text-primary)]">{metric.value}</p>
            <p className="text-[11px] text-[var(--c-text-secondary)]">{metric.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AttentionList({ items, onOpen, emptyLabel }: { items: WelcomeAttentionItem[]; onOpen: (item: WelcomeAttentionItem) => void; emptyLabel: string }) {
  const { t } = useLocale();
  if (items.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-[var(--c-text-secondary)]">{emptyLabel}</div>;
  }
  return (
    <div className="divide-y divide-[var(--c-border)]">
      {items.map(item => (
        <button
          key={`${item.kind}:${item.id}`}
          type="button"
          aria-label={t.welcome.openAttentionItem(
            item.title,
            item.kind === 'project' ? t.welcome.statusNeedsAction : t.welcome.statusFailed,
            item.reason,
            item.kind === 'project' ? item.nextStep : undefined,
          )}
          onClick={() => onOpen(item)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--c-bg-deep)]"
        >
          <span className={`grid size-8 shrink-0 place-items-center rounded-md ${item.kind === 'project' ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-500'}`}>
            {item.kind === 'project' ? <FolderKanban size={15} /> : <Bot size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-[var(--c-text-primary)]">{item.title}</span>
              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                {item.kind === 'project' ? t.welcome.statusNeedsAction : t.welcome.statusFailed}
              </span>
            </span>
            {item.reason && <span className="mt-1 block truncate text-xs text-[var(--c-text-secondary)]">{item.reason}</span>}
            {item.kind === 'project' && item.nextStep && (
              <span className="mt-1 block truncate text-[11px] text-[var(--c-text-tertiary)]">{t.welcome.nextStep(item.nextStep)}</span>
            )}
          </span>
          <ArrowRight size={14} className="shrink-0 text-[var(--c-text-tertiary)]" />
        </button>
      ))}
    </div>
  );
}
