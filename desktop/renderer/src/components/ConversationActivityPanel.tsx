import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { McpWorkControls } from './McpWorkControls';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { WorkProjection, WorkWatch, ReportingPreference, ConversationActivity } from '../../../shared/conversation-activity-types.js';

/** The desktop main process reports a failed owner attach with one stable code; show fixed copy, never the code. */
const isOwnerUnavailable = (error: unknown) => error instanceof Error && error.message.includes('activity_owner_unavailable');

type WorkView = { watch: WorkWatch; projection: WorkProjection };

function preview(summary?: string): string {
  if (!summary || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(summary.trim())) return '';
  return (summary.replace(/^[#>\s]+/gm, '').replace(/\*\*|__|`/g, '').split('\n').find(line => line.trim()) ?? '').slice(0, 120);
}

function priority(view: WorkView): number {
  if (view.watch.status === 'stopped') return 0;
  if (view.projection.executionState === 'input_required') return 4;
  if (['blocked', 'failed'].includes(view.projection.executionState) || view.projection.businessOutcome === 'error') return 3;
  return ['completed', 'cancelled'].includes(view.projection.executionState) ? 1 : 2;
}

function WorkSummary({ summary, label }: { summary: string; label: string }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-2 text-[var(--c-text-secondary)]" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-xs"><span className="line-clamp-2 break-words">{preview(summary)}</span><span className="text-[var(--c-text-muted)]">{label}</span></summary>
    {open && <div className="mt-2 max-h-48 overflow-y-auto break-words text-sm"><MarkdownRenderer content={summary} disableLinkify /></div>}
  </details>;
}

/** A presentation of main-owned activity. No model turn or business polling lives here. */
export function ConversationActivityPanel({ threadId }: { threadId: string }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkView[]>([]);
  const [error, setError] = useState<false | 'generic' | 'owner'>(false);
  const [reports, setReports] = useState<ConversationActivity[]>([]);
  const [expanded, setExpanded] = useState(false);
  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const api = getDesktopApi();
    let live = true, revision = 0;
    setWorks([]); setReports([]); setExpanded(false); setError(false);
    if (!api?.getConversationActivities || !api?.getWorkActivity) return;
    const load = async () => {
      const request = ++revision;
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
        const views = await Promise.all(ids.map(id => api.getWorkActivity(id)));
        if (live && request === revision) {
          setWorks(views); setReports(activities.filter(item => item.kind === 'report')); setError(false);
          const throughLocalSeq = activities.at(-1)?.localSeq;
          if (throughLocalSeq !== undefined) void api.markConversationActivitiesRead?.({ threadId, throughLocalSeq }).catch(() => undefined);
        }
      } catch (cause) { if (live && request === revision) setError(isOwnerUnavailable(cause) ? 'owner' : 'generic'); }
    };
    loadRef.current = load;
    // Register before the initial read, so a fast completion cannot disappear.
    const stop = api.subscribeConversationActivities?.(threadId, () => { void load(); });
    void load();
    return () => { live = false; revision++; stop?.(); loadRef.current = undefined; };
  }, [threadId]);

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
  const needsInput = works.some(view => view.watch.source === 'mcp' && view.watch.status !== 'stopped'
    && view.projection.errorCode !== 'activity_source_forbidden' && view.projection.executionState === 'input_required');
  useEffect(() => { if (needsInput) setExpanded(true); }, [needsInput]);
  const labels = t.conversationActivity;
  if (!works.length) return error ? <p role="status" className="text-xs text-[var(--c-text-muted)]">{error === 'owner' ? labels.ownerUnavailable : labels.error}</p> : null;
  const ordered = [...works].sort((a, b) => priority(b) - priority(a)
    || (b.projection.lastProgressAt ?? b.projection.lastHeartbeatAt ?? 0) - (a.projection.lastProgressAt ?? a.projection.lastHeartbeatAt ?? 0));
  const latestReports = new Map(reports.map(item => [item.watchId, item]));
  const focused = ordered[0];
  const showDetails = expanded || needsInput;
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
          {focused.projection.freshness !== 'fresh' && <span className="shrink-0 text-[var(--c-text-muted)]">{labels.unavailable}</span>}
        </>}
        <span className="ml-auto shrink-0 text-[var(--c-text-muted)]">{labels.workCount(works.length)}</span>
        {showDetails ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {showDetails && <div data-testid="activity-details" className="max-h-64 space-y-2 overflow-y-auto overscroll-contain border-t border-[var(--c-border)] p-2">
      {ordered.map(view => {
        const { watch, projection } = view;
        const stopped = watch.status === 'stopped';
        const forbidden = projection.errorCode === 'activity_source_forbidden';
        const report = latestReports.get(watch.watchId);
        const terminal = ['completed', 'failed', 'cancelled'].includes(projection.executionState);
        return (
          <article key={watch.watchId} data-testid={`activity-work-${watch.watchId}`} className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--c-text-heading)]">{labels.sources[watch.source]}</span>
              <span className="text-xs text-[var(--c-accent)]">{state(view)}</span>
              {!forbidden && projection.freshness !== 'fresh' && <span className="text-xs text-[var(--c-text-muted)]">{labels.unavailable}</span>}
              {watch.source === 'kswarm' && <button type="button" className="ml-auto text-xs text-[var(--c-accent)]" onClick={() => navigate(`/projects/${encodeURIComponent(watch.workId)}`)}>{labels.details}</button>}
            </div>
            {preview(projection.summary) && <WorkSummary summary={projection.summary!} label={labels.summaryDetails} />}
            <p className="mt-2 text-xs text-[var(--c-text-secondary)]" data-testid="activity-last-report">{report ? labels.report(labels.states[report.projection.executionState], ago(report.at)) : labels.noReport}</p>
            {projection.errorCode === 'activity_history_gap' && <p className="mt-2 text-xs text-[var(--c-text-muted)]">{labels.historyGap}</p>}
            {watch.source === 'mcp' && !forbidden && !stopped && !terminal && <McpWorkControls watchId={watch.watchId} needsInput={projection.executionState === 'input_required'} revision={projection.revision} />}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--c-text-muted)]">
              <span>{labels.lastUpdate}: {time(projection.lastHeartbeatAt ?? projection.lastProgressAt)}</span>
              <span>{labels.lastProgress}: {time(projection.lastProgressAt)}</span>
              {!stopped && !terminal && watch.preference === 'normal' && <span>{labels.nextReport}: {time(watch.nextReportDueAt)}</span>}
            </div>
            {!stopped && <div className="mt-2 flex items-center gap-3">
              <select aria-label={labels.frequency} value={watch.preference} onChange={event => { void update(view, event.target.value as ReportingPreference); }} className="rounded border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-xs">
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
