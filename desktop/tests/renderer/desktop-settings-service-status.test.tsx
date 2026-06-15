import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getServiceStatus: vi.fn(),
  restartRelatedService: vi.fn(),
  getLoopDefinitions: vi.fn(),
  getLoopRuns: vi.fn(),
  getEvidenceAnomalies: vi.fn(),
  runLoopNow: vi.fn(),
  listUserLoopTemplates: vi.fn(),
  createUserLoopTemplate: vi.fn(),
  updateUserLoopTemplate: vi.fn(),
  deleteUserLoopTemplate: vi.fn(),
  setUserLoopAutoRunApproved: vi.fn(),
  openLocalPath: vi.fn(),
  readLocalArtifactPreview: vi.fn(),
  getAccountSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    getServiceStatus: mocks.getServiceStatus,
    restartRelatedService: mocks.restartRelatedService,
    getLoopDefinitions: mocks.getLoopDefinitions,
    getLoopRuns: mocks.getLoopRuns,
    getEvidenceAnomalies: mocks.getEvidenceAnomalies,
    runLoopNow: mocks.runLoopNow,
    listUserLoopTemplates: mocks.listUserLoopTemplates,
    createUserLoopTemplate: mocks.createUserLoopTemplate,
    updateUserLoopTemplate: mocks.updateUserLoopTemplate,
    deleteUserLoopTemplate: mocks.deleteUserLoopTemplate,
    setUserLoopAutoRunApproved: mocks.setUserLoopAutoRunApproved,
    openLocalPath: mocks.openLocalPath,
    readLocalArtifactPreview: mocks.readLocalArtifactPreview,
    getAccountSettings: mocks.getAccountSettings,
    updateAccountSettings: mocks.updateAccountSettings,
  },
}));

describe('DesktopSettings service status', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('xiaok:locale', 'zh');
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    mocks.getServiceStatus.mockReset();
    mocks.restartRelatedService.mockReset();
    mocks.getServiceStatus.mockResolvedValue({
      checkedAt: 1779545079000,
      services: [
        {
          id: 'kswarm',
          label: 'KSwarm',
          running: true,
          reachable: true,
          port: 4400,
          pid: 123,
          restartCount: 0,
          lastError: null,
          detail: 'broker connected',
        },
        {
          id: 'intent-broker',
          label: 'Intent Broker',
          running: false,
          reachable: false,
          port: 4318,
          pid: null,
          restartCount: 0,
          lastError: 'connection refused',
          detail: 'broker offline',
        },
        {
          id: 'runtime-bridge',
          label: 'Runtime Bridge',
          running: true,
          reachable: true,
          port: 0,
          pid: null,
          restartCount: 0,
          lastError: null,
          detail: '2 client(s) registered',
        },
      ],
    });
    mocks.restartRelatedService.mockResolvedValue(undefined);
    mocks.listUserLoopTemplates.mockResolvedValue([]);
    mocks.createUserLoopTemplate.mockResolvedValue({});
    mocks.updateUserLoopTemplate.mockResolvedValue({});
    mocks.deleteUserLoopTemplate.mockResolvedValue({ ok: true });
    mocks.setUserLoopAutoRunApproved.mockResolvedValue({});
    mocks.openLocalPath.mockReset();
    mocks.openLocalPath.mockResolvedValue({ ok: true });
    mocks.readLocalArtifactPreview.mockReset();
    mocks.readLocalArtifactPreview.mockResolvedValue({
      path: '/tmp/xiaok-loop/weekly-note.md',
      fileName: 'weekly-note.md',
      mimeType: 'text/markdown',
      sizeBytes: 31,
      modifiedAt: 1_000,
      content: '# Weekly note\n\nLoop output body',
      truncated: false,
    });
    mocks.getLoopDefinitions.mockResolvedValue([
      {
        id: 'artifact-evidence-regression',
        title: 'Artifact Evidence Regression',
        description: 'Checks artifact completion evidence flows for regressions.',
        status: 'active',
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopRuns.mockResolvedValue([
      {
        id: 'run-success',
        loopId: 'artifact-evidence-regression',
        status: 'success',
        trigger: { kind: 'manual' },
        evidenceIds: ['ev-1'],
        startedAt: 3_000,
        finishedAt: 4_000,
        updatedAt: 4_000,
        summary: 'clean',
      },
    ]);
    mocks.getEvidenceAnomalies.mockResolvedValue([
      {
        id: 'anom-1',
        loopId: 'artifact-evidence-regression',
        ownerKind: 'task',
        ownerId: 'task-1',
        kind: 'missing_artifact',
        status: 'open',
        firstSeenAt: 5_000,
        lastSeenAt: 5_000,
        seenCount: 1,
        message: 'missing artifact',
        evidenceIds: [],
        metadata: {
          suggestedActionSummary: '检查 artifact evidence',
          logPaths: ['/tmp/xiaok/logs/kswarm-service.log'],
        },
      },
    ]);
    mocks.runLoopNow.mockResolvedValue({
      status: 'success',
      run: {
        id: 'run-manual',
        loopId: 'artifact-evidence-regression',
        status: 'success',
        trigger: { kind: 'manual' },
        evidenceIds: ['ev-2'],
        startedAt: 6_000,
        finishedAt: 7_000,
        updatedAt: 7_000,
      },
    });
    mocks.getAccountSettings.mockResolvedValue({
      pipeline_trace_enabled: false,
      prompt_cache_debug_enabled: false,
    });
    mocks.updateAccountSettings.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  it('shows related service health and can restart a service from general settings', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    await screen.findByText('服务状态');
    expect(screen.getByText('KSwarm')).toBeInTheDocument();
    expect(screen.getByText('Intent Broker')).toBeInTheDocument();
    expect(screen.getByText('Runtime Bridge')).toBeInTheDocument();
    expect(screen.queryByText('Loop 诊断')).not.toBeInTheDocument();
    expect(mocks.getLoopDefinitions).not.toHaveBeenCalled();
    expect(screen.getAllByText('运行中').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('不可用')).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('restart-service-intent-broker'));

    await waitFor(() => {
      expect(mocks.restartRelatedService).toHaveBeenCalledWith('intent-broker');
    });
    await waitFor(() => {
      expect(mocks.getServiceStatus).toHaveBeenCalledTimes(2);
    });
  });

  it('shows and can trigger built-in loop diagnostics from the loops settings page', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Artifact Evidence Regression');
    expect(screen.getByText('Loop 诊断')).toBeInTheDocument();
    expect(screen.getByText(/success/)).toBeInTheDocument();
    expect(screen.getByText('开放异常')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('run-loop-artifact-evidence-regression'));

    await waitFor(() => {
      expect(mocks.runLoopNow).toHaveBeenCalledWith('artifact-evidence-regression');
    });
  });

  it('shows actionable loop anomaly details and can copy diagnostics summary', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Artifact Evidence Regression');
    expect(screen.getByText('missing artifact')).toBeInTheDocument();
    expect(screen.getByText('检查 artifact evidence')).toBeInTheDocument();
    expect(screen.getByText('/tmp/xiaok/logs/kswarm-service.log')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('copy-loop-diagnostics-artifact-evidence-regression'));

    await waitFor(() => {
      expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('missing artifact'));
    });
  });

  it('keeps loop diagnostics visible when clipboard copy fails', async () => {
    vi.mocked(globalThis.navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'));
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Artifact Evidence Regression');
    fireEvent.click(screen.getByLabelText('copy-loop-diagnostics-artifact-evidence-regression'));

    await waitFor(() => {
      expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalled();
    });
    expect(screen.getByText('missing artifact')).toBeInTheDocument();
    expect(screen.getByText('/tmp/xiaok/logs/kswarm-service.log')).toBeInTheDocument();
  });

  it('shows already-running state and clears it after a fresh diagnostics read', async () => {
    mocks.runLoopNow.mockResolvedValueOnce({
      status: 'already_running',
      activeRunId: 'run-active',
    });

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Artifact Evidence Regression');
    fireEvent.click(screen.getByLabelText('run-loop-artifact-evidence-regression'));

    await screen.findByText('已有运行中');
    expect(screen.getByLabelText('run-loop-artifact-evidence-regression')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(screen.getByLabelText('run-loop-artifact-evidence-regression')).not.toBeDisabled();
    });
    expect(screen.getByLabelText('run-loop-artifact-evidence-regression')).toHaveTextContent('立即运行');
  });

  it('shows the user loops settings empty state and create entry', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('暂无用户循环');
    expect(screen.getByText('新建 Markdown 循环')).toBeInTheDocument();
    expect(mocks.listUserLoopTemplates).toHaveBeenCalled();
  });

  it('shows user loop settings labels in English when English locale is selected', async () => {
    localStorage.setItem('xiaok:locale', 'en');

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Loops' }));

    await screen.findByText('No user loops yet');
    expect(screen.getByText('New Markdown Loop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('shows user loop blocked history and schedule controls', async () => {
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        title: 'Weekly note',
        description: 'Writes a weekly Markdown note.',
        status: 'active',
        kind: 'markdown_file',
        prompt: 'Write weekly note.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'weekly-note.md',
        outputPath: '/tmp/xiaok-loop/weekly-note.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopRuns.mockImplementation(async (loopId: string) => {
      if (loopId === 'user-loop-1') {
        return [
          {
            id: 'run-blocked',
            loopId,
            status: 'blocked',
            trigger: { kind: 'manual' },
            evidenceIds: ['ev-blocked'],
            startedAt: 3_000,
            finishedAt: 4_000,
            updatedAt: 4_000,
            nextActionKind: 'missing_file_artifact',
            nextActionSummary: 'Missing Markdown file artifact: weekly-note.md',
          },
        ];
      }
      return [
        {
          id: 'run-success',
          loopId,
          status: 'success',
          trigger: { kind: 'manual' },
          evidenceIds: ['ev-1'],
          startedAt: 3_000,
          finishedAt: 4_000,
          updatedAt: 4_000,
          summary: 'clean',
        },
      ];
    });

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Weekly note');
    expect(screen.getByText('missing_file_artifact')).toBeInTheDocument();
    expect(screen.getByText('Missing Markdown file artifact: weekly-note.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即运行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用调度' })).toBeInTheDocument();
  });

  it('opens a user loop output directory and previews the output file from the card', async () => {
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        title: 'Weekly note',
        description: 'Writes a weekly Markdown note.',
        status: 'active',
        kind: 'markdown_file',
        prompt: 'Write weekly note.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'weekly-note.md',
        outputPath: '/tmp/xiaok-loop/weekly-note.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Weekly note');
    fireEvent.click(screen.getByRole('button', { name: /打开输出目录.*\/tmp\/xiaok-loop/ }));

    await waitFor(() => {
      expect(mocks.openLocalPath).toHaveBeenCalledWith('/tmp/xiaok-loop');
    });

    fireEvent.click(screen.getByRole('button', { name: /预览输出文件.*weekly-note\.md/ }));

    await waitFor(() => {
      expect(mocks.readLocalArtifactPreview).toHaveBeenCalledWith('/tmp/xiaok-loop/weekly-note.md');
    });
    expect(await screen.findByText(/Loop output body/)).toBeInTheDocument();
  });

  it('shows an inline error when a user loop output file cannot be previewed', async () => {
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        title: 'Weekly note',
        description: 'Writes a weekly Markdown note.',
        status: 'active',
        kind: 'markdown_file',
        prompt: 'Write weekly note.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'weekly-note.md',
        outputPath: '/tmp/xiaok-loop/weekly-note.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.readLocalArtifactPreview.mockRejectedValueOnce(new Error('ENOENT'));

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Weekly note');
    fireEvent.click(screen.getByRole('button', { name: /预览输出文件.*weekly-note\.md/ }));

    expect(await screen.findByText('输出文件不可预览：ENOENT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即运行' })).toBeInTheDocument();
  });

  it('lets users disable an enabled user loop schedule without leaving auto-run approved', async () => {
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        title: 'Weekly note',
        description: 'Compile a weekly note.',
        status: 'active',
        kind: 'markdown_file',
        prompt: 'Write weekly note.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'weekly-note.md',
        outputPath: '/tmp/xiaok-loop/weekly-note.md',
        scheduleEnabled: true,
        scheduleTrigger: { kind: 'daily', hour: 6, minute: 3 },
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);

    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '循环' }));

    await screen.findByText('Weekly note');
    expect(screen.getByRole('button', { name: '关闭调度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批准自动运行' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭调度' }));

    await waitFor(() => {
      expect(mocks.updateUserLoopTemplate).toHaveBeenCalledWith(expect.objectContaining({
        loopId: 'user-loop-1',
        scheduleEnabled: false,
        autoRunApproved: false,
        scheduleTrigger: { kind: 'daily', hour: 6, minute: 3 },
      }));
    });
  });
});
