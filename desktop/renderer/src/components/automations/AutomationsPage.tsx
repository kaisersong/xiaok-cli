import { useAutomationOverview } from '../../hooks/useAutomationOverview';
import { AUTOMATION_CONFIG_SCHEMA } from '../../../../shared/automation-config-ipc-contract';
import {scheduledErrorMessage} from '../../lib/scheduled-timed-action-error';
import { loopManagementErrorMessage, loopManagementFailureKind } from '../../lib/loop-management-errors';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { ScheduledPage } from '../ScheduledPage';
import { LoopsPane } from '../DesktopSettings';
import { LoopConstraintsTab } from './LoopConstraintsTab';
import { DirectionAwareTabs, type DirectionAwareTab } from '../ui/direction-aware-tabs';
import { useLocale } from '../../contexts/LocaleContext';
import { api } from '../../api';
import { automationFailureRoute } from '../welcome-home-projection';

function formatRelativeTime(ts: number, t: Pick<import('../../locales').LocaleStrings, 'automationsRelativeJustNow' | 'automationsRelativeMinutesAgo' | 'automationsRelativeHoursAgo'>): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t.automationsRelativeJustNow;
  if (diff < 3600_000) return t.automationsRelativeMinutesAgo(Math.floor(diff / 60_000));
  if (diff < 86400_000) return t.automationsRelativeHoursAgo(Math.floor(diff / 3600_000));
  return new Date(ts).toLocaleDateString();
}

type AutomationsTab = 'overview' | 'schedules' | 'loops' | 'constraints' | 'diagnostics';

const TABS: Array<{ key: AutomationsTab; labelKey: 'automationsOverview' | 'automationsSchedules' | 'automationsLoops' | 'automationsConstraints' | 'automationsDiagnostics' }> = [
  { key: 'overview', labelKey: 'automationsOverview' },
  { key: 'schedules', labelKey: 'automationsSchedules' },
  { key: 'loops', labelKey: 'automationsLoops' },
  { key: 'constraints', labelKey: 'automationsConstraints' },
  { key: 'diagnostics', labelKey: 'automationsDiagnostics' },
];

function normalizeTab(value: string | undefined): AutomationsTab {
  if (value === 'schedules' || value === 'loops' || value === 'constraints' || value === 'diagnostics') return value;
  return 'overview';
}

export function AutomationsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { t } = useLocale();
  const activeTab = normalizeTab(tab);
  const { snapshot: overviewSnapshot, readFailed, reading, refresh, beginMutation, commitFlag } = useAutomationOverview();
  const globalBackgroundAutoRunEnabled = overviewSnapshot?.globalBackgroundAutoRunEnabled ?? null;
  const [savingGlobalAutoRun, setSavingGlobalAutoRun] = useState(false);
  const [mutationUnknown, setMutationUnknown] = useState(false);
  const [loopActionError, setLoopActionError] = useState('');
  const actionLife = useRef({ active: true, busy: false });
  useEffect(() => {
    const owner = { active: true, busy: false }; actionLife.current = owner;
    return () => { owner.active = false; };
  }, []);

  const openTab = (nextTab: AutomationsTab) => {
    navigate(nextTab === 'overview' ? '/automations' : `/automations/${nextTab}`);
  };

  const toggleGlobalAutoRun = async () => {
    const owner = actionLife.current;
    if (!owner.active || owner.busy || globalBackgroundAutoRunEnabled === null) return;
    owner.busy = true; setSavingGlobalAutoRun(true); beginMutation();
    try {
      const parsed = AUTOMATION_CONFIG_SCHEMA.safeParse(await api.setGlobalBackgroundAutoRun({ enabled: !globalBackgroundAutoRunEnabled }));
      if (!owner.active || actionLife.current !== owner) return;
      if (!parsed.success) throw Error('automation_config_operation_unknown');
      commitFlag(parsed.data.globalBackgroundAutoRunEnabled); setMutationUnknown(false);
    } catch {
      if (owner.active && actionLife.current === owner) setMutationUnknown(true);
    } finally {
      owner.busy = false;
      if (owner.active && actionLife.current === owner) setSavingGlobalAutoRun(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--c-bg-page)]" data-testid="automations-page">
      {readFailed && <p role="alert" className="px-8 py-3 text-sm text-[var(--c-error)]">{t.automationsReadFailed}</p>}
      {mutationUnknown && <p role="alert" className="px-8 py-3 text-sm text-[var(--c-error)]">{t.automationsMutationUnknown}</p>}
      {loopActionError && <p role="alert" className="px-8 py-3 text-sm text-[var(--c-error)]">{loopActionError}</p>}
      <header className="border-b border-[var(--c-border)] px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--c-text-primary)]">{t.automationsTitle}</h1>
            <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{t.automationsSubtitle}</p>
          </div>
        </div>
        <div className="mt-5">
          <DirectionAwareTabs
            ariaLabel={t.automationsTitle}
            tabs={TABS.map(item => ({ id: item.key, label: t[item.labelKey] })) as ReadonlyArray<DirectionAwareTab<AutomationsTab>>}
            activeId={activeTab}
            onChange={openTab}
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'overview' && (
          <div className="mx-auto max-w-[900px]">
            <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--c-text-primary)]">
                  {globalBackgroundAutoRunEnabled === null ? t.automationsStateUnknown : globalBackgroundAutoRunEnabled ? t.automationsGlobalAutoRunEnabled : t.automationsGlobalAutoRunDisabled}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{t.automationsGlobalAutoRunDesc}</p>
              </div>
              <button type="button" aria-busy={reading} onClick={() => refresh()} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm">{t.automationsReadRetry}</button>
              <button
                type="button"
                disabled={savingGlobalAutoRun || globalBackgroundAutoRunEnabled === null}
                onClick={toggleGlobalAutoRun}
                className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm text-[var(--c-text-primary)] transition-colors hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {globalBackgroundAutoRunEnabled ? t.automationsGlobalAutoRunPause : t.automationsGlobalAutoRunEnable}
              </button>
            </section>
            <section className="grid gap-4 md:grid-cols-3">
              <OverviewCard
                icon={<Clock size={18} />}
                title={t.automationsOverviewSchedulesCount}
                value={overviewSnapshot?.totals.schedules ?? null}
                body={t.automationsSchedulesDesc}
                onOpen={() => openTab('schedules')}
              />
              <OverviewCard
                icon={<RefreshCw size={18} />}
                title={t.automationsOverviewLoopsCount}
                value={overviewSnapshot?.totals.loops ?? null}
                body={t.automationsLoopsDesc}
                onOpen={() => openTab('loops')}
              />
              <OverviewCard
                icon={<AlertTriangle size={18} />}
                title={t.automationsOverviewFailuresCount}
                value={overviewSnapshot?.totals.recentFailures ?? null}
                body={t.automationsDiagnosticsDesc}
                onOpen={() => {
                  document.getElementById('automations-recent-failures')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
            </section>
            <section id="automations-recent-failures" className="mt-4 border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3">
              <h2 className="text-sm font-medium text-[var(--c-text-primary)]">{t.automationsOverviewRecentFailures}</h2>
              {overviewSnapshot && overviewSnapshot.recentFailures.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {overviewSnapshot.recentFailures.map(item => (
                    <div
                      key={item.id}
                      className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--c-text-primary)]">{item.title}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-[var(--c-text-tertiary)]">{formatRelativeTime(item.occurredAt, t)}</span>
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">{item.status}</span>
                        </div>
                      </div>
                      {item.message && (
                        <p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)] break-words whitespace-pre-wrap">{item.message}</p>
                      )}
                      <div className="mt-2 flex items-center gap-3">
                        {(item.source === 'loop_run' || item.actionAvailableInSchedules !== false) && (
                          <button
                            type="button"
                            onClick={() => navigate(automationFailureRoute(item))}
                            className="text-[10px] text-[var(--c-accent)] hover:underline"
                          >
                            {item.source === 'loop_run' ? `${t.automationsViewLoopDetail} →` : `${t.automationsViewScheduleDetail} →`}
                          </button>
                        )}
                        {item.source === 'loop_run' && item.loopId && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(t.automationsClearConfirm(item.title))) return;
                              try {
                                setLoopActionError('');
                                await api.clearLoopRunHistory(item.loopId!, ['failed', 'blocked']);
                                refresh();
                              } catch (e) {
                                console.error('[Automations] clear failures failed', e);
                                if (loopManagementFailureKind(e)) {
                                  setLoopActionError(loopManagementErrorMessage(e, t, t.loopOperationResultUnknown));
                                }
                              }
                            }}
                            className="text-[10px] text-[var(--c-text-tertiary)] hover:text-red-600 hover:underline"
                          >
                            {t.automationsClearRecord}
                          </button>
                        )}
                        {item.source === 'timed_action_run' && item.actionId && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(t.automationsClearConfirm(item.title))) return;
                              try {
                                await api.clearScheduledTaskRunHistory(item.actionId!, ['failed', 'failed_stale', 'pause', 'skip']);
                                refresh();
                              } catch (e) {
                                setLoopActionError(scheduledErrorMessage(e,t));
                              }
                            }}
                            className="text-[10px] text-[var(--c-text-tertiary)] hover:text-red-600 hover:underline"
                          >
                            {t.automationsClearRecord}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                overviewSnapshot && <p className="mt-2 text-xs leading-5 text-[var(--c-text-secondary)]">{t.automationsOverviewNoRecentFailures}</p>
              )}
            </section>
          </div>
        )}

        {activeTab === 'schedules' && (
          <div className="mx-auto max-w-[900px]">
            <ScheduledPage embedded />
          </div>
        )}

        {activeTab === 'loops' && (
          <div className="mx-auto max-w-[800px]">
            <LoopsPane sections="user" />
          </div>
        )}

        {activeTab === 'constraints' && (
          <div className="mx-auto max-w-[800px]">
            <LoopConstraintsTab />
          </div>
        )}

        {activeTab === 'diagnostics' && (
          <div className="mx-auto max-w-[800px]">
            <LoopsPane sections="diagnostics" />
          </div>
        )}
      </main>
    </div>
  );
}

function OverviewCard({
  icon,
  title,
  value,
  body,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  value: number | null;
  body: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 text-left transition-colors hover:bg-[var(--c-bg-deep)]"
    >
      <div className="mb-3 flex items-center gap-2 text-[var(--c-accent)]">
        {icon}
        <span className="text-sm font-medium text-[var(--c-text-primary)]">{title}</span>
      </div>
      <div className="text-2xl font-semibold text-[var(--c-text-primary)]">{value ?? '—'}</div>
      <p className="text-xs leading-5 text-[var(--c-text-secondary)]">{body}</p>
      <Activity size={14} className="mt-3 text-[var(--c-text-tertiary)]" />
    </button>
  );
}
