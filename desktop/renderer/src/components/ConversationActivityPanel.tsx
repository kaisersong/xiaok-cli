import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { McpWorkControls } from './McpWorkControls';
import type { WorkProjection, WorkWatch, ReportingPreference, ConversationActivity } from '../../../shared/conversation-activity-types.js';

type WorkView = { watch: WorkWatch; projection: WorkProjection };

/** A presentation of main-owned activity. No model turn or business polling lives here. */
export function ConversationActivityPanel({ threadId }: { threadId: string }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkView[]>([]);
  const [error, setError] = useState(false);
  const [reports, setReports] = useState<ConversationActivity[]>([]);
  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const api = getDesktopApi();
    let live = true, revision = 0;
    setWorks([]); setReports([]); setError(false);
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
      } catch { if (live && request === revision) setError(true); }
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
    } catch { setError(true); }
  };
  const labels = t.conversationActivity;
  if (!works.length) return error ? <p role="status" className="text-xs text-[var(--c-text-muted)]">{labels.error}</p> : null;
  const latestReports = new Map(reports.map(item => [item.watchId, item]));
  const time = (value: number | null) => value === null ? labels.noProgress : new Date(value).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <section aria-label={labels.title} className="space-y-2" data-testid="conversation-activity">
      <div className="text-xs font-medium text-[var(--c-text-secondary)]">{labels.title}</div>
      {works.map(view => {
        const { watch, projection } = view;
        const stopped = watch.status === 'stopped';
        const forbidden = projection.errorCode === 'activity_source_forbidden';
        const terminal = ['completed', 'failed', 'cancelled'].includes(projection.executionState);
        const report = latestReports.get(watch.watchId);
        return (
          <article key={watch.watchId} data-testid={`activity-work-${watch.watchId}`} className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--c-text-heading)]">{labels.sources[watch.source]}</span>
              <span className="text-xs text-[var(--c-accent)]">{forbidden ? labels.unavailable : stopped ? labels.stopped : watch.source === 'kswarm' && projection.executionState === 'cancelled' ? labels.projectClosed : projection.businessOutcome === 'error' ? labels.states.failed : labels.states[projection.executionState]}</span>
              {!forbidden && projection.freshness !== 'fresh' && <span className="text-xs text-[var(--c-text-muted)]">{labels.unavailable}</span>}
              {watch.source === 'kswarm' && <button type="button" className="ml-auto text-xs text-[var(--c-accent)]" onClick={() => navigate(`/projects/${encodeURIComponent(watch.workId)}`)}>{labels.details}</button>}
            </div>
            {projection.summary && <p className="mt-2 whitespace-pre-wrap break-words text-[var(--c-text-secondary)]">{projection.summary}</p>}
            {projection.errorCode === 'activity_history_gap' && <p className="mt-2 text-xs text-[var(--c-text-muted)]">{labels.historyGap}</p>}
            {watch.source === 'mcp' && !forbidden && !stopped && !terminal && <McpWorkControls watchId={watch.watchId} needsInput={projection.executionState === 'input_required'} revision={projection.revision} />}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--c-text-muted)]">
              <span>{labels.lastUpdate}: {time(projection.lastHeartbeatAt ?? projection.lastProgressAt)}</span>
              <span>{labels.lastProgress}: {time(projection.lastProgressAt)}</span>
              {!stopped && !terminal && watch.preference === 'normal' && <span>{labels.nextReport}: {time(watch.nextReportDueAt)}</span>}
            </div>
            {report && <p className="mt-2 text-xs text-[var(--c-text-secondary)]">{labels.report(labels.states[report.projection.executionState], time(report.at))}</p>}
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
      })}
      {error && <p role="status" className="text-xs text-[var(--c-text-muted)]">{labels.error}</p>}
    </section>
  );
}
