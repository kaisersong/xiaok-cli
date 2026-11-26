import { LoopArtifactList } from '../loops/LoopArtifactList';
import { loopNeedsRevalidation } from '../../lib/loop-run-observation';
import { LoopPublicationPanel } from '../loops/LoopPublicationPanel';
import { type RefObject } from 'react';
import {
  Trash2,
  Plus,
  Edit3,
  Eye,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { type NavigateFunction } from 'react-router-dom';
import type {
  LoopDefinitionView,
  LoopOutputPreviewView,
  LoopRunView,
  LoopScheduleBindingView,
  LoopTaskResultView,
  RunLoopNowResultView,
  UserLoopTemplateView,
} from '../../api/types';
import { useLocale } from '../../contexts/LocaleContext';
import { resolveUserLoopStarterTemplates, type UserLoopStarterTemplate } from '../loops/userLoopStarterTemplates';
import { SectionHeader, Section, Card, btnPrimary, btnSecondary } from './settings-ui';

export function UserLoopsSection({
  t,
  setShowCreateLoop,
  showCreateLoop,
  newLoopTitle,
  setNewLoopTitle,
  newLoopKind,
  setNewLoopKind,
  newLoopPrompt,
  setNewLoopPrompt,
  newLoopOutputDirectory,
  setNewLoopOutputDirectory,
  newLoopOutputFileName,
  setNewLoopOutputFileName,
  createLoopError,
  resetCreateForm,
  handleCreateUserLoop,
  creatingLoop,
  loopDiagnosticsLoading,
  userLoops,
  scheduledBindingsError,
  handleCreateFromTemplate,
  loopRuns,
  runningLoopId,
  previewingLoopId,
  viewingTaskResultLoopId,
  loopOutputPreviews,
  loopTaskResults,
  loopScheduleBindings,
  loopRunResults,
  handleOpenLoopSchedules,
  navigate,
  loadLoops,
  observationLabel,
  handleOpenLoopOutputDirectory,
  handlePreviewLoopOutput,
  handleViewLoopTaskResult,
  handleRunLoopNow,
  handleEditLoop,
  handleDeleteLoop,
  loopLoadGeneration,
  editingLoopId,
  editLoopTitle,
  setEditLoopTitle,
  editLoopPrompt,
  setEditLoopPrompt,
  editLoopOutputDir,
  setEditLoopOutputDir,
  editLoopOutputFile,
  setEditLoopOutputFile,
  setEditingLoopId,
  handleSaveEdit,
  savingEdit,
}: {
  t: ReturnType<typeof useLocale>['t'];
  setShowCreateLoop: (value: boolean) => void;
  showCreateLoop: boolean;
  newLoopTitle: string;
  setNewLoopTitle: (value: string) => void;
  newLoopKind: UserLoopTemplateView['kind'];
  setNewLoopKind: (value: UserLoopTemplateView['kind']) => void;
  newLoopPrompt: string;
  setNewLoopPrompt: (value: string) => void;
  newLoopOutputDirectory: string;
  setNewLoopOutputDirectory: (value: string) => void;
  newLoopOutputFileName: string;
  setNewLoopOutputFileName: (value: string) => void;
  createLoopError: string;
  resetCreateForm: () => void;
  handleCreateUserLoop: () => Promise<void>;
  creatingLoop: boolean;
  loopDiagnosticsLoading: boolean;
  userLoops: Array<{ template: UserLoopTemplateView; definition: LoopDefinitionView | undefined }>;
  scheduledBindingsError: string;
  handleCreateFromTemplate: (template: UserLoopStarterTemplate) => Promise<void>;
  loopRuns: Record<string, LoopRunView[]>;
  runningLoopId: string | null;
  previewingLoopId: string | null;
  viewingTaskResultLoopId: string | null;
  loopOutputPreviews: Record<string, LoopOutputPreviewView | undefined>;
  loopTaskResults: Record<string, LoopTaskResultView | undefined>;
  loopScheduleBindings: Record<string, LoopScheduleBindingView>;
  loopRunResults: Record<string, RunLoopNowResultView | undefined>;
  handleOpenLoopSchedules: (loopId: string) => void;
  navigate: NavigateFunction;
  loadLoops: (silent?: boolean) => Promise<void>;
  observationLabel: (run: LoopRunView) => string;
  handleOpenLoopOutputDirectory: (loopId: string) => Promise<void>;
  handlePreviewLoopOutput: (loopId: string) => Promise<void>;
  handleViewLoopTaskResult: (loopId: string) => Promise<void>;
  handleRunLoopNow: (loopId: string) => Promise<void>;
  handleEditLoop: (template: UserLoopTemplateView, definition?: LoopDefinitionView) => void;
  handleDeleteLoop: (loopId: string) => Promise<void>;
  loopLoadGeneration: RefObject<number>;
  editingLoopId: string | null;
  editLoopTitle: string;
  setEditLoopTitle: (value: string) => void;
  editLoopPrompt: string;
  setEditLoopPrompt: (value: string) => void;
  editLoopOutputDir: string;
  setEditLoopOutputDir: (value: string) => void;
  editLoopOutputFile: string;
  setEditLoopOutputFile: (value: string) => void;
  setEditingLoopId: (value: string | null) => void;
  handleSaveEdit: () => Promise<void>;
  savingEdit: boolean;
}) {
  return (
    <Section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionHeader icon={RefreshCw}>{t.desktopSettings.userLoops}</SectionHeader>
        <button
          type="button"
          onClick={() => setShowCreateLoop(true)}
          className={`${btnPrimary} inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5`}
        >
          <Plus size={14} />
          {t.desktopSettings.newLoop}
        </button>
      </div>
      <Card>
        <p className="mb-3 text-xs text-[var(--c-text-secondary)]">
          {t.desktopSettings.userLoopsDesc}
        </p>

        {showCreateLoop ? (
          <div className="mb-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                {t.desktopSettings.userLoopTitleLabel}
                <input
                  aria-label={t.desktopSettings.userLoopTitleLabel}
                  type="text"
                  value={newLoopTitle}
                  onChange={(event) => setNewLoopTitle(event.target.value)}
                  className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                {t.desktopSettings.userLoopKindLabel}
                <select
                  aria-label={t.desktopSettings.userLoopKindLabel}
                  value={newLoopKind}
                  onChange={(event) => setNewLoopKind(event.target.value as 'markdown_file' | 'task_completion')}
                  className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                >
                  <option value="task_completion">{t.desktopSettings.userLoopKindTaskCompletion}</option>
                  <option value="markdown_file">{t.desktopSettings.userLoopKindMarkdownFile}</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                {t.desktopSettings.userLoopPromptLabel}
                <textarea
                  aria-label={t.desktopSettings.userLoopPromptLabel}
                  value={newLoopPrompt}
                  onChange={(event) => setNewLoopPrompt(event.target.value)}
                  rows={3}
                  className="resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                />
              </label>
              {newLoopKind === 'markdown_file' ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                  {t.desktopSettings.userLoopOutputDirectoryLabel}
                  <div className="flex gap-1.5">
                    <input
                      aria-label={t.desktopSettings.userLoopOutputDirectoryLabel}
                      type="text"
                      value={newLoopOutputDirectory}
                      onChange={(event) => setNewLoopOutputDirectory(event.target.value)}
                      className="flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const result = await window.xiaokDesktop?.selectDirectory();
                          if (result?.filePath) setNewLoopOutputDirectory(result.filePath);
                        } catch { /* user cancel */ }
                      }}
                      className="shrink-0 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                    >
                      {t.desktopSettings.advancedChooseFolder}
                    </button>
                  </div>
                </label>
                <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                  {t.desktopSettings.userLoopOutputFileNameLabel}
                  <input
                    aria-label={t.desktopSettings.userLoopOutputFileNameLabel}
                    type="text"
                    value={newLoopOutputFileName}
                    onChange={(event) => setNewLoopOutputFileName(event.target.value)}
                    className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                  />
                </label>
              </div> : null}
            </div>
            {createLoopError ? (
              <div className="mt-3 rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
                {createLoopError}
              </div>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { resetCreateForm(); setShowCreateLoop(false); }} className={btnSecondary}>
                {t.desktopSettings.cancel}
              </button>
              <button type="button" onClick={() => void handleCreateUserLoop()} disabled={creatingLoop} className={btnPrimary}>
                {creatingLoop ? t.desktopSettings.creatingLoop : t.desktopSettings.createLoop}
              </button>
            </div>
          </div>
        ) : null}

        {loopDiagnosticsLoading && userLoops.length === 0 ? (
          <div className="text-xs text-[var(--c-text-secondary)]">
            {t.desktopSettings.userLoopsLoading}
          </div>
        ) : userLoops.length === 0 && !scheduledBindingsError ? (
          <div>
            <p className="text-xs text-[var(--c-text-secondary)] mb-3">
              {t.desktopSettings.userLoopsEmpty}
            </p>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--c-text-muted)] mb-2">
              {t.desktopSettings.quickStartFromTemplate}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {resolveUserLoopStarterTemplates(t).map(template => (
                <div
                  key={template.templateId}
                  className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--c-text-heading)]">{template.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${template.category === 'business' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                      {template.category === 'business' ? t.desktopSettings.categoryBusiness : t.desktopSettings.categoryCode}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-[var(--c-text-secondary)] flex-1">{template.description}</p>
                  {template.scheduleHint && (
                    <p className="text-[10px] text-[var(--c-text-tertiary)]">{template.scheduleHint}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCreateFromTemplate(template)}
                    className={`${btnSecondary} self-start px-3 py-1 text-xs`}
                  >
                    {t.desktopSettings.useThisTemplate}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {userLoops.map(({ template, definition }) => {
              const loopTitle = definition?.title ?? template.loopId;
              const loopStatus = definition?.status ?? 'active';
              const runs = loopRuns[template.loopId] ?? [];
              const latestRun = runs[0];
              const latestRunFailed = latestRun && (latestRun.status === 'failed' || latestRun.status === 'blocked');
              const isRunning = runningLoopId === template.loopId;
              const isPreviewing = previewingLoopId === template.loopId;
              const isViewingTaskResult = viewingTaskResultLoopId === template.loopId;
              const isMarkdownLoop = template.kind === 'markdown_file';
              const outputPreview = loopOutputPreviews[template.loopId];
              const taskResult = loopTaskResults[template.loopId];
              const scheduleBinding = loopScheduleBindings[template.loopId];
              const runResult = loopRunResults[template.loopId];
              const isAlreadyRunning = !!definition?.activeRunId || runResult?.status === 'already_running';
              const buttonLabel = isRunning
                ? t.desktopSettings.loopDiagnosticsRunning
                : isAlreadyRunning
                  ? t.desktopSettings.loopDiagnosticsAlreadyRunning
                  : (runResult?.status==='publication_pending'||loopNeedsRevalidation(latestRun))?t.desktopSettings.loopDiagnosticsPublicationPending:t.desktopSettings.loopDiagnosticsRunNow;
              return (
                <div key={template.loopId} id={`loop-${template.loopId}`} className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 scroll-mt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--c-text-heading)]">{loopTitle}</div>
                      {definition?.description ? (
                        <div className="mt-0.5 text-xs text-[var(--c-text-secondary)]">{definition.description}</div>
                      ) : null}
                      <div className="mt-2 grid gap-1 break-all text-xs text-[var(--c-text-secondary)]">
                        {isMarkdownLoop ? (
                          <>
                            <div>
                              <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.userLoopOutputDirectoryLabel}: </span>
                              {template.outputDirectory}
                            </div>
                            <div>
                              <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.userLoopOutputFileNameLabel}: </span>
                              {template.outputFileName}
                            </div>
                          </>
                        ) : null}
                        {scheduleBinding ? (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                              {scheduleBinding.kind === 'multiple'
                                ? t.desktopSettings.userLoopScheduleMultiple
                                : t.desktopSettings.userLoopScheduleSingle}
                            </span>
                            <span>
                              {scheduleBinding.count} {t.automationsSchedules}
                            </span>
                            <span>
                              {scheduleBinding.activeCount} {t.desktopSettings.userLoopScheduleActive}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenLoopSchedules(template.loopId)}
                              className="text-[var(--c-accent)] hover:underline"
                            >
                              {t.desktopSettings.userLoopOpenSchedules}
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => navigate(`/automations/schedules?loopId=${encodeURIComponent(template.loopId)}&create=1&name=${encodeURIComponent(loopTitle)}`)}
                              className="text-[var(--c-accent)] hover:underline text-xs"
                            >
                              {t.desktopSettings.createScheduleForLoop}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                      {loopStatus}
                    </span>
                  </div>
                  <LoopPublicationPanel loopId={template.loopId} runs={runs} onChanged={() => void loadLoops(true)} />
                  {latestRun?.status==='success'&&<div className="mt-2 text-xs text-[var(--c-text-secondary)]">{observationLabel(latestRun)}</div>}
                  {latestRunFailed && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-red-700">{latestRun.status === 'blocked' ? t.desktopSettings.lastRunBlocked : t.desktopSettings.lastRunFailed}</span>
                        <span className="text-[10px] text-red-600/70">{new Date(latestRun.startedAt).toLocaleString()}</span>
                      </div>
                      {latestRun.message && (
                        <p className="mt-1 leading-5 text-red-700/90 break-words whitespace-pre-wrap">{latestRun.message}</p>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {isMarkdownLoop ? (
                      <>
                        <button
                          type="button"
                          aria-label={`${t.desktopSettings.userLoopOpenOutputDirectory}: ${loopTitle}`}
                          onClick={() => void handleOpenLoopOutputDirectory(template.loopId)}
                          className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                        >
                          <HardDrive size={14} />
                          {t.desktopSettings.userLoopOpenOutputDirectory}
                        </button>
                        <button
                          type="button"
                          aria-label={`${t.desktopSettings.userLoopPreviewOutputFile}: ${loopTitle}`}
                          onClick={() => void handlePreviewLoopOutput(template.loopId)}
                          disabled={isPreviewing}
                          className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                        >
                          <Eye size={14} />
                          {isPreviewing ? t.desktopSettings.loopDiagnosticsRunning : t.desktopSettings.userLoopPreviewOutputFile}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`${t.desktopSettings.userLoopViewTaskResult}: ${loopTitle}`}
                        onClick={() => void handleViewLoopTaskResult(template.loopId)}
                        disabled={isViewingTaskResult}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                      >
                        <Eye size={14} />
                        {isViewingTaskResult ? t.desktopSettings.loopDiagnosticsRunning : t.desktopSettings.userLoopViewTaskResult}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`run-loop-${template.loopId}`}
                      onClick={() => void handleRunLoopNow(template.loopId)}
                      disabled={isRunning || isAlreadyRunning || loopStatus !== 'active'}
                      className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                    >
                      <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
                      {buttonLabel}
                    </button>
                    <button
                      type="button"
                      aria-label={`edit-loop-${template.loopId}`}
                      onClick={() => handleEditLoop(template, definition)}
                      className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                    >
                      <Edit3 size={14} />
                      {t.commonEdit}
                    </button>
                    <button
                      type="button"
                      aria-label={`delete-loop-${template.loopId}`}
                      onClick={() => void handleDeleteLoop(template.loopId)}
                      className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5 text-red-500 hover:text-red-600`}
                    >
                      <Trash2 size={14} />
                      {t.commonDelete}
                    </button>
                  </div>
                  {isMarkdownLoop ? <p className="mt-2 text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.userLoopWorkspaceNavigationHint}</p> : null}
                  <LoopArtifactList loopId={template.loopId} refreshGeneration={loopLoadGeneration.current}/>
                  {outputPreview ? (
                    <div className="mt-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
                      <div className="mb-2 text-xs font-medium text-[var(--c-text-secondary)]">
                        {t.desktopSettings.userLoopOutputPreview}{outputPreview.ok&&outputPreview.origin==='verified_publication'&&outputPreview.checkedAt ? ` · ${t.desktopSettings.loopDiagnosticsVerifiedAt(new Date(outputPreview.checkedAt).toLocaleString())}` : ''}
                      </div>
                      {outputPreview.ok ? (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--c-bg-deep)] p-3 text-xs leading-5 text-[var(--c-text-primary)]">
                          {outputPreview.content.split(/\r?\n/).map((line, index) => (
                            <span key={`${template.loopId}-preview-${index}`} className="block min-h-[1.25em]">
                              {line || ' '}
                            </span>
                          ))}
                        </pre>
                      ) : (
                        <div className="text-xs text-[var(--c-text-secondary)]">
                          {outputPreview.message || t.desktopSettings.userLoopOutputPreviewUnavailable}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {taskResult ? (
                    <div className="mt-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
                      <div className="mb-2 text-xs font-medium text-[var(--c-text-secondary)]">
                        {t.desktopSettings.userLoopTaskResult}{taskResult.ok&&taskResult.origin==='verified_publication'&&taskResult.checkedAt ? ` · ${t.desktopSettings.loopDiagnosticsVerifiedAt(new Date(taskResult.checkedAt).toLocaleString())}` : ''}
                      </div>
                      {taskResult.ok ? (
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--c-bg-deep)] p-3 text-xs leading-5 text-[var(--c-text-primary)]">
                          {taskResult.content.split(/\r?\n/).map((line, index) => (
                            <span key={`${template.loopId}-task-result-${index}`} className="block min-h-[1.25em]">
                              {line || ' '}
                            </span>
                          ))}
                        </pre>
                      ) : (
                        <div className="text-xs text-[var(--c-text-secondary)]">
                          {taskResult.message || t.desktopSettings.userLoopTaskResultUnavailable}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {editingLoopId === template.loopId && (
                    <div className="mt-3 rounded-lg border border-[var(--c-accent)] bg-[var(--c-bg-page)] p-3">
                      <div className="grid gap-2">
                        <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                          {t.desktopSettings.userLoopTitleLabel}
                          <input type="text" value={editLoopTitle} onChange={e => setEditLoopTitle(e.target.value)} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
                        </label>
                        <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                          {t.desktopSettings.userLoopPromptLabel}
                          <textarea value={editLoopPrompt} onChange={e => setEditLoopPrompt(e.target.value)} rows={14} className="resize-y min-h-[200px] rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)] font-mono" />
                        </label>
                        {template.kind === 'markdown_file' && (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                              {t.desktopSettings.userLoopOutputDirectoryLabel}
                              <div className="flex gap-1.5">
                                <input type="text" value={editLoopOutputDir} onChange={e => setEditLoopOutputDir(e.target.value)} className="flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const result = await window.xiaokDesktop?.selectDirectory();
                                      if (result?.filePath) setEditLoopOutputDir(result.filePath);
                                    } catch { /* user cancel */ }
                                  }}
                                  className="shrink-0 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                                >
                                  {t.desktopSettings.advancedChooseFolder}
                                </button>
                              </div>
                            </label>
                            <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                              {t.desktopSettings.userLoopOutputFileNameLabel}
                              <input type="text" value={editLoopOutputFile} onChange={e => setEditLoopOutputFile(e.target.value)} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
                            </label>
                          </div>
                        )}
                        <div className="flex justify-end gap-2 pt-1">
                          <button type="button" onClick={() => setEditingLoopId(null)} className={`${btnSecondary} px-3 py-1.5`}>{t.desktopSettings.loopEditCancel}</button>
                          <button type="button" onClick={() => void handleSaveEdit()} disabled={savingEdit || !editLoopTitle.trim()} className={`${btnPrimary} px-3 py-1.5`}>{savingEdit ? t.desktopSettings.loopEditSaving : t.desktopSettings.loopEditSave}</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Section>
  );
}
