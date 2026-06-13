import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { getDesktopApi, type DesktopSettingsKey } from '../../shared/desktop'
import { useToast } from '../../shared'
import { useLocale } from '../../contexts/LocaleContext'
import {
  api,
  type EvidenceAnomalyView,
  type LoopDefinitionView,
  type LoopRunView,
  type RunLoopNowResultView,
} from '../../api'
import { readDeveloperShowRunEvents, writeDeveloperShowRunEvents, readDeveloperShowDebugPanel, writeDeveloperShowDebugPanel, readDeveloperPipelineTraceEnabled, writeDeveloperPipelineTraceEnabled, readDeveloperPromptCacheDebugEnabled, writeDeveloperPromptCacheDebugEnabled } from '../../storage'
import { RunsSettings } from './RunsSettings'
import { secondaryButtonBorderStyle, secondaryButtonSmCls } from '../buttonStyles'

type Props = {
  accessToken?: string
  onNavigate?: (key: DesktopSettingsKey) => void
}

type PanelBtnProps = {
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  children: ReactNode
}

function PanelButton({ onClick, disabled, ariaLabel, children }: PanelBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={secondaryButtonSmCls}
      style={secondaryButtonBorderStyle}
    >
      {children}
    </button>
  )
}

function PillToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border-subtle)]',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  )
}

type AccountSettingsSnapshot = {
  pipeline_trace_enabled?: boolean
  prompt_cache_debug_enabled?: boolean
}

function getOpenAnomalyCount(anomalies: EvidenceAnomalyView[]): number {
  return anomalies.filter(anomaly => anomaly.status === 'open').length
}

function getRunStatusLabel(status: LoopRunView['status']): string {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'blocked') return 'blocked'
  return 'running'
}

function formatLoopRunTime(run: LoopRunView): string {
  const ts = run.finishedAt ?? run.updatedAt ?? run.startedAt
  return new Date(ts).toLocaleString()
}

export function DeveloperSettings({ accessToken, onNavigate }: Props) {
  const { t } = useLocale()
  const toast = useToast() as {
    addToast?: (message: string, type?: 'success' | 'error') => void
    show?: (message: string, type?: 'success' | 'error') => void
  }
  const ds = t.desktopSettings
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    if (toast.addToast) toast.addToast(message, type)
    else toast.show?.(message, type)
  }, [toast])
  const [appVersion, setAppVersion] = useState('')
  const [resetDone, setResetDone] = useState(false)
  const [showRunEvents, setShowRunEvents] = useState(() => readDeveloperShowRunEvents())
  const [showDebugPanel, setShowDebugPanel] = useState(() => readDeveloperShowDebugPanel())
  const [pipelineTraceEnabled, setPipelineTraceEnabled] = useState(() => readDeveloperPipelineTraceEnabled())
  const [pipelineTraceLoading, setPipelineTraceLoading] = useState(() => !!accessToken)
  const [pipelineTraceSaving, setPipelineTraceSaving] = useState(false)
  const [promptCacheDebugEnabled, setPromptCacheDebugEnabled] = useState(() => readDeveloperPromptCacheDebugEnabled())
  const [promptCacheDebugLoading, setPromptCacheDebugLoading] = useState(() => !!accessToken)
  const [promptCacheDebugSaving, setPromptCacheDebugSaving] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const [loopDefinitions, setLoopDefinitions] = useState<LoopDefinitionView[]>([])
  const [loopRuns, setLoopRuns] = useState<Record<string, LoopRunView[]>>({})
  const [loopAnomalies, setLoopAnomalies] = useState<Record<string, EvidenceAnomalyView[]>>({})
  const [loopRunResults, setLoopRunResults] = useState<Record<string, RunLoopNowResultView | undefined>>({})
  const [loopDiagnosticsLoading, setLoopDiagnosticsLoading] = useState(false)
  const [loopDiagnosticsError, setLoopDiagnosticsError] = useState('')
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null)

  useEffect(() => {
    const api = getDesktopApi()
    if (api) {
      api.app.getVersion().then(setAppVersion).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!accessToken) {
      setPipelineTraceEnabled(false)
      setPipelineTraceLoading(false)
      setPromptCacheDebugEnabled(false)
      setPromptCacheDebugLoading(false)
      return
    }

    let cancelled = false
    setPipelineTraceLoading(true)
    setPromptCacheDebugLoading(true)
    void api.getAccountSettings()
      .then((settings) => {
        if (cancelled) return
        const snapshot = settings as AccountSettingsSnapshot
        setPipelineTraceEnabled(!!snapshot.pipeline_trace_enabled)
        writeDeveloperPipelineTraceEnabled(!!snapshot.pipeline_trace_enabled)
        setPromptCacheDebugEnabled(!!snapshot.prompt_cache_debug_enabled)
        writeDeveloperPromptCacheDebugEnabled(!!snapshot.prompt_cache_debug_enabled)
      })
      .catch((error) => {
        if (cancelled) return
        showToast(error instanceof Error ? error.message : t.requestFailed, 'error')
      })
      .finally(() => {
        if (!cancelled) {
          setPipelineTraceLoading(false)
          setPromptCacheDebugLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, t.requestFailed])

  const loadLoopDiagnostics = useCallback(async (silent = false) => {
    if (!silent) setLoopDiagnosticsLoading(true)
    setLoopDiagnosticsError('')
    try {
      const definitions = await api.getLoopDefinitions()
      const details = await Promise.all(definitions.map(async (loop) => {
        const [runs, anomalies] = await Promise.all([
          api.getLoopRuns(loop.id),
          api.getEvidenceAnomalies(loop.id).catch(() => [] as EvidenceAnomalyView[]),
        ])
        return { loop, runs, anomalies }
      }))
      setLoopDefinitions(definitions)
      setLoopRuns(Object.fromEntries(details.map(item => [item.loop.id, item.runs])))
      setLoopAnomalies(Object.fromEntries(details.map(item => [item.loop.id, item.anomalies])))
    } catch (error) {
      setLoopDiagnosticsError(error instanceof Error ? error.message : ds.loopDiagnosticsLoadError)
    } finally {
      if (!silent) setLoopDiagnosticsLoading(false)
    }
  }, [ds.loopDiagnosticsLoadError])

  useEffect(() => {
    void loadLoopDiagnostics()
  }, [loadLoopDiagnostics])

  const handleResetOnboarding = async () => {
    const api = getDesktopApi()
    if (!api) return
    try {
      const config = await api.config.get()
      await api.config.set({ ...config, onboarding_completed: false })
      setResetDone(true)
      setTimeout(() => setResetDone(false), 3000)
    } catch {
      /* ignore */
    }
  }

  const handlePipelineTraceChange = async (next: boolean) => {
    if (!accessToken || pipelineTraceSaving) return

    const previous = pipelineTraceEnabled
    setPipelineTraceEnabled(next)
    setPipelineTraceSaving(true)
    try {
      const settings = await api.updateAccountSettings({
        pipeline_trace_enabled: next,
      }) as AccountSettingsSnapshot
      setPipelineTraceEnabled(!!settings.pipeline_trace_enabled)
      writeDeveloperPipelineTraceEnabled(!!settings.pipeline_trace_enabled)
    } catch (error) {
      setPipelineTraceEnabled(previous)
      showToast(error instanceof Error ? error.message : t.requestFailed, 'error')
    } finally {
      setPipelineTraceSaving(false)
    }
  }

  const handlePromptCacheDebugChange = async (next: boolean) => {
    if (!accessToken || promptCacheDebugSaving) return

    const previous = promptCacheDebugEnabled
    setPromptCacheDebugEnabled(next)
    setPromptCacheDebugSaving(true)
    try {
      const settings = await api.updateAccountSettings({
        prompt_cache_debug_enabled: next,
      }) as AccountSettingsSnapshot
      setPromptCacheDebugEnabled(!!settings.prompt_cache_debug_enabled)
      writeDeveloperPromptCacheDebugEnabled(!!settings.prompt_cache_debug_enabled)
    } catch (error) {
      setPromptCacheDebugEnabled(previous)
      showToast(error instanceof Error ? error.message : t.requestFailed, 'error')
    } finally {
      setPromptCacheDebugSaving(false)
    }
  }

  const handleRunLoopNow = async (loopId: string) => {
    if (runningLoopId) return
    setRunningLoopId(loopId)
    setLoopDiagnosticsError('')
    try {
      const result = await api.runLoopNow(loopId)
      setLoopRunResults(prev => ({ ...prev, [loopId]: result }))
      await loadLoopDiagnostics(true)
    } catch (error) {
      setLoopDiagnosticsError(error instanceof Error ? error.message : ds.loopDiagnosticsRunFailed)
    } finally {
      setRunningLoopId(null)
    }
  }

  if (runsOpen && accessToken) {
    return (
      <div className="flex flex-col gap-5">
        <button type="button"
          onClick={() => setRunsOpen(false)}
          className="flex items-center gap-1 self-start text-sm text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] transition-colors"
        >
          <ChevronLeft size={15} />
          {ds.developerTitle}
        </button>
        <RunsSettings accessToken={accessToken} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-[var(--c-text-heading)]">
          {ds.developerTitle}
        </h3>
        <p className="mt-1 text-sm text-[var(--c-text-secondary)]">
          {ds.developerDesc}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div
          className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.pipelineTrace}
            </div>
            <div className="text-xs text-[var(--c-text-muted)]">
              {ds.pipelineTraceDesc}
            </div>
          </div>
          <PillToggle
            checked={pipelineTraceEnabled}
            disabled={!accessToken || pipelineTraceLoading || pipelineTraceSaving}
            onChange={(next) => {
              void handlePipelineTraceChange(next)
            }}
          />
        </div>

        <div
          className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.promptCacheDebug}
            </div>
            <div className="text-xs text-[var(--c-text-muted)]">
              {ds.promptCacheDebugDesc}
            </div>
          </div>
          <PillToggle
            checked={promptCacheDebugEnabled}
            disabled={!accessToken || promptCacheDebugLoading || promptCacheDebugSaving}
            onChange={(next) => {
              void handlePromptCacheDebugChange(next)
            }}
          />
        </div>

        {/* Show run events toggle */}
        <div
          className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.showRunEvents}
            </div>
            <div className="text-xs text-[var(--c-text-muted)]">
              {ds.showRunEventsDesc}
            </div>
          </div>
          <PillToggle
            checked={showRunEvents}
            onChange={(next) => {
              setShowRunEvents(next)
              writeDeveloperShowRunEvents(next)
            }}
          />
        </div>

        {/* Debug panel toggle */}
        <div
          className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.showDebugPanel}
            </div>
            <div className="text-xs text-[var(--c-text-muted)]">
              {ds.showDebugPanelDesc}
            </div>
          </div>
          <PillToggle
            checked={showDebugPanel}
            onChange={(next) => {
              setShowDebugPanel(next)
              writeDeveloperShowDebugPanel(next)
            }}
          />
        </div>

        {/* Run history */}
        <div
          className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.runsHistory}
            </div>
            <div className="text-xs text-[var(--c-text-muted)]">
              {ds.runsHistoryDesc}
            </div>
          </div>
          <PanelButton
            onClick={() => setRunsOpen(true)}
            disabled={!accessToken}
          >
            {ds.runsHistoryOpen}
          </PanelButton>
        </div>

        {/* Loop diagnostics */}
        <div
          className="rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-[var(--c-text-primary)]">
                {ds.loopDiagnostics}
              </div>
              <div className="text-xs text-[var(--c-text-muted)]">
                {ds.loopDiagnosticsDesc}
              </div>
            </div>
            <PanelButton
              onClick={() => void loadLoopDiagnostics()}
              disabled={loopDiagnosticsLoading}
            >
              <RefreshCw size={14} className={loopDiagnosticsLoading ? 'animate-spin' : ''} />
              {ds.loopDiagnosticsRefresh}
            </PanelButton>
          </div>

          {loopDiagnosticsError && (
            <div className="mt-3 rounded-lg bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text,#b91c1c)]">
              {loopDiagnosticsError}
            </div>
          )}

          {loopDiagnosticsLoading && loopDefinitions.length === 0 ? (
            <div className="mt-3 text-xs text-[var(--c-text-muted)]">
              {ds.loopDiagnosticsLoading}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {loopDefinitions.map((loop) => {
                const runs = loopRuns[loop.id] ?? []
                const latestRun = runs[0]
                const openAnomalyCount = getOpenAnomalyCount(loopAnomalies[loop.id] ?? [])
                const runResult = loopRunResults[loop.id]
                const isRunning = runningLoopId === loop.id
                const isAlreadyRunning = !!loop.activeRunId || runResult?.status === 'already_running'
                const buttonLabel = isRunning
                  ? ds.loopDiagnosticsRunning
                  : isAlreadyRunning
                    ? ds.loopDiagnosticsAlreadyRunning
                    : ds.loopDiagnosticsRunNow

                return (
                  <div
                    key={loop.id}
                    className="rounded-lg bg-[var(--c-bg-card)] px-3 py-3"
                    style={{ border: '0.5px solid var(--c-border-subtle)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--c-text-primary)]">
                          {loop.title}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--c-text-muted)]">
                          {loop.description}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--c-bg-menu)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                        {loop.status}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-[var(--c-bg-menu)] px-2 py-2">
                        <div className="text-[var(--c-text-muted)]">{ds.loopDiagnosticsLastRun}</div>
                        <div className="mt-1 text-[var(--c-text-primary)]">
                          {latestRun
                            ? `${getRunStatusLabel(latestRun.status)} · ${formatLoopRunTime(latestRun)}`
                            : ds.loopDiagnosticsNoRuns}
                        </div>
                      </div>
                      <div className="rounded-md bg-[var(--c-bg-menu)] px-2 py-2">
                        <div className="text-[var(--c-text-muted)]">{ds.loopDiagnosticsOpenAnomalies}</div>
                        <div className="mt-1 font-medium text-[var(--c-text-primary)]">
                          {openAnomalyCount}
                        </div>
                      </div>
                    </div>

                    {latestRun?.message && (
                      <div className="mt-2 rounded-md bg-[var(--c-bg-menu)] px-2 py-2 text-xs text-[var(--c-text-secondary)]">
                        {latestRun.message}
                      </div>
                    )}

                    <div className="mt-3 flex justify-end">
                      <PanelButton
                        onClick={() => void handleRunLoopNow(loop.id)}
                        disabled={isRunning || isAlreadyRunning || loop.status !== 'active'}
                        ariaLabel={`run-loop-${loop.id}`}
                      >
                        <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
                        <span>{buttonLabel}</span>
                      </PanelButton>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Design Tokens */}
        {onNavigate && (
          <div
            className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
            style={{ border: '0.5px solid var(--c-border-subtle)' }}
          >
            <div>
              <div className="text-sm font-medium text-[var(--c-text-primary)]">
                Design Tokens
              </div>
              <div className="text-xs text-[var(--c-text-muted)]">
                All CSS variables resolved for the current theme.
              </div>
            </div>
            <PanelButton onClick={() => onNavigate('design-tokens')}>
              查看
            </PanelButton>
          </div>
        )}

        {/* Reset onboarding */}
        <div
          className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
          style={{ border: '0.5px solid var(--c-border-subtle)' }}
        >
          <div>
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.resetOnboarding}
            </div>
            <div className="text-xs text-[var(--c-text-muted)]">
              {ds.resetOnboardingDesc}
            </div>
          </div>
          <PanelButton onClick={handleResetOnboarding}>
            {resetDone ? '✓' : ds.resetOnboardingBtn}
          </PanelButton>
        </div>

        {/* App version */}
        {appVersion && (
          <div
            className="flex items-center justify-between rounded-xl bg-[var(--c-bg-menu)] px-4 py-3"
            style={{ border: '0.5px solid var(--c-border-subtle)' }}
          >
            <div className="text-sm font-medium text-[var(--c-text-primary)]">
              {ds.appVersion}
            </div>
            <span className="text-sm text-[var(--c-text-muted)]">
              {appVersion}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
