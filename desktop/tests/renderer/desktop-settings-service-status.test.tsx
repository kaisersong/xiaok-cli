import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { DeveloperSettings } from '../../renderer/src/components/settings/DeveloperSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getServiceStatus: vi.fn(),
  restartRelatedService: vi.fn(),
  getLoopDefinitions: vi.fn(),
  getLoopRuns: vi.fn(),
  getEvidenceAnomalies: vi.fn(),
  runLoopNow: vi.fn(),
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
    getAccountSettings: mocks.getAccountSettings,
    updateAccountSettings: mocks.updateAccountSettings,
  },
}));

vi.mock('../../renderer/src/components/settings/RunsSettings', () => ({
  RunsSettings: () => <div>Runs Settings</div>,
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    app: { getVersion: vi.fn().mockResolvedValue('test-version') },
    config: {
      get: vi.fn().mockResolvedValue({ onboarding_completed: true }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

describe('DesktopSettings service status', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
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
        metadata: {},
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
    await screen.findByText('Loop 诊断');
    expect(screen.getByText('Artifact Evidence Regression')).toBeInTheDocument();
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

  it('shows loop diagnostics and can trigger the built-in loop from developer settings', async () => {
    render(
      <LocaleProvider>
        <DeveloperSettings />
      </LocaleProvider>,
    );

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

  it('shows already-running state when a manual loop trigger collides with an active run', async () => {
    mocks.runLoopNow.mockResolvedValueOnce({
      status: 'already_running',
      activeRunId: 'run-active',
    });

    render(
      <LocaleProvider>
        <DeveloperSettings />
      </LocaleProvider>,
    );

    await screen.findByText('Artifact Evidence Regression');
    fireEvent.click(screen.getByLabelText('run-loop-artifact-evidence-regression'));

    await screen.findByText('已有运行中');
    expect(screen.getByLabelText('run-loop-artifact-evidence-regression')).toBeDisabled();
  });
});
