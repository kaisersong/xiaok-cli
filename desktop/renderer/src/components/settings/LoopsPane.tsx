import { scheduledErrorMessage } from '../../lib/scheduled-timed-action-error';
import { loopManagementErrorMessage, loopManagementFailureKind } from '../../lib/loop-management-errors';
import { loopObservationLabel, loopNeedsRevalidation, invalidateLoopObservations } from '../../lib/loop-run-observation';
import { LoopPublicationPanel } from '../loops/LoopPublicationPanel';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { automationFocusTargetId } from '../../lib/automation-deep-link';
import type {
  EvidenceAnomalyView,
  CreateUserLoopTemplateInputView,
  LoopDefinitionView,
  LoopOutputPreviewView,
  LoopRunView,
  LoopScheduleBindingView,
  LoopTaskResultView,
  RunLoopNowResultView,
  UserLoopTemplateView,
} from '../../api/types';
import { useLocale } from '../../contexts/LocaleContext';
import { useToast } from '../../shared';
import { type UserLoopStarterTemplate } from '../loops/userLoopStarterTemplates';
import { buildLoopDiagnosticsSummary, getLoopAnomalyLogPaths, getLoopAnomalySuggestedAction, getOpenLoopAnomalies } from './loopDiagnostics';
import { SectionHeader, Section, Card, btnSecondary } from './settings-ui';
import { getLoopRunStatusLabel, formatLoopRunTime } from './loop-run-display';
import { UserLoopsSection } from './UserLoopsSection';

function getOpenLoopAnomalyCount(anomalies: EvidenceAnomalyView[]): number {
  return getOpenLoopAnomalies(anomalies).length;
}

function createUserLoopId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `user-loop-${randomId ?? Date.now().toString(36)}`;
}

// ---- Loops ----

export function LoopsPane({ sections = 'all' }: { sections?: 'all' | 'user' | 'diagnostics' }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const locationHash = location.hash;
  const toast = useToast() as {
    addToast?: (message: string, type?: 'success' | 'error') => void;
    show?: (message: string, type?: 'success' | 'error') => void;
  };
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    if (toast.addToast) toast.addToast(message, type);
    else toast.show?.(message, type);
  }, [toast]);
  const [loopDefinitions, setLoopDefinitions] = useState<LoopDefinitionView[]>([]);
  const [userLoopTemplates, setUserLoopTemplates] = useState<UserLoopTemplateView[]>([]);
  const [loopScheduleBindings, setLoopScheduleBindings] = useState<Record<string, LoopScheduleBindingView>>({});
  const [loopRuns, setLoopRuns] = useState<Record<string, LoopRunView[]>>({});
  const [loopAnomalies, setLoopAnomalies] = useState<Record<string, EvidenceAnomalyView[]>>({});
  const [loopRunResults, setLoopRunResults] = useState<Record<string, RunLoopNowResultView | undefined>>({});
  const [loopDiagnosticsLoading, setLoopDiagnosticsLoading] = useState(true);
  const [loopDiagnosticsError, setLoopDiagnosticsError] = useState('');
  const [scheduledBindingsError, setScheduledBindingsError] = useState('');
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null);
  const [loopOutputPreviews, setLoopOutputPreviews] = useState<Record<string, LoopOutputPreviewView | undefined>>({});
  const [loopTaskResults, setLoopTaskResults] = useState<Record<string, LoopTaskResultView | undefined>>({});
  const [previewingLoopId, setPreviewingLoopId] = useState<string | null>(null);
  const [viewingTaskResultLoopId, setViewingTaskResultLoopId] = useState<string | null>(null);
  const [showCreateLoop, setShowCreateLoop] = useState(false);
  const [creatingLoop, setCreatingLoop] = useState(false);
  const [createLoopError, setCreateLoopError] = useState('');
  const [newLoopTitle, setNewLoopTitle] = useState('');
  const [newLoopKind, setNewLoopKind] = useState<'markdown_file' | 'task_completion'>('task_completion');
  const [newLoopPrompt, setNewLoopPrompt] = useState('');
  const [newLoopOutputDirectory, setNewLoopOutputDirectory] = useState('');
  const [newLoopOutputFileName, setNewLoopOutputFileName] = useState('');
  const [editingLoopId, setEditingLoopId] = useState<string | null>(null);
  const [editLoopTitle, setEditLoopTitle] = useState('');
  const [editLoopPrompt, setEditLoopPrompt] = useState('');
  const [editLoopDesc, setEditLoopDesc] = useState('');
  const [editLoopOutputDir, setEditLoopOutputDir] = useState('');
  const [editLoopOutputFile, setEditLoopOutputFile] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const loopLoadGeneration=useRef(0),previewGeneration=useRef(0),taskResultGeneration=useRef(0);
  useEffect(()=>()=>{loopLoadGeneration.current++;previewGeneration.current++;taskResultGeneration.current++;},[]);
  const observationLabel=(run:LoopRunView)=>loopObservationLabel(run,{pending:t.desktopSettings.loopDiagnosticsPublicationPending,verified:at=>t.desktopSettings.loopDiagnosticsVerifiedAt(new Date(at).toLocaleString()),status:getLoopRunStatusLabel});
  const loadLoops = useCallback(async (silent = false) => {
    const generation=++loopLoadGeneration.current;
    previewGeneration.current++;taskResultGeneration.current++;setLoopOutputPreviews({});setLoopTaskResults({});setPreviewingLoopId(null);setViewingTaskResultLoopId(null);
    setLoopRuns(invalidateLoopObservations);
    setLoopRunResults(previous=>Object.fromEntries(Object.entries(previous).filter(([,result])=>result?.status!=='success'&&result?.status!=='already_completed')));

    if (!silent) setLoopDiagnosticsLoading(true);
    setLoopDiagnosticsError('');
    try {
      const [definitions, templates, scheduleBindings] = await Promise.all([
        api.getLoopDefinitions(),
        api.listUserLoopTemplates(),
        api.getLoopScheduleBindings(),
      ]);
      const details = await Promise.all(definitions.map(async (loop) => {
        const [runs, anomalies] = await Promise.all([
          api.getLoopRuns(loop.id),
          api.getEvidenceAnomalies(loop.id).catch(error => {
            if (loopManagementFailureKind(error) === 'unavailable') throw error;
            return [] as EvidenceAnomalyView[];
          }),
        ]);
        return { loop, runs, anomalies };
      }));
      if(generation!==loopLoadGeneration.current)return;
      setLoopDefinitions(definitions);
      setUserLoopTemplates(templates);
      setLoopScheduleBindings(Object.fromEntries(scheduleBindings.map(binding => [binding.loopId, binding])));
      setScheduledBindingsError('');
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
      if(generation!==loopLoadGeneration.current)return;
      setLoopRuns(invalidateLoopObservations);
      const scheduledFailure = error instanceof Error && /scheduled_(projection_unavailable|runtime_unavailable|input_invalid)/.test(error.message);
      if (scheduledFailure) setScheduledBindingsError(scheduledErrorMessage(error,t,true));
      setLoopDiagnosticsError(scheduledFailure ? scheduledErrorMessage(error,t,true) : loopManagementErrorMessage(error, t, t.desktopSettings.loopDiagnosticsLoadError));
    } finally {
      if (generation===loopLoadGeneration.current) setLoopDiagnosticsLoading(false);
    }
  }, [t.desktopSettings.loopDiagnosticsLoadError, t.loopOperationResultUnknown, t.loopProjectionUnavailable, t.loopInputInvalid, t.scheduledProjectionUnavailable, t.scheduledOperationUnknown, t.scheduledInputInvalid]);

  useEffect(() => {
    void loadLoops();
  }, [loadLoops]);

  useEffect(() => {
    if (loopDiagnosticsLoading) return;
    const targetId = automationFocusTargetId(locationHash, 'loop');
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--c-accent)';
      el.style.outlineOffset = '2px';
      const timer = setTimeout(() => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [locationHash, loopDiagnosticsLoading]);

  const handleRunLoopNow = async (loopId: string) => {
    if (runningLoopId) return;
    setRunningLoopId(loopId);
    setLoopDiagnosticsError('');
    try {
      const result = await api.runLoopNow(loopId);
      setLoopRunResults(prev => ({ ...prev, [loopId]: result }));
      if (result.status !== 'already_running') {
        await loadLoops(true);
      }
    } catch (error) {
      setLoopDiagnosticsError(loopManagementErrorMessage(error, t, t.desktopSettings.loopDiagnosticsRunFailed));
    } finally {
      setRunningLoopId(null);
    }
  };

  const handleOpenLoopOutputDirectory = async (loopId: string) => {
    try {
      const result = await api.openLoopOutputDirectory(loopId);
      if (!result.ok) {
        showToast(result.message || result.error);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopOutputPreviewUnavailable);
    }
  };

  const handlePreviewLoopOutput = async (loopId: string) => {
    const generation=++previewGeneration.current;setLoopOutputPreviews(previous=>({...previous,[loopId]:undefined}));
    setPreviewingLoopId(loopId);
    try {
      const result = await api.readLoopOutputPreview(loopId);
      if(generation!==previewGeneration.current)return;
      setLoopOutputPreviews(prev => ({ ...prev, [loopId]: result }));
      if (!result.ok) {
        showToast(result.message || t.desktopSettings.userLoopOutputPreviewUnavailable);
      }
    } catch (error) {
      if(generation!==previewGeneration.current)return;
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopOutputPreviewUnavailable);
    } finally {
      if(generation===previewGeneration.current)setPreviewingLoopId(null);
    }
  };

  const handleViewLoopTaskResult = async (loopId: string) => {
    const generation=++taskResultGeneration.current;setLoopTaskResults(previous=>({...previous,[loopId]:undefined}));
    setViewingTaskResultLoopId(loopId);
    try {
      const result = await api.readLoopTaskResult(loopId);
      if(generation!==taskResultGeneration.current)return;
      setLoopTaskResults(prev => ({ ...prev, [loopId]: result }));
      if (!result.ok) {
        showToast(result.message || t.desktopSettings.userLoopTaskResultUnavailable);
      }
    } catch (error) {
      if(generation!==taskResultGeneration.current)return;
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopTaskResultUnavailable);
    } finally {
      if(generation===taskResultGeneration.current)setViewingTaskResultLoopId(null);
    }
  };

  const handleEditLoop = (template: UserLoopTemplateView, definition?: LoopDefinitionView) => {
    setEditingLoopId(template.loopId);
    setEditLoopTitle(definition?.title ?? '');
    setEditLoopDesc(definition?.description ?? '');
    setEditLoopPrompt(template.prompt ?? '');
    setEditLoopOutputDir(template.outputDirectory ?? '');
    setEditLoopOutputFile(template.outputFileName ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingLoopId || !editLoopTitle.trim()) return;
    setSavingEdit(true);
    try {
      console.log('[LoopsPane] saving edit', { loopId: editingLoopId, title: editLoopTitle.trim() });
      await api.updateUserLoopTemplate(editingLoopId, {
        title: editLoopTitle.trim(),
        description: editLoopDesc.trim(),
        prompt: editLoopPrompt.trim(),
        outputDirectory: editLoopOutputDir.trim() || undefined,
        outputFileName: editLoopOutputFile.trim() || undefined,
      });
      console.log('[LoopsPane] save edit ok', { loopId: editingLoopId });
      setEditingLoopId(null);
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] save edit failed', error);
      showToast(loopManagementErrorMessage(error, t, t.desktopSettings.saveLoopFailed));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteLoop = async (loopId: string) => {
    if (!confirm(t.desktopSettings.deleteLoopConfirm)) return;
    try {
      console.log('[LoopsPane] deleting loop', { loopId });
      await api.deleteUserLoopTemplate(loopId);
      console.log('[LoopsPane] delete loop ok', { loopId });
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] delete loop failed', error);
      showToast(loopManagementErrorMessage(error, t, t.desktopSettings.deleteLoopFailed));
    }
  };

  const handleCopyLoopDiagnostics = async (
    loop: LoopDefinitionView,
    runs: LoopRunView[],
    anomalies: EvidenceAnomalyView[],
  ) => {
    try {
      const summary = buildLoopDiagnosticsSummary({ loop, runs, anomalies, observationLabel,labels:t.desktopSettings.loopDiagnosticsCopyLabels });
      await navigator.clipboard.writeText(summary);
      showToast(t.desktopSettings.loopDiagnosticsCopied, 'success');
    } catch {
      showToast(t.desktopSettings.loopDiagnosticsCopyFailed, 'error');
    }
  };

  const handleOpenLoopSchedules = (loopId: string) => {
    navigate(`/automations/schedules?loopId=${encodeURIComponent(loopId)}`);
  };

  const resetCreateForm = () => {
    setNewLoopTitle('');
    setNewLoopKind('task_completion');
    setNewLoopPrompt('');
    setNewLoopOutputDirectory('');
    setNewLoopOutputFileName('');
    setCreateLoopError('');
  };

  const handleCreateUserLoop = async () => {
    const input = {
      loopId: createUserLoopId(),
      title: newLoopTitle.trim(),
      kind: newLoopKind,
      prompt: newLoopPrompt.trim(),
      ...(newLoopKind === 'markdown_file' ? {
        outputDirectory: newLoopOutputDirectory.trim(),
        outputFileName: newLoopOutputFileName.trim(),
      } : {}),
    } as CreateUserLoopTemplateInputView;
    if (!input.title || !input.prompt) {
      setCreateLoopError(t.desktopSettings.userLoopCreateMissingFields);
      return;
    }
    if (newLoopKind === 'markdown_file' && (!newLoopOutputDirectory.trim() || !newLoopOutputFileName.trim())) {
      setCreateLoopError(t.desktopSettings.userLoopCreateMissingFields);
      return;
    }
    setCreatingLoop(true);
    setCreateLoopError('');
    try {
      await api.createUserLoopTemplate(input);
      resetCreateForm();
      setShowCreateLoop(false);
      showToast(t.desktopSettings.userLoopCreateSuccess, 'success');
      await loadLoops(true);
    } catch (error) {
      setCreateLoopError(loopManagementErrorMessage(error, t, t.desktopSettings.userLoopCreateFailed));
    } finally {
      setCreatingLoop(false);
    }
  };

  const handleCreateFromTemplate = async (template: UserLoopStarterTemplate) => {
    const input = {
      loopId: createUserLoopId(),
      title: template.title,
      kind: template.kind,
      prompt: template.prompt,
      ...(template.kind === 'markdown_file' ? {
        outputDirectory: template.outputDirectory ?? '',
        outputFileName: template.outputFileName ?? 'output.md',
      } : {}),
    } as CreateUserLoopTemplateInputView;
    try {
      console.log('[LoopsPane] creating from template', { templateId: template.templateId });
      await api.createUserLoopTemplate(input);
      showToast(t.desktopSettings.createdFromTemplate(template.title), 'success');
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] create from template failed', error);
      showToast(loopManagementErrorMessage(error, t, t.desktopSettings.createFromTemplateFailed));
    }
  };

  const definitionById = new Map(loopDefinitions.map(loop => [loop.id, loop]));
  const builtInLoops = loopDefinitions.filter(loop => loop.origin !== 'user_template');
  const userLoops = userLoopTemplates.map(template => ({
    template,
    definition: definitionById.get(template.loopId),
  }));
  const showUserLoops = sections === 'all' || sections === 'user';
  const showDiagnostics = sections === 'all' || sections === 'diagnostics';

  return (
    <>
      {showUserLoops && !showDiagnostics && scheduledBindingsError && <div role="alert" className="mb-3 rounded-md border p-3 text-xs text-[var(--c-status-error-text)]"><p>{scheduledBindingsError}</p><button type="button" onClick={()=>void loadLoops()} className="mt-2 rounded-md border px-2 py-1">{t.scheduledRefreshData}</button></div>}
      {showUserLoops && (
      <UserLoopsSection
        t={t}
        setShowCreateLoop={setShowCreateLoop}
        showCreateLoop={showCreateLoop}
        newLoopTitle={newLoopTitle}
        setNewLoopTitle={setNewLoopTitle}
        newLoopKind={newLoopKind}
        setNewLoopKind={setNewLoopKind}
        newLoopPrompt={newLoopPrompt}
        setNewLoopPrompt={setNewLoopPrompt}
        newLoopOutputDirectory={newLoopOutputDirectory}
        setNewLoopOutputDirectory={setNewLoopOutputDirectory}
        newLoopOutputFileName={newLoopOutputFileName}
        setNewLoopOutputFileName={setNewLoopOutputFileName}
        createLoopError={createLoopError}
        resetCreateForm={resetCreateForm}
        handleCreateUserLoop={handleCreateUserLoop}
        creatingLoop={creatingLoop}
        loopDiagnosticsLoading={loopDiagnosticsLoading}
        userLoops={userLoops}
        scheduledBindingsError={scheduledBindingsError}
        handleCreateFromTemplate={handleCreateFromTemplate}
        loopRuns={loopRuns}
        runningLoopId={runningLoopId}
        previewingLoopId={previewingLoopId}
        viewingTaskResultLoopId={viewingTaskResultLoopId}
        loopOutputPreviews={loopOutputPreviews}
        loopTaskResults={loopTaskResults}
        loopScheduleBindings={loopScheduleBindings}
        loopRunResults={loopRunResults}
        handleOpenLoopSchedules={handleOpenLoopSchedules}
        navigate={navigate}
        loadLoops={loadLoops}
        observationLabel={observationLabel}
        handleOpenLoopOutputDirectory={handleOpenLoopOutputDirectory}
        handlePreviewLoopOutput={handlePreviewLoopOutput}
        handleViewLoopTaskResult={handleViewLoopTaskResult}
        handleRunLoopNow={handleRunLoopNow}
        handleEditLoop={handleEditLoop}
        handleDeleteLoop={handleDeleteLoop}
        loopLoadGeneration={loopLoadGeneration}
        editingLoopId={editingLoopId}
        editLoopTitle={editLoopTitle}
        setEditLoopTitle={setEditLoopTitle}
        editLoopPrompt={editLoopPrompt}
        setEditLoopPrompt={setEditLoopPrompt}
        editLoopOutputDir={editLoopOutputDir}
        setEditLoopOutputDir={setEditLoopOutputDir}
        editLoopOutputFile={editLoopOutputFile}
        setEditLoopOutputFile={setEditLoopOutputFile}
        setEditingLoopId={setEditingLoopId}
        handleSaveEdit={handleSaveEdit}
        savingEdit={savingEdit}
      />
      )}

      {showDiagnostics && (
      <Section>
        <SectionHeader icon={RefreshCw}>{t.desktopSettings.loopDiagnostics}</SectionHeader>
        <Card>
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="text-xs text-[var(--c-text-secondary)]">
              {t.desktopSettings.loopDiagnosticsDesc}
            </p>
            <button
              type="button"
              onClick={() => void loadLoops()}
              disabled={loopDiagnosticsLoading}
              className={`${btnSecondary} inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5`}
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

          {loopDiagnosticsLoading && builtInLoops.length === 0 ? (
            <div className="text-xs text-[var(--c-text-secondary)]">
              {t.desktopSettings.loopDiagnosticsLoading}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {builtInLoops.map(loop => {
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
                    : (runResult?.status==='publication_pending'||loopNeedsRevalidation(latestRun))?t.desktopSettings.loopDiagnosticsPublicationPending:t.desktopSettings.loopDiagnosticsRunNow;

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

                    <LoopPublicationPanel loopId={loop.id} runs={runs} onChanged={() => void loadLoops(true)} />
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-[var(--c-bg-card)] p-2">
                        <div className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsLastRun}</div>
                        <div className="mt-1 text-[var(--c-text-primary)]">
                          {latestRun
                            ? `${observationLabel(latestRun)} · ${formatLoopRunTime(latestRun)}`
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
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                      >
                        <Copy size={14} />
                        {t.desktopSettings.loopDiagnosticsCopy}
                      </button>
                      <button
                        type="button"
                        aria-label={`run-loop-${loop.id}`}
                        onClick={() => void handleRunLoopNow(loop.id)}
                        disabled={isRunning || isAlreadyRunning || loop.status !== 'active'}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
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
        </Card>
      </Section>
      )}
    </>
  );
}
