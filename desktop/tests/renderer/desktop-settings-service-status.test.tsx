import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
  createLoopSchedule: vi.fn(),
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
    createLoopSchedule: mocks.createLoopSchedule,
    getAccountSettings: mocks.getAccountSettings,
    updateAccountSettings: mocks.updateAccountSettings,
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSettings(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/settings-test']}>
      <LocaleProvider>
        <DesktopSettings onClose={onClose} />
        <LocationProbe />
      </LocaleProvider>
    </MemoryRouter>,
  );
  return { onClose };
}

describe('DesktopSettings service status', () => {
  beforeEach(() => {
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
    mocks.listUserLoopTemplates.mockResolvedValue([]);
    mocks.createUserLoopTemplate.mockResolvedValue({
      template: {
        loopId: 'new-loop',
        kind: 'markdown_file',
        prompt: 'Write a report.',
        outputDirectory: '/tmp/xiaok-loops',
        outputFileName: 'report.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 8_000,
        updatedAt: 8_000,
      },
      ignoredLegacyScheduleFields: [],
    });
    mocks.createLoopSchedule.mockResolvedValue({
      id: 'schedule-new-loop',
      title: 'New loop schedule',
      status: 'active',
      trigger: { kind: 'interval', everyMs: 3_600_000 },
      executor: { kind: 'loop', loopId: 'new-loop' },
      createdAt: 8_000,
      updatedAt: 8_000,
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
    renderSettings();

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

  it('links to Automations instead of exposing loop runtime controls in Settings', async () => {
    const { onClose } = renderSettings();

    await screen.findByText('服务状态');
    expect(screen.queryByRole('button', { name: '循环' })).not.toBeInTheDocument();
    expect(screen.queryByText('Loop 诊断')).not.toBeInTheDocument();
    expect(mocks.getLoopDefinitions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '打开自动化' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/automations/loops');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
