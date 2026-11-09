import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { McpWorkControls } from './McpWorkControls';
import {NativeWorkControls,nativeAnswerKey,type NativeAnswerState,type NativeActivityCoverage,type NativeTaskScope} from './NativeWorkControls';
import type {NativeActivityQuestionForm} from '../../../shared/native-activity-question-contract.js';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ConversationWorkView, ReportingPreference, ConversationActivity } from '../../../shared/conversation-activity-types.js';

/** The desktop main process reports a failed owner attach with one stable code; show fixed copy, never the code. */
const isOwnerUnavailable = (error: unknown) => error instanceof Error && error.message.includes('activity_owner_unavailable');
const isSourceForbidden=(error:unknown)=>error instanceof Error&&/\b(activity_(?:native_read_forbidden|actor_forbidden|thread_forbidden|source_forbidden|watch_forbidden|thread_deleted|source_superseded)|task_scope_forbidden|native_access_denied)\b/.test(error.message);
const isThreadReadForbidden=(error:unknown)=>error instanceof Error&&/\bactivity_(?:actor_forbidden|thread_forbidden|thread_deleted)\b/.test(error.message);

type WorkView = ConversationWorkView;

function preview(summary?: string): string {
  if (!summary || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(summary.trim())) return '';
  return (summary.replace(/^[#>\s]+/gm, '').replace(/\*\*|__|`/g, '').split('\n').find(line => line.trim()) ?? '').slice(0, 120);
}

function priority(view: WorkView): number {
  // Older owners have no unified presentation. Keep their card readable in a
  // fixed compatibility category; only main classifies current owner facts.
  return view.presentation?.categoryRank ?? 2;
}
const sourceFresh = (view: WorkView) => view.projection.freshness === 'fresh' && (!view.presentation || view.presentation.freshness === 'fresh');
const compareIdentity = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function WorkSummary({ summary, label }: { summary: string; label: string }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-2 text-[var(--c-text-secondary)]" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-xs"><span className="line-clamp-2 break-words">{preview(summary)}</span><span className="text-[var(--c-text-muted)]">{label}</span></summary>
    {open && <div className="mt-2 max-h-48 overflow-y-auto break-words text-sm"><MarkdownRenderer content={summary} disableLinkify /></div>}
  </details>;
}

/** A presentation of main-owned activity. No model turn or business polling lives here. */
export function ConversationActivityPanel({ threadId,onNativeCoverage }: { threadId: string;onNativeCoverage?:(coverage:NativeActivityCoverage)=>void }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkView[]>([]);
  const [error, setError] = useState<false | 'generic' | 'owner'>(false);
  const [reports, setReports] = useState<ConversationActivity[]>([]);
  const [expanded, setExpanded] = useState(false);
  const generationRef = useRef(0);
  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const coverageRef=useRef(onNativeCoverage);coverageRef.current=onNativeCoverage;
  const coverageState=useRef<NativeActivityCoverage>({threadId,forbiddenScopes:[],questions:[]});
  const nativeScopes=useRef(new Map<string,NativeTaskScope>()),deniedScopes=useRef(new Map<string,NativeTaskScope>());
  const actionCoverage=useRef(new Map<string,NativeTaskScope&{questionId:string}>());
  const invalidateLoad=useRef<(()=>void)|undefined>(undefined);
  const publishCoverage=(value:NativeActivityCoverage)=>{const questions=[...new Map([...value.questions,...actionCoverage.current.values()].map(item=>[JSON.stringify(item),item])).values()];const current={...value,questions};coverageState.current=current;coverageRef.current?.(current);};
  const [nativeInputs,setNativeInputs]=useState<Map<string,{forms:NativeActivityQuestionForm[];error:boolean}>>(new Map());
  const answerStates=useRef(new Map<string,NativeAnswerState>());
  const [answerRevision,setAnswerRevision]=useState(0);
  void answerRevision;
  useEffect(() => {
    const api = getDesktopApi();
    let live = true, revision = 0;
    generationRef.current++;
    setWorks([]); setReports([]); setExpanded(false); setError(false);
    setNativeInputs(new Map());answerStates.current=new Map();actionCoverage.current=new Map();nativeScopes.current=new Map();deniedScopes.current=new Map();publishCoverage({threadId,forbiddenScopes:[],questions:[]});
    invalidateLoad.current=()=>{revision++;};
    if (!api?.getConversationActivities || !api?.getWorkActivity) return;
    const load = async () => {
      const request = ++revision;
      const denied=new Map<string,NativeTaskScope>();
      const deny=(scope:NativeTaskScope)=>{
        const key=JSON.stringify(scope);denied.set(key,scope);
        if(!live||request!==revision)return;
        deniedScopes.current.set(key,scope);
        const affected=new Set([...nativeScopes.current].filter(([,item])=>item.taskId===scope.taskId&&item.taskSessionId===scope.taskSessionId).map(([id])=>id));
        setWorks(current=>current.filter(view=>!affected.has(view.watch.watchId)));
        setReports(current=>current.filter(report=>!affected.has(report.watchId)));
        setNativeInputs(current=>new Map([...current].filter(([id])=>!affected.has(id))));
        publishCoverage({threadId,forbiddenScopes:[...deniedScopes.current.values()],questions:coverageState.current.questions.filter(item=>item.taskId!==scope.taskId||item.taskSessionId!==scope.taskSessionId)});
      };
      let listed=false;
      try {
        const activities: ConversationActivity[] = [];
        let afterLocalSeq = 0;
        for (;;) {
          const page = await api.getConversationActivities({ threadId, limit: 200, ...(afterLocalSeq ? { afterLocalSeq } : {}) });
          if (!live || request !== revision) return;
          activities.push(...page);
          if (page.length < 200) break;
          const next = page.at(-1)!.localSeq;
          if (next <= afterLocalSeq || activities.length > 100_000) throw new Error('activity_page_stalled');
          afterLocalSeq = next;
        }
        const ids = [...new Set(activities.map(item => item.watchId))];
        listed=true;
        const results=await Promise.allSettled(ids.map(async id=>{try{
          const view=await api.getWorkActivity(id);if(live&&request===revision&&view.questionSourceKind==='codex_native_approval')nativeScopes.current.set(id,{taskId:view.watch.workId,taskSessionId:view.watch.sourceDataEpoch});
          if(view.projection.errorCode==='activity_source_forbidden'){const scope=nativeScopes.current.get(id);if(scope)deny(scope);}return view;
        }catch(cause){const scope=nativeScopes.current.get(id);if(scope&&isSourceForbidden(cause))deny(scope);throw cause;}}));
        if(!live||request!==revision)return;
        const views:WorkView[]=[];let firstError:unknown,failed=false;
        for(const[index,result]of results.entries()){
          if(result.status==='fulfilled')views.push(result.value);
          else{const scope=nativeScopes.current.get(ids[index]);if(scope&&isSourceForbidden(result.reason))denied.set(JSON.stringify(scope),scope);if(!failed){failed=true;firstError=result.reason;}}
        }
        if(failed)throw firstError;
        const inputs=new Map<string,{forms:NativeActivityQuestionForm[];error:boolean}>();
        const deniedWatches=new Set<string>();
        await Promise.all(views.filter(view=>view.questionSourceKind==='codex_native_approval'&&view.watch.status==='active'&&view.projection.errorCode!=='activity_source_forbidden').map(async view=>{
          try{if(!api.getNativeActivityQuestions)throw Error('activity_native_source_unsupported');const forms=await api.getNativeActivityQuestions(view.watch.watchId);inputs.set(view.watch.watchId,{forms,error:false});}
          catch(cause){if(isSourceForbidden(cause)){deniedWatches.add(view.watch.watchId);deny({taskId:view.watch.workId,taskSessionId:view.watch.sourceDataEpoch});}inputs.set(view.watch.watchId,{forms:[],error:true});}
        }));
        if (live && request === revision) {
          const currentViews=views.map(view=>{const scope=nativeScopes.current.get(view.watch.watchId);const unavailable=deniedWatches.has(view.watch.watchId)||scope&&denied.has(JSON.stringify(scope));if(unavailable)inputs.set(view.watch.watchId,{forms:[],error:true});return unavailable?{...view,presentation:undefined,attentionState:undefined,projection:{...view.projection,summary:undefined,evidenceRefs:[],freshness:'unavailable' as const,errorCode:'activity_source_forbidden'}}:view;});
          const readable = new Set(currentViews.filter(view => view.projection.errorCode !== 'activity_source_forbidden' && sourceFresh(view)).map(view => view.watch.watchId));
          setWorks(currentViews); setReports(activities.filter(item => item.kind === 'report' && readable.has(item.watchId))); setError(false);
          setNativeInputs(inputs);
          // A fresh Main inventory proving the question is still pending permits
          // another explicit choice after an uncertain ACK. Never resend it here.
          for(const input of inputs.values())for(const form of input.forms)if(answerStates.current.get(nativeAnswerKey(form))==='uncertain'){answerStates.current.delete(nativeAnswerKey(form));actionCoverage.current.delete(nativeAnswerKey(form));}
          for(const view of currentViews){
            const scope=view.questionSourceKind==='codex_native_approval'?{taskId:view.watch.workId,taskSessionId:view.watch.sourceDataEpoch}:nativeScopes.current.get(view.watch.watchId);
            if(!scope)continue;nativeScopes.current.set(view.watch.watchId,scope);const key=JSON.stringify(scope);
            if(view.projection.errorCode==='activity_source_forbidden')deniedScopes.current.set(key,scope);
            else if(!denied.has(key)&&view.questionSourceKind==='codex_native_approval'&&sourceFresh(view))deniedScopes.current.delete(key);
          }
          for(const[key,scope]of denied)deniedScopes.current.set(key,scope);
          publishCoverage({threadId,forbiddenScopes:[...deniedScopes.current.values()],questions:views.flatMap(view=>(inputs.get(view.watch.watchId)?.forms??[]).map(form=>({taskId:view.watch.workId,taskSessionId:view.watch.sourceDataEpoch,questionId:form.questionId})))});
          const throughLocalSeq = activities.at(-1)?.localSeq;
          if (throughLocalSeq !== undefined) void api.markConversationActivitiesRead?.({ threadId, throughLocalSeq }).catch(() => undefined);
        }
      } catch (cause) { if (live && request === revision) {setWorks([]);setReports([]);setNativeInputs(new Map());if(!listed&&isThreadReadForbidden(cause))for(const scope of nativeScopes.current.values())denied.set(JSON.stringify(scope),scope);for(const[key,scope]of denied)deniedScopes.current.set(key,scope);publishCoverage({threadId,forbiddenScopes:[...deniedScopes.current.values()],questions:[]});setError(isOwnerUnavailable(cause)?'owner':'generic');} }
    };
    loadRef.current = load;
    // Register before the initial read, so a fast completion cannot disappear.
    const stop = api.subscribeConversationActivities?.(threadId, () => { void load(); });
    void load();
    return () => { live = false; revision++; generationRef.current++; stop?.(); loadRef.current = undefined;invalidateLoad.current=undefined;actionCoverage.current=new Map();publishCoverage({threadId,forbiddenScopes:[],questions:[]}); };
  }, [threadId]);

  const answerNative=async(watchId:string,form:NativeActivityQuestionForm,choiceId:'approve'|'deny')=>{
    const key=nativeAnswerKey(form);if(answerStates.current.has(key))return;
    const states=answerStates.current,generation=generationRef.current;states.set(key,'pending');setAnswerRevision(value=>value+1);
    const scope=nativeScopes.current.get(watchId);if(scope)actionCoverage.current.set(key,{...scope,questionId:form.questionId});
    try{const api=getDesktopApi();if(!api?.answerNativeActivityQuestion)throw Error('activity_unavailable');await api.answerNativeActivityQuestion({watchId,questionRef:form.questionRef,expectedDigest:form.expectedDigest,choiceId});if(generation===generationRef.current)invalidateLoad.current?.();states.set(key,'accepted');}
    catch(cause){if(generation===generationRef.current)invalidateLoad.current?.();states.set(key,'uncertain');if(generation===generationRef.current&&isSourceForbidden(cause)){
      const scope=nativeScopes.current.get(watchId),affected=new Set([watchId]);
      if(scope)for(const[id,item]of nativeScopes.current)if(item.taskId===scope.taskId&&item.taskSessionId===scope.taskSessionId)affected.add(id);
      setNativeInputs(current=>new Map([...current].filter(([id])=>!affected.has(id))));
      setWorks(current=>current.filter(view=>!affected.has(view.watch.watchId)));
      setReports(current=>current.filter(report=>!affected.has(report.watchId)));
      if(scope){deniedScopes.current.set(JSON.stringify(scope),scope);publishCoverage({threadId,forbiddenScopes:[...deniedScopes.current.values()],questions:coverageState.current.questions.filter(item=>item.taskId!==scope.taskId||item.taskSessionId!==scope.taskSessionId)});}
    }}
    if(generation===generationRef.current){setAnswerRevision(value=>value+1);if(states.get(key)==='accepted')await loadRef.current?.();}
  };

  const update = async (view: WorkView, preference?: ReportingPreference) => {
    const api = getDesktopApi();
    if (!api) return;
    try {
      const input = { watchId: view.watch.watchId, expectedPolicyRevision: view.watch.policyRevision };
      const watch = preference ? await api.updateWorkReporting({ ...input, preference }) : await api.stopWorkWatch(input);
      if (!watch?.watchId) throw new Error('activity_invalid_reply');
      setWorks(current => current.map(item => item.watch.watchId === watch.watchId ? { ...item, watch } : item));
      await loadRef.current?.();
    } catch (cause) { setError(isOwnerUnavailable(cause) ? 'owner' : 'generic'); }
  };
  const dismiss = async (view: WorkView) => {
    const api = getDesktopApi();
    if (!api?.dismissWorkAttention || !view.attentionState || !view.presentation) return;
    const generation = generationRef.current;
    try {
      await api.dismissWorkAttention({ watchId: view.watch.watchId, expectedProjectionVersion: view.presentation.projectionVersion,
        expectedPresentationIncarnation: view.attentionState.presentationIncarnation });
      // Reload through the existing view generation guard. Never install a late
      // mutation response into another conversation or a newer denied read.
      if (generation === generationRef.current) await loadRef.current?.();
    } catch (cause) { if (generation === generationRef.current) setError(isOwnerUnavailable(cause) ? 'owner' : 'generic'); }
  };
  const needsInput = works.some(view => view.watch.status !== 'stopped'&&view.projection.errorCode !== 'activity_source_forbidden'
    &&(view.watch.source==='mcp'&&view.projection.executionState==='input_required'||Boolean(nativeInputs.get(view.watch.watchId)?.forms.length)));
  useEffect(() => { if (needsInput) setExpanded(true); }, [needsInput]);
  const labels = t.conversationActivity;
  if (!works.length) return error ? <p role="status" className="text-xs text-[var(--c-text-muted)]">{error === 'owner' ? labels.ownerUnavailable : labels.error}</p> : null;
  const ordered = [...works].sort((a, b) => priority(a) - priority(b)
    || compareIdentity(a.presentation?.workRef ?? a.watch.workId, b.presentation?.workRef ?? b.watch.workId)
    || compareIdentity(a.presentation?.anchorFactId ?? a.watch.watchId, b.presentation?.anchorFactId ?? b.watch.watchId));
  const safetyFacts = new Map<string, { source: WorkView['watch']['source']; code: keyof typeof labels.attentionReasons }>();
  for (const view of ordered) if (view.projection.errorCode !== 'activity_source_forbidden') {
    for (const reason of view.presentation?.reasons ?? []) if (reason.severity === 'blocking') {
      safetyFacts.set(JSON.stringify([view.presentation!.anchorFactId, reason.code]), { source: view.watch.source, code: reason.code });
    }
  }
  const latestReports = new Map(reports.map(item => [item.watchId, item]));
  const focused = ordered[0];
  const showDetails = expanded || needsInput;
  const displayedQuestions=new Set<string>();
  const state = ({ watch, projection }: WorkView) => projection.errorCode === 'activity_source_forbidden' ? labels.unavailable
    : watch.status === 'stopped' ? labels.stopped
    : watch.source === 'kswarm' && projection.executionState === 'cancelled' ? labels.projectClosed
    : projection.businessOutcome === 'error' ? labels.states.failed : labels.states[projection.executionState];
  const time = (value: number | null) => value === null ? labels.noProgress : new Date(value).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US');
  const ago = (value: number) => {
    const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
    const rtf = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { numeric: 'auto' });
    if (seconds < 60) return rtf.format(0, 'second');
    if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
    if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
    return rtf.format(-Math.floor(seconds / 86400), 'day');
  };
  return (
    <section aria-label={labels.title} className="w-full overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)]" data-testid="conversation-activity">
      <button type="button" data-testid="activity-toggle" aria-expanded={showDetails} disabled={needsInput}
        aria-label={`${labels.title} · ${labels.workCount(works.length)} · ${showDetails ? labels.collapse : labels.expand}`}
        onClick={() => setExpanded(value => !value)} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs">
        <span className="shrink-0 font-medium text-[var(--c-text-secondary)]">{labels.title}</span>
        {!showDetails && <>
          <span className="shrink-0 text-[var(--c-accent)]">{labels.sources[focused.watch.source]} · {state(focused)}</span>
          <span className="min-w-0 flex-1 truncate text-[var(--c-text-muted)]">{preview(focused.projection.summary)}</span>
          {!sourceFresh(focused) && <span className="shrink-0 text-[var(--c-text-muted)]">{labels.unavailable}</span>}
        </>}
        <span className="ml-auto shrink-0 text-[var(--c-text-muted)]">{labels.workCount(works.length)}</span>
        {showDetails ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {safetyFacts.size > 0 && <ul data-testid="activity-safety-facts" className="space-y-1 border-t border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-secondary)]">
        {[...safetyFacts].map(([key, fact]) => <li key={key}>{labels.sources[fact.source]} · {labels.attentionReasons[fact.code]}</li>)}
      </ul>}
      {showDetails && <div data-testid="activity-details" className="max-h-64 space-y-2 overflow-y-auto overscroll-contain border-t border-[var(--c-border)] p-2">
      {ordered.map(view => {
        const { watch, projection } = view;
        const stopped = watch.status === 'stopped';
        const forbidden = projection.errorCode === 'activity_source_forbidden';
        const report = !forbidden && sourceFresh(view) ? latestReports.get(watch.watchId) : undefined;
        const terminal = ['completed', 'failed', 'cancelled'].includes(projection.executionState);
        const native=nativeInputs.get(watch.watchId);
        const nativeForms=(native?.forms??[]).filter(form=>{const key=nativeAnswerKey(form);if(displayedQuestions.has(key))return false;displayedQuestions.add(key);return true;});
        return (
          <article key={watch.watchId} data-testid={`activity-work-${watch.watchId}`} className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--c-text-heading)]">{labels.sources[watch.source]}</span>
              <span className="text-xs text-[var(--c-accent)]">{state(view)}</span>
              {watch.source==='kswarm'&&!forbidden&&!stopped&&sourceFresh(view)&&!view.presentation?.protocolUnavailable&&view.presentation?.deliveryStage==='ready_for_acceptance'&&<span className="rounded border border-[var(--c-border)] px-1.5 text-xs text-[var(--c-accent)]">{labels.readyForAcceptance}</span>}
              {!forbidden && !sourceFresh(view) && <span className="text-xs text-[var(--c-text-muted)]">{labels.unavailable}</span>}
              {watch.source === 'kswarm' && <button type="button" className="ml-auto text-xs text-[var(--c-accent)]" onClick={() => navigate(`/projects/${encodeURIComponent(watch.workId)}`)}>{labels.details}</button>}
            </div>
            {!forbidden && sourceFresh(view) && view.attentionState && view.presentation && !view.presentation.protocolUnavailable && <div className="mt-2 text-xs text-[var(--c-text-muted)]">
              {view.attentionState.dismissed ? <span>{labels.reminderDismissed}</span> : <button type="button" onClick={() => { void dismiss(view); }} className="text-[var(--c-text-secondary)]">{labels.dismissReminder}</button>}
            </div>}
            {!forbidden && view.presentation?.protocolUnavailable && <p className="mt-2 text-xs text-[var(--c-text-muted)]">{labels.attentionUnavailable}</p>}
            {!forbidden && view.presentation?.reasons?.some(reason => reason.severity !== 'blocking' && (reason.severity !== 'info' || !view.attentionState?.dismissed)) && <ul className="mt-2 space-y-1 text-xs text-[var(--c-text-secondary)]" data-testid="activity-attention-reasons">
              {view.presentation.reasons.filter(reason => reason.severity !== 'blocking' && (reason.severity !== 'info' || !view.attentionState?.dismissed)).map(reason => <li key={reason.code}>{labels.attentionReasons[reason.code]}</li>)}
            </ul>}
            {preview(projection.summary) && <WorkSummary summary={projection.summary!} label={labels.summaryDetails} />}
            <p className="mt-2 text-xs text-[var(--c-text-secondary)]" data-testid="activity-last-report">{report ? labels.report(labels.states[report.projection.executionState], ago(report.at)) : labels.noReport}</p>
            {projection.errorCode === 'activity_history_gap' && <p className="mt-2 text-xs text-[var(--c-text-muted)]">{labels.historyGap}</p>}
            {watch.source === 'mcp' && !forbidden && !stopped && !terminal && <McpWorkControls watchId={watch.watchId} needsInput={projection.executionState === 'input_required'} revision={projection.revision} />}
            {view.questionSourceKind==='codex_native_approval'&&!forbidden&&!stopped&&native&&<NativeWorkControls forms={nativeForms} states={answerStates.current} error={native.error} onAnswer={(form,choice)=>{void answerNative(watch.watchId,form,choice);}} onRefresh={()=>{void loadRef.current?.();}}/>}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--c-text-muted)]">
              <span>{labels.lastUpdate}: {time(projection.lastHeartbeatAt ?? projection.lastProgressAt)}</span>
              <span>{labels.lastProgress}: {time(projection.lastProgressAt)}</span>
              {!stopped && !terminal && watch.preference === 'normal' && <span>{labels.nextReport}: {time(watch.nextReportDueAt)}</span>}
            </div>
            {!stopped && <div className="mt-2 flex flex-wrap items-center gap-3">
              <select aria-label={labels.frequency} value={watch.preference} onChange={event => { void update(view, event.target.value as ReportingPreference); }} className="min-w-0 max-w-full rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-xs">
                <option value="normal">{labels.normal}</option>
                <option value="critical_only">{labels.criticalOnly}</option>
                <option value="quiet">{labels.quiet}</option>
              </select>
              <button type="button" title={labels.stopHint} onClick={() => { void update(view); }} className="text-xs text-[var(--c-text-secondary)]">{labels.stop}</button>
            </div>}
          </article>
        );
      })}</div>}
      {error && <p role="status" className="text-xs text-[var(--c-text-muted)]">{error === 'owner' ? labels.ownerUnavailable : labels.error}</p>}
    </section>
  );
}
