import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, FolderOpen, Loader2, Play, Plus, RefreshCw, Timer, XCircle } from 'lucide-react';
import { api, type LoopRunView, type UserLoopTemplateInput, type UserLoopTemplateView } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { settingsInputCls, settingsLabelCls } from './_settingsClasses';
import { LoopDiagnosticsPanel } from './LoopDiagnosticsPanel';
import { ArtifactPreviewModal } from '../projects/ArtifactPreviewModal';
import type { KSwarmArtifact } from '../../hooks/useKSwarmClient';

const DEFAULT_DAILY_TRIGGER = { kind: 'daily', hour: 6, minute: 3 } as const;

const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-[var(--c-border)] px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

const primaryButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

type TemplateForm = {
  title: string;
  description: string;
  prompt: string;
  outputDirectory: string;
  outputFileName: string;
};

type LocalArtifactPreviewState = {
  artifact: KSwarmArtifact;
  content: string;
};

function createEmptyForm(defaultTitle: string): TemplateForm {
  return {
    title: defaultTitle,
    description: '',
    prompt: '',
    outputDirectory: '',
    outputFileName: 'loop-output.md',
  };
}

function latestRunFor(loopId: string, runsByLoopId: Record<string, LoopRunView[]>): LoopRunView | undefined {
  return runsByLoopId[loopId]?.[0];
}

function formatRunStatus(
  run: LoopRunView | undefined,
  labels: {
    statusSuccess: string;
    statusFailed: string;
    statusBlocked: string;
    statusRunning: string;
    statusNeverRun: string;
  },
): string {
  if (!run) return labels.statusNeverRun;
  if (run.status === 'success') return labels.statusSuccess;
  if (run.status === 'failed') return labels.statusFailed;
  if (run.status === 'blocked') return labels.statusBlocked;
  return labels.statusRunning;
}

function formatRunTime(run: LoopRunView | undefined, noRunsLabel: string): string {
  if (!run) return noRunsLabel;
  const timestamp = run.finishedAt ?? run.updatedAt ?? run.startedAt;
  return new Date(timestamp).toLocaleString();
}

function statusIcon(run: LoopRunView | undefined) {
  if (!run) return <AlertCircle size={14} className="text-[var(--c-text-tertiary)]" />;
  if (run.status === 'success') return <CheckCircle2 size={14} className="text-[var(--c-status-success-text)]" />;
  if (run.status === 'blocked') return <AlertCircle size={14} className="text-[var(--c-status-warning-text)]" />;
  if (run.status === 'failed') return <XCircle size={14} className="text-[var(--c-status-error-text)]" />;
  return <Loader2 size={14} className="animate-spin text-[var(--c-text-secondary)]" />;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toTemplateInput(template: UserLoopTemplateView, patch: Partial<UserLoopTemplateInput>): UserLoopTemplateInput & { loopId: string } {
  return {
    loopId: template.loopId,
    title: template.title,
    description: template.description,
    kind: template.kind,
    prompt: template.prompt,
    outputDirectory: template.outputDirectory,
    outputFileName: template.outputFileName,
    scheduleEnabled: template.scheduleEnabled,
    scheduleTrigger: template.scheduleTrigger,
    autoRunApproved: template.autoRunApproved,
    ...patch,
  };
}

export function LoopsSettings() {
  const { t, locale } = useLocale();
  const labels = t.desktopSettings.loopsSettings;
  const outputErrorSeparator = locale === 'zh' ? '：' : ': ';
  const [templates, setTemplates] = useState<UserLoopTemplateView[]>([]);
  const [runsByLoopId, setRunsByLoopId] = useState<Record<string, LoopRunView[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [outputActionErrors, setOutputActionErrors] = useState<Record<string, string>>({});
  const [previewingOutputPath, setPreviewingOutputPath] = useState<string | null>(null);
  const [localArtifactPreview, setLocalArtifactPreview] = useState<LocalArtifactPreviewState | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TemplateForm>(() => createEmptyForm(labels.defaultTitle));

  const loadTemplates = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const nextTemplates = await api.listUserLoopTemplates();
      const runEntries = await Promise.all(nextTemplates.map(async (template) => {
        const runs = await api.getLoopRuns(template.loopId).catch(() => [] as LoopRunView[]);
        return [template.loopId, runs] as const;
      }));
      setTemplates(nextTemplates);
      setRunsByLoopId(Object.fromEntries(runEntries));
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.loadError);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [labels.loadError]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const canCreate = useMemo(() => {
    return form.title.trim() && form.prompt.trim() && form.outputDirectory.trim() && form.outputFileName.trim();
  }, [form]);

  const handleCreate = async () => {
    if (!canCreate || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.createUserLoopTemplate({
        title: form.title.trim(),
        description: form.description.trim(),
        kind: 'markdown_file',
        prompt: form.prompt.trim(),
        outputDirectory: form.outputDirectory.trim(),
        outputFileName: form.outputFileName.trim(),
      });
      setForm(createEmptyForm(labels.defaultTitle));
      setShowCreate(false);
      await loadTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.createError);
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async (loopId: string) => {
    if (runningLoopId) return;
    setRunningLoopId(loopId);
    setError('');
    try {
      await api.runLoopNow(loopId);
      await loadTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.runError);
    } finally {
      setRunningLoopId(null);
    }
  };

  const handleEnableSchedule = async (template: UserLoopTemplateView) => {
    setSaving(true);
    setError('');
    try {
      await api.updateUserLoopTemplate(toTemplateInput(template, {
        scheduleEnabled: true,
        scheduleTrigger: template.scheduleTrigger ?? DEFAULT_DAILY_TRIGGER,
      }));
      await loadTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.enableScheduleError);
    } finally {
      setSaving(false);
    }
  };

  const handleDisableSchedule = async (template: UserLoopTemplateView) => {
    setSaving(true);
    setError('');
    try {
      await api.updateUserLoopTemplate(toTemplateInput(template, {
        scheduleEnabled: false,
        scheduleTrigger: template.scheduleTrigger ?? DEFAULT_DAILY_TRIGGER,
        autoRunApproved: false,
      }));
      await loadTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.disableScheduleError);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAutoRun = async (template: UserLoopTemplateView) => {
    setSaving(true);
    setError('');
    try {
      await api.setUserLoopAutoRunApproved(template.loopId, !template.autoRunApproved);
      await loadTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.updateAutoRunError);
    } finally {
      setSaving(false);
    }
  };

  const clearOutputActionError = (loopId: string) => {
    setOutputActionErrors(prev => {
      if (!prev[loopId]) return prev;
      const next = { ...prev };
      delete next[loopId];
      return next;
    });
  };

  const setOutputActionError = (loopId: string, message: string) => {
    setOutputActionErrors(prev => ({ ...prev, [loopId]: message }));
  };

  const handleOpenOutputDirectory = async (template: UserLoopTemplateView) => {
    clearOutputActionError(template.loopId);
    try {
      const result = await api.openLocalPath(template.outputDirectory);
      if (!result.ok) {
        throw new Error(result.error || labels.outputDirectoryOpenFailed);
      }
    } catch (err) {
      setOutputActionError(template.loopId, `${labels.outputDirectoryOpenFailed}${outputErrorSeparator}${errorMessage(err)}`);
    }
  };

  const handlePreviewOutputFile = async (template: UserLoopTemplateView) => {
    clearOutputActionError(template.loopId);
    if (!template.outputPath) {
      setOutputActionError(template.loopId, `${labels.outputFilePreviewFailed}${outputErrorSeparator}${labels.outputFilePathMissing}`);
      return;
    }
    setPreviewingOutputPath(template.outputPath);
    try {
      const preview = await api.readLocalArtifactPreview(template.outputPath);
      setLocalArtifactPreview({
        artifact: {
          name: preview.fileName,
          filename: preview.fileName,
          path: preview.path,
          mimeType: preview.mimeType,
          size: preview.sizeBytes,
          updatedAt: preview.modifiedAt,
        },
        content: preview.content,
      });
    } catch (err) {
      setOutputActionError(template.loopId, `${labels.outputFilePreviewFailed}${outputErrorSeparator}${errorMessage(err)}`);
    } finally {
      setPreviewingOutputPath(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <LoopDiagnosticsPanel />

      <section className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--c-text-heading)]">{labels.userLoopsTitle}</h3>
            <div className="mt-1 text-sm text-[var(--c-text-secondary)]">
              {labels.userLoopCount(templates.length)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void loadTemplates()}
              disabled={loading}
              className={secondaryButton}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {labels.refreshUserLoops}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(value => !value)}
              className={primaryButton}
            >
              <Plus size={13} />
              {labels.newMarkdownLoop}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
            {error}
          </div>
        ) : null}

        {showCreate ? (
          <div className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={settingsLabelCls()}>{labels.titleLabel}</span>
                <input
                  aria-label={labels.loopTitleAriaLabel}
                  value={form.title}
                  onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                  className={settingsInputCls()}
                />
              </label>
              <label>
                <span className={settingsLabelCls()}>{labels.outputFileLabel}</span>
                <input
                  aria-label={labels.outputFileLabel}
                  value={form.outputFileName}
                  onChange={event => setForm(prev => ({ ...prev, outputFileName: event.target.value }))}
                  className={settingsInputCls()}
                />
              </label>
              <label className="col-span-2">
                <span className={settingsLabelCls()}>{labels.outputDirectoryLabel}</span>
                <input
                  aria-label={labels.outputDirectoryLabel}
                  value={form.outputDirectory}
                  onChange={event => setForm(prev => ({ ...prev, outputDirectory: event.target.value }))}
                  className={settingsInputCls()}
                />
              </label>
              <label className="col-span-2">
                <span className={settingsLabelCls()}>{labels.promptLabel}</span>
                <textarea
                  aria-label={labels.loopPromptAriaLabel}
                  value={form.prompt}
                  onChange={event => setForm(prev => ({ ...prev, prompt: event.target.value }))}
                  className={`${settingsInputCls()} min-h-[96px] resize-y`}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className={secondaryButton}>
                {labels.cancel}
              </button>
              <button type="button" onClick={() => void handleCreate()} disabled={!canCreate || saving} className={primaryButton}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {labels.create}
              </button>
            </div>
          </div>
        ) : null}

        {loading && templates.length === 0 ? (
          <div className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 text-sm text-[var(--c-text-secondary)]">
            {labels.loading}
          </div>
        ) : null}

        {!loading && templates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--c-border)] bg-[var(--c-bg-card)] p-5 text-sm text-[var(--c-text-secondary)]">
            {labels.empty}
          </div>
        ) : null}

        {templates.length > 0 ? (
          <div className="flex flex-col gap-3">
            {templates.map(template => {
              const latestRun = latestRunFor(template.loopId, runsByLoopId);
              const nextAction = latestRun?.nextActionKind || latestRun?.failureKind;
              const nextSummary = latestRun?.nextActionSummary || latestRun?.message || latestRun?.summary;
              const isRunning = runningLoopId === template.loopId || !!template.activeRunId || latestRun?.status === 'running';
              return (
                <div key={template.loopId} className="rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-[var(--c-text-heading)]">{template.title}</h4>
                        <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                          {template.status}
                        </span>
                      </div>
                      {template.description ? (
                        <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{template.description}</div>
                      ) : null}
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs">
                        {template.outputDirectory ? (
                          <button
                            type="button"
                            aria-label={labels.openOutputDirectoryAria(template.outputDirectory)}
                            title={labels.openOutputDirectoryAria(template.outputDirectory)}
                            onClick={() => void handleOpenOutputDirectory(template)}
                            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-[var(--c-text-tertiary)] transition-colors hover:border-[var(--c-border)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]"
                          >
                            <FolderOpen size={13} className="shrink-0" />
                            <span className="truncate">{template.outputDirectory}</span>
                          </button>
                        ) : null}
                        {template.outputPath ? (
                          <button
                            type="button"
                            aria-label={labels.previewOutputFileAria(template.outputFileName)}
                            title={labels.previewOutputFileAria(template.outputFileName)}
                            onClick={() => void handlePreviewOutputFile(template)}
                            disabled={previewingOutputPath === template.outputPath}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--c-border)] px-1.5 py-1 text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] disabled:cursor-wait disabled:opacity-60"
                          >
                            {previewingOutputPath === template.outputPath ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <FileText size={13} className="shrink-0" />}
                            <span className="truncate">{template.outputFileName}</span>
                          </button>
                        ) : null}
                      </div>
                      {outputActionErrors[template.loopId] ? (
                        <div className="mt-2 text-xs text-[var(--c-status-error-text)]">
                          {outputActionErrors[template.loopId]}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRunNow(template.loopId)}
                        disabled={isRunning}
                        className={secondaryButton}
                      >
                        {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                        {labels.runNow}
                      </button>
                      {template.scheduleEnabled ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDisableSchedule(template)}
                            disabled={saving}
                            className={secondaryButton}
                          >
                            <Timer size={13} />
                            {labels.disableSchedule}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApproveAutoRun(template)}
                            disabled={saving}
                            className={secondaryButton}
                          >
                            <Timer size={13} />
                            {template.autoRunApproved ? labels.revokeAutoRun : labels.approveAutoRun}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleEnableSchedule(template)}
                          disabled={saving}
                          className={secondaryButton}
                        >
                          <Timer size={13} />
                          {labels.enableSchedule}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-[var(--c-bg-deep)] p-3">
                      <div className="text-[var(--c-text-tertiary)]">{labels.lastRun}</div>
                      <div className="mt-1 flex items-center gap-1.5 font-medium text-[var(--c-text-primary)]">
                        {statusIcon(latestRun)}
                        {formatRunStatus(latestRun, labels)}
                      </div>
                      <div className="mt-1 text-[var(--c-text-secondary)]">{formatRunTime(latestRun, labels.noRuns)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--c-bg-deep)] p-3">
                      <div className="text-[var(--c-text-tertiary)]">{labels.schedule}</div>
                      <div className="mt-1 font-medium text-[var(--c-text-primary)]">
                        {template.scheduleEnabled ? labels.scheduleEnabled : labels.scheduleDisabled}
                      </div>
                      <div className="mt-1 text-[var(--c-text-secondary)]">
                        {template.autoRunApproved ? labels.autoRunApproved : labels.manualApproval}
                      </div>
                    </div>
                  </div>

                  {nextAction || nextSummary ? (
                    <div className="mt-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 text-xs">
                      {nextAction ? (
                        <div className="font-medium text-[var(--c-text-heading)]">{nextAction}</div>
                      ) : null}
                      {nextSummary ? (
                        <div className="mt-1 text-[var(--c-text-secondary)]">{nextSummary}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
      {localArtifactPreview ? (
        <ArtifactPreviewModal
          artifact={localArtifactPreview.artifact}
          initialContent={localArtifactPreview.content}
          disableDownload
          onClose={() => setLocalArtifactPreview(null)}
        />
      ) : null}
    </div>
  );
}
