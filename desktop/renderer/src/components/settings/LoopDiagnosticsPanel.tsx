import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, RefreshCw } from 'lucide-react';
import { api, type EvidenceAnomalyView, type LoopDefinitionView, type LoopRunView, type RunLoopNowResultView } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { useToast } from '../../shared';
import {
  buildLoopDiagnosticsSummary,
  getLoopAnomalyLogPaths,
  getLoopAnomalySuggestedAction,
  getOpenLoopAnomalies,
} from './loopDiagnostics';

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-[var(--c-border)] px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

function getOpenLoopAnomalyCount(anomalies: EvidenceAnomalyView[]): number {
  return getOpenLoopAnomalies(anomalies).length;
}

function getLoopRunStatusLabel(status: LoopRunView['status']): string {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  return 'running';
}

function formatLoopRunTime(run: LoopRunView): string {
  const ts = run.finishedAt ?? run.updatedAt ?? run.startedAt;
  return new Date(ts).toLocaleString();
}

export function LoopDiagnosticsPanel() {
  const { t } = useLocale();
  const toast = useToast() as {
    addToast?: (message: string, type?: 'success' | 'error') => void;
    show?: (message: string, type?: 'success' | 'error') => void;
  };
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    if (toast.addToast) toast.addToast(message, type);
    else toast.show?.(message, type);
  }, [toast]);
  const [loopDefinitions, setLoopDefinitions] = useState<LoopDefinitionView[]>([]);
  const [loopRuns, setLoopRuns] = useState<Record<string, LoopRunView[]>>({});
  const [loopAnomalies, setLoopAnomalies] = useState<Record<string, EvidenceAnomalyView[]>>({});
  const [loopRunResults, setLoopRunResults] = useState<Record<string, RunLoopNowResultView | undefined>>({});
  const [loopDiagnosticsLoading, setLoopDiagnosticsLoading] = useState(true);
  const [loopDiagnosticsError, setLoopDiagnosticsError] = useState('');
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null);

  const loadLoopDiagnostics = useCallback(async (silent = false) => {
    if (!silent) setLoopDiagnosticsLoading(true);
    setLoopDiagnosticsError('');
    try {
      const definitions = await api.getLoopDefinitions();
      const details = await Promise.all(definitions.map(async (loop) => {
        const [runs, anomalies] = await Promise.all([
          api.getLoopRuns(loop.id),
          api.getEvidenceAnomalies(loop.id).catch(() => [] as EvidenceAnomalyView[]),
        ]);
        return { loop, runs, anomalies };
      }));
      setLoopDefinitions(definitions);
      setLoopRuns(Object.fromEntries(details.map(item => [item.loop.id, item.runs])));
      setLoopAnomalies(Object.fromEntries(details.map(item => [item.loop.id, item.anomalies])));
      setLoopRunResults(prev => {
        const next = { ...prev };
        for (const loop of definitions) {
          if (!loop.activeRunId && next[loop.id]?.status === 'already_running') {
            delete next[loop.id];
          }
        }
        return next;
      });
    } catch (error) {
      setLoopDiagnosticsError(error instanceof Error ? error.message : t.desktopSettings.loopDiagnosticsLoadError);
    } finally {
      if (!silent) setLoopDiagnosticsLoading(false);
    }
  }, [t.desktopSettings.loopDiagnosticsLoadError]);

  useEffect(() => {
    void loadLoopDiagnostics();
  }, [loadLoopDiagnostics]);

  const handleRunLoopNow = async (loopId: string) => {
    if (runningLoopId) return;
    setRunningLoopId(loopId);
    setLoopDiagnosticsError('');
    try {
      const result = await api.runLoopNow(loopId);
      setLoopRunResults(prev => ({ ...prev, [loopId]: result }));
      if (result.status !== 'already_running') {
        await loadLoopDiagnostics(true);
      }
    } catch (error) {
      setLoopDiagnosticsError(error instanceof Error ? error.message : t.desktopSettings.loopDiagnosticsRunFailed);
    } finally {
      setRunningLoopId(null);
    }
  };

  const handleCopyLoopDiagnostics = async (
    loop: LoopDefinitionView,
    runs: LoopRunView[],
    anomalies: EvidenceAnomalyView[],
  ) => {
    try {
      const summary = buildLoopDiagnosticsSummary({ loop, runs, anomalies });
      await navigator.clipboard.writeText(summary);
      showToast(t.desktopSettings.loopDiagnosticsCopied, 'success');
    } catch {
      showToast(t.desktopSettings.loopDiagnosticsCopyFailed, 'error');
    }
  };

  return (
    <section className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--c-text-primary)]">
            {t.desktopSettings.loopDiagnostics}
          </h3>
          <p className="mt-1 text-xs text-[var(--c-text-secondary)]">
            {t.desktopSettings.loopDiagnosticsDesc}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLoopDiagnostics()}
          disabled={loopDiagnosticsLoading}
          className={secondaryButton}
        >
          <RefreshCw size={14} className={loopDiagnosticsLoading ? 'animate-spin' : ''} />
          {t.desktopSettings.loopDiagnosticsRefresh}
        </button>
      </div>

      {loopDiagnosticsError ? (
        <div className="mb-3 rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
          {loopDiagnosticsError}
        </div>
      ) : null}

      {loopDiagnosticsLoading && loopDefinitions.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
          <Loader2 size={14} className="animate-spin" />
          {t.desktopSettings.loopDiagnosticsLoading}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {loopDefinitions.map(loop => {
            const runs = loopRuns[loop.id] ?? [];
            const latestRun = runs[0];
            const anomalies = loopAnomalies[loop.id] ?? [];
            const openAnomalies = getOpenLoopAnomalies(anomalies);
            const visibleAnomalies = openAnomalies.slice(0, 3);
            const openAnomalyCount = getOpenLoopAnomalyCount(anomalies);
            const runResult = loopRunResults[loop.id];
            const isRunning = runningLoopId === loop.id;
            const isAlreadyRunning = !!loop.activeRunId || runResult?.status === 'already_running';
            const buttonLabel = isRunning
              ? t.desktopSettings.loopDiagnosticsRunning
              : isAlreadyRunning
                ? t.desktopSettings.loopDiagnosticsAlreadyRunning
                : t.desktopSettings.loopDiagnosticsRunNow;

            return (
              <div
                key={loop.id}
                className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--c-text-heading)]">
                      {loop.title}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--c-text-secondary)]">
                      {loop.description}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                    {loop.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-[var(--c-bg-card)] p-2">
                    <div className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsLastRun}</div>
                    <div className="mt-1 text-[var(--c-text-primary)]">
                      {latestRun
                        ? `${getLoopRunStatusLabel(latestRun.status)} · ${formatLoopRunTime(latestRun)}`
                        : t.desktopSettings.loopDiagnosticsNoRuns}
                    </div>
                  </div>
                  <div className="rounded-md bg-[var(--c-bg-card)] p-2">
                    <div className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsOpenAnomalies}</div>
                    <div className="mt-1 font-medium text-[var(--c-text-primary)]">
                      {openAnomalyCount}
                    </div>
                  </div>
                </div>

                {latestRun?.message ? (
                  <div className="mt-2 rounded-md bg-[var(--c-bg-card)] p-2 text-xs text-[var(--c-text-secondary)]">
                    {latestRun.message}
                  </div>
                ) : null}

                {visibleAnomalies.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-2">
                    {visibleAnomalies.map(anomaly => {
                      const suggestedAction = getLoopAnomalySuggestedAction(anomaly);
                      const logPaths = getLoopAnomalyLogPaths(anomaly);
                      return (
                        <div
                          key={anomaly.id}
                          className="rounded-md bg-[var(--c-bg-card)] p-2 text-xs text-[var(--c-text-secondary)]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-[var(--c-text-primary)]">
                                {anomaly.message}
                              </div>
                              <div className="mt-0.5 break-all text-[var(--c-text-tertiary)]">
                                {anomaly.kind} · {anomaly.ownerKind}/{anomaly.ownerId}
                              </div>
                            </div>
                            <span className="shrink-0 text-[11px] text-[var(--c-text-tertiary)]">
                              {anomaly.seenCount}x
                            </span>
                          </div>
                          {suggestedAction ? (
                            <div className="mt-1">
                              <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsSuggestedAction}: </span>
                              {suggestedAction}
                            </div>
                          ) : null}
                          {logPaths.map(logPath => (
                            <div key={logPath} className="mt-1 break-all">
                              <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsLogPath}: </span>
                              {logPath}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    aria-label={`copy-loop-diagnostics-${loop.id}`}
                    onClick={() => void handleCopyLoopDiagnostics(loop, runs, anomalies)}
                    className={secondaryButton}
                  >
                    <Copy size={14} />
                    {t.desktopSettings.loopDiagnosticsCopy}
                  </button>
                  <button
                    type="button"
                    aria-label={`run-loop-${loop.id}`}
                    onClick={() => void handleRunLoopNow(loop.id)}
                    disabled={isRunning || isAlreadyRunning || loop.status !== 'active'}
                    className={secondaryButton}
                  >
                    <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
                    {buttonLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
