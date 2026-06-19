import { useEffect, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { ScheduledPage } from '../ScheduledPage';
import { LoopsPane } from '../DesktopSettings';
import { DirectionAwareTabs, type DirectionAwareTab } from '../ui/direction-aware-tabs';
import { useLocale } from '../../contexts/LocaleContext';
import { api } from '../../api';
import type { AutomationOverviewSnapshotView } from '../../api/types';

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return new Date(ts).toLocaleDateString();
}

type AutomationsTab = 'overview' | 'schedules' | 'loops' | 'diagnostics';

const TABS: Array<{ key: AutomationsTab; labelKey: 'automationsOverview' | 'automationsSchedules' | 'automationsLoops' | 'automationsDiagnostics' }> = [
  { key: 'overview', labelKey: 'automationsOverview' },
  { key: 'schedules', labelKey: 'automationsSchedules' },
  { key: 'loops', labelKey: 'automationsLoops' },
  { key: 'diagnostics', labelKey: 'automationsDiagnostics' },
];

function normalizeTab(value: string | undefined): AutomationsTab {
  if (value === 'schedules' || value === 'loops' || value === 'diagnostics') return value;
  return 'overview';
}

export function AutomationsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { t } = useLocale();
  const activeTab = normalizeTab(tab);
  const [globalBackgroundAutoRunEnabled, setGlobalBackgroundAutoRunEnabled] = useState(true);
  const [savingGlobalAutoRun, setSavingGlobalAutoRun] = useState(false);
  const [overviewSnapshot, setOverviewSnapshot] = useState<AutomationOverviewSnapshotView | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getAutomationOverviewSnapshot()
      .then(snapshot => {
        if (cancelled) return;
        setOverviewSnapshot(snapshot);
        setGlobalBackgroundAutoRunEnabled(snapshot.globalBackgroundAutoRunEnabled !== false);
      })
      .catch(() => {
        if (!cancelled) setOverviewSnapshot(emptyAutomationOverviewSnapshot(true));
      });
    api.getAutomationsConfig()
      .then(snapshot => {
        if (!cancelled) setGlobalBackgroundAutoRunEnabled(snapshot.globalBackgroundAutoRunEnabled !== false);
      })
      .catch(() => {
        if (!cancelled) setGlobalBackgroundAutoRunEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openTab = (nextTab: AutomationsTab) => {
    navigate(nextTab === 'overview' ? '/automations' : `/automations/${nextTab}`);
  };

  const toggleGlobalAutoRun = async () => {
    if (savingGlobalAutoRun) return;
    const nextEnabled = !globalBackgroundAutoRunEnabled;
    setSavingGlobalAutoRun(true);
    try {
      const snapshot = await api.setGlobalBackgroundAutoRun({ enabled: nextEnabled });
      setGlobalBackgroundAutoRunEnabled(snapshot.globalBackgroundAutoRunEnabled !== false);
      setOverviewSnapshot(current => current
        ? { ...current, globalBackgroundAutoRunEnabled: snapshot.globalBackgroundAutoRunEnabled !== false }
        : current);
    } finally {
      setSavingGlobalAutoRun(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--c-bg-page)]" data-testid="automations-page">
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
                  {globalBackgroundAutoRunEnabled ? t.automationsGlobalAutoRunEnabled : t.automationsGlobalAutoRunDisabled}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{t.automationsGlobalAutoRunDesc}</p>
              </div>
              <button
                type="button"
                disabled={savingGlobalAutoRun}
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
                value={overviewSnapshot?.totals.schedules ?? 0}
                body={t.automationsSchedulesDesc}
                onOpen={() => openTab('schedules')}
              />
              <OverviewCard
                icon={<RefreshCw size={18} />}
                title={t.automationsOverviewLoopsCount}
                value={overviewSnapshot?.totals.loops ?? 0}
                body={t.automationsLoopsDesc}
                onOpen={() => openTab('loops')}
              />
              <OverviewCard
                icon={<AlertTriangle size={18} />}
                title={t.automationsOverviewFailuresCount}
                value={overviewSnapshot?.totals.recentFailures ?? 0}
                body={t.automationsDiagnosticsDesc}
                onOpen={() => openTab('diagnostics')}
              />
            </section>
            <section className="mt-4 border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-3">
              <h2 className="text-sm font-medium text-[var(--c-text-primary)]">{t.automationsOverviewRecentFailures}</h2>
              {overviewSnapshot && overviewSnapshot.recentFailures.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {overviewSnapshot.recentFailures.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.source === 'loop_run' && item.loopId) {
                          navigate(`/automations/loops#loop-${item.loopId}`);
                        } else if (item.actionId) {
                          navigate(`/automations/schedules#task-${item.actionId}`);
                        } else {
                          openTab(item.source === 'loop_run' ? 'loops' : 'schedules');
                        }
                      }}
                      className="block w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-left hover:bg-[var(--c-bg-deep)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--c-text-primary)]">{item.title}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-[var(--c-text-tertiary)]">{formatRelativeTime(item.occurredAt)}</span>
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">{item.status}</span>
                        </div>
                      </div>
                      {item.message && (
                        <p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{item.message}</p>
                      )}
                      <p className="mt-1.5 text-[10px] text-[var(--c-accent)]">
                        {item.source === 'loop_run' ? '点击查看循环详情 →' : '点击查看定时任务 →'}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-[var(--c-text-secondary)]">{t.automationsOverviewNoRecentFailures}</p>
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
  value: number;
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
      <div className="text-2xl font-semibold text-[var(--c-text-primary)]">{value}</div>
      <p className="text-xs leading-5 text-[var(--c-text-secondary)]">{body}</p>
      <Activity size={14} className="mt-3 text-[var(--c-text-tertiary)]" />
    </button>
  );
}

function emptyAutomationOverviewSnapshot(globalBackgroundAutoRunEnabled: boolean): AutomationOverviewSnapshotView {
  return {
    generatedAt: Date.now(),
    sourceVersions: {
      loopStore: 0,
      timedActionStore: 0,
    },
    globalBackgroundAutoRunEnabled,
    totals: {
      loops: 0,
      userLoops: 0,
      schedules: 0,
      activeSchedules: 0,
      diagnostics: 0,
      recentFailures: 0,
    },
    recentFailures: [],
  };
}
