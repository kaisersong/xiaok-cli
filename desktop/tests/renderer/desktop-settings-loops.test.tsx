import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutomationsPage } from '../../renderer/src/components/automations/AutomationsPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getServiceStatus: vi.fn(),
  restartRelatedService: vi.fn(),
  getLoopDefinitions: vi.fn(),
  getLoopRuns: vi.fn(),
  getEvidenceAnomalies: vi.fn(),
  runLoopNow: vi.fn(),
  listUserLoopTemplates: vi.fn(),
  getLoopScheduleBindings: vi.fn(),
  createUserLoopTemplate: vi.fn(),
  createLoopSchedule: vi.fn(),
  getAutomationOverviewSnapshot: vi.fn(),
  getAutomationsConfig: vi.fn(),
  setGlobalBackgroundAutoRun: vi.fn(),
  openLoopOutputDirectory: vi.fn(),
  readLoopOutputPreview: vi.fn(),
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
    getLoopScheduleBindings: mocks.getLoopScheduleBindings,
    createUserLoopTemplate: mocks.createUserLoopTemplate,
    createLoopSchedule: mocks.createLoopSchedule,
    getAutomationOverviewSnapshot: mocks.getAutomationOverviewSnapshot,
    getAutomationsConfig: mocks.getAutomationsConfig,
    setGlobalBackgroundAutoRun: mocks.setGlobalBackgroundAutoRun,
    openLoopOutputDirectory: mocks.openLoopOutputDirectory,
    readLoopOutputPreview: mocks.readLoopOutputPreview,
    getAccountSettings: mocks.getAccountSettings,
    updateAccountSettings: mocks.updateAccountSettings,
  },
}));

function renderSettings() {
  render(
    <MemoryRouter initialEntries={['/automations/loops']}>
      <LocaleProvider>
        <Routes>
          <Route path="/automations/:tab" element={<AutomationsPage />} />
        </Routes>
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('Automations Loops page', () => {
  beforeEach(() => {
    mocks.getServiceStatus.mockResolvedValue({
      checkedAt: 1779545079000,
      services: [],
    });
    mocks.restartRelatedService.mockResolvedValue(undefined);
    mocks.getAutomationOverviewSnapshot.mockResolvedValue({
      generatedAt: 10_000,
      globalBackgroundAutoRunEnabled: true,
      totals: {
        loops: 2,
        userLoops: 1,
        schedules: 0,
        activeSchedules: 0,
        diagnostics: 0,
        recentFailures: 0,
      },
      recentFailures: [],
    });
    mocks.getAutomationsConfig.mockResolvedValue({ globalBackgroundAutoRunEnabled: true });
    mocks.setGlobalBackgroundAutoRun.mockResolvedValue({ globalBackgroundAutoRunEnabled: false });
    mocks.getLoopDefinitions.mockResolvedValue([
      {
        id: 'artifact-evidence-regression',
        title: 'Artifact Evidence Regression',
        description: 'Checks artifact completion evidence flows for regressions.',
        status: 'active',
        origin: 'built_in',
        createdAt: 1_000,
        updatedAt: 2_000,
      },
      {
        id: 'user-loop-1',
        title: 'Weekly Briefing',
        description: 'Writes a weekly markdown briefing.',
        status: 'active',
        origin: 'user_template',
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopRuns.mockResolvedValue([]);
    mocks.getEvidenceAnomalies.mockResolvedValue([]);
    mocks.runLoopNow.mockResolvedValue({
      status: 'success',
      run: {
        id: 'run-user-loop',
        loopId: 'user-loop-1',
        status: 'success',
        trigger: { kind: 'manual' },
        evidenceIds: ['ev-file'],
        startedAt: 3_000,
        finishedAt: 4_000,
        updatedAt: 4_000,
      },
    });
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        kind: 'markdown_file',
        prompt: 'Summarize the week.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'briefing.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopScheduleBindings.mockResolvedValue([]);
    mocks.createUserLoopTemplate.mockResolvedValue({
      template: {
        loopId: 'new-loop',
        kind: 'markdown_file',
        prompt: 'Write a report.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'report.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 5_000,
        updatedAt: 5_000,
      },
      ignoredLegacyScheduleFields: [],
    });
    mocks.createLoopSchedule.mockResolvedValue({
      id: 'loop-schedule',
      title: 'Weekly Briefing schedule',
      status: 'active',
      trigger: { kind: 'interval', everyMs: 3_600_000 },
      executor: { kind: 'loop', loopId: 'user-loop-1' },
      createdAt: 5_000,
      updatedAt: 5_000,
    });
    mocks.openLoopOutputDirectory.mockResolvedValue({ ok: true });
    mocks.readLoopOutputPreview.mockResolvedValue({
      ok: true,
      loopId: 'user-loop-1',
      pathLabel: '/tmp/xiaok-loop/briefing.md',
      content: '# Weekly Briefing\n\nReady.',
      sizeBytes: 27,
      truncated: false,
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
  });

  it('shows user Markdown loops with output path and reuses Run now from the Loops page', async () => {
    renderSettings();

    await screen.findByText('用户循环');
    expect(screen.getByText('Weekly Briefing')).toBeInTheDocument();
    expect(screen.getByText('/tmp/xiaok-loop')).toBeInTheDocument();
    expect(screen.getByText('briefing.md')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/xiaok-loop/briefing.md')).not.toBeInTheDocument();
    expect(screen.queryByText('Loop 诊断')).not.toBeInTheDocument();
    expect(screen.queryByText('Artifact Evidence Regression')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('run-loop-user-loop-1'));

    await waitFor(() => {
      expect(mocks.runLoopNow).toHaveBeenCalledWith('user-loop-1');
    });
  });

  it('opens the output directory and previews the output file through loopId-based APIs', async () => {
    renderSettings();

    await screen.findByText('Weekly Briefing');

    fireEvent.click(screen.getByRole('button', { name: '打开输出目录: Weekly Briefing' }));
    await waitFor(() => {
      expect(mocks.openLoopOutputDirectory).toHaveBeenCalledWith('user-loop-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '预览输出文件: Weekly Briefing' }));
    await waitFor(() => {
      expect(mocks.readLoopOutputPreview).toHaveBeenCalledWith('user-loop-1');
    });
    expect(await screen.findByText('# Weekly Briefing')).toBeInTheDocument();
    expect(screen.getByText('Ready.')).toBeInTheDocument();
  });

  it('shows duplicate schedule bindings on user loop cards without selecting a primary schedule', async () => {
    mocks.getLoopScheduleBindings.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        kind: 'multiple',
        count: 2,
        activeCount: 1,
        actionIds: ['loop-schedule-a', 'loop-schedule-b'],
        schedules: [
          { id: 'loop-schedule-a', title: 'Morning Loop', status: 'active', trigger: { kind: 'daily', hour: 9, minute: 0 }, updatedAt: 3_000 },
          { id: 'loop-schedule-b', title: 'Evening Loop', status: 'paused', trigger: { kind: 'daily', hour: 18, minute: 0 }, updatedAt: 4_000 },
        ],
      },
    ]);

    renderSettings();

    expect(await screen.findByText('Weekly Briefing')).toBeTruthy();
    expect(screen.getByText(/多个计划/)).toBeTruthy();
    expect(screen.getByText(/2 计划/)).toBeTruthy();
    expect(screen.queryByText('Morning Loop')).toBeNull();
    expect(screen.queryByText('Evening Loop')).toBeNull();
  });

  it('creates a Markdown loop template from the Loops page without schedule fields', async () => {
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '新建 Markdown 循环' }));

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Daily Report' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Write a short daily report.' } });
    fireEvent.change(screen.getByLabelText('输出目录'), { target: { value: '/tmp/xiaok-loop' } });
    fireEvent.change(screen.getByLabelText('输出文件名'), { target: { value: 'daily.md' } });
    fireEvent.click(screen.getByRole('button', { name: '创建循环' }));

    await waitFor(() => {
      expect(mocks.createUserLoopTemplate).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Daily Report',
        kind: 'markdown_file',
        prompt: 'Write a short daily report.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'daily.md',
      }));
    });
    expect(mocks.createUserLoopTemplate.mock.calls[0][0]).not.toHaveProperty('scheduleEnabled');
    expect(mocks.createUserLoopTemplate.mock.calls[0][0]).not.toHaveProperty('scheduleTrigger');
    expect(mocks.createUserLoopTemplate.mock.calls[0][0]).not.toHaveProperty('autoRunApproved');
  });
});
