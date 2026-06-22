import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';

import { App } from '../../renderer/src/App';

vi.mock('../../renderer/src/hooks/useScheduledTaskBootstrap', () => ({
  useScheduledTaskBootstrap: vi.fn(),
}));

vi.mock('../../renderer/src/layouts/AppLayout', () => ({
  AppLayout: () => <Outlet />,
}));

vi.mock('../../renderer/src/components/WelcomePage', () => ({
  WelcomePage: () => <div data-testid="welcome-page" />,
}));

vi.mock('../../renderer/src/components/ChatShell', () => ({
  ChatShell: () => <div data-testid="chat-shell" />,
}));

vi.mock('../../renderer/src/components/projects/ProjectsPage', () => ({
  ProjectsPage: () => <div data-testid="projects-page" />,
}));

vi.mock('../../renderer/src/components/projects/ProjectDetailPage', () => ({
  ProjectDetailPage: () => <div data-testid="project-detail-page" />,
}));

vi.mock('../../renderer/src/components/ScheduledPage', () => ({
  ScheduledPage: ({ embedded = false }: { embedded?: boolean }) => (
    <div data-testid="scheduled-page" data-embedded={String(embedded)} />
  ),
}));

vi.mock('../../renderer/src/contexts/LocaleContext', () => ({
  LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocale: () => ({
    t: {
      automationsTitle: '自动化',
      automationsSubtitle: '循环、计划和诊断集中在这里管理。',
      automationsOverview: '总览',
      automationsSchedules: '计划',
      automationsLoops: '循环',
      automationsDiagnostics: '诊断',
      automationsOverviewTitle: '自动化总览',
      automationsOverviewDesc: '查看最近运行、失败和需要处理的循环。',
      automationsSchedulesDesc: '计划由现有定时任务能力提供。',
      automationsLoopsDesc: '创建、运行和检查用户循环。',
      automationsDiagnosticsDesc: '查看自动化运行健康状态。',
      automationsGlobalAutoRunEnabled: '后台自动运行已开启',
      automationsGlobalAutoRunDisabled: '后台自动运行已暂停',
      automationsGlobalAutoRunPause: '暂停后台自动运行',
      automationsGlobalAutoRunEnable: '启用后台自动运行',
      automationsGlobalAutoRunDesc: '关闭后，计划里的循环和自动任务会记录跳过，不会在后台执行；提醒仍会触发。',
      automationsOverviewRecentFailures: '最近需要处理',
      automationsOverviewNoRecentFailures: '暂无需要处理的自动化运行。',
      automationsOverviewLoopsCount: '循环',
      automationsOverviewSchedulesCount: '计划',
      automationsOverviewFailuresCount: '待处理',
    },
  }),
}));

vi.mock('../../renderer/src/themes/presets', () => ({
  BUILTIN_PRESETS: {},
}));

vi.mock('../../renderer/src/themes/types', () => ({
  COLOR_GROUPS: [],
}));

vi.mock('../../renderer/src/contexts/AppearanceContext', () => ({
  useAppearance: () => ({
    fontFamily: 'default',
    codeFontFamily: 'jetbrains-mono',
    fontSize: 'normal',
    themePreset: 'default',
    customThemeId: null,
    customThemes: {},
    setFontFamily: () => {},
    setCodeFontFamily: () => {},
    setFontSize: () => {},
    setThemePreset: () => {},
    setActiveCustomTheme: () => {},
    saveCustomTheme: () => {},
    deleteCustomTheme: () => {},
    setPreviewVars: () => {},
    setCustomBodyFont: () => {},
    customBodyFont: null,
    activeThemeVars: { dark: {}, light: {} },
  }),
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const apiMocks = vi.hoisted(() => ({
  getAutomationOverviewSnapshot: vi.fn(),
  getAutomationsConfig: vi.fn(),
  setGlobalBackgroundAutoRun: vi.fn(),
}));

vi.mock('../../renderer/src/api', () => ({
  api: apiMocks,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderApp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Automations navigation', () => {
  beforeEach(() => {
    apiMocks.getAutomationOverviewSnapshot.mockResolvedValue({
      generatedAt: 10_000,
      globalBackgroundAutoRunEnabled: true,
      totals: {
        loops: 3,
        userLoops: 1,
        schedules: 2,
        activeSchedules: 1,
        diagnostics: 1,
        recentFailures: 1,
      },
      recentFailures: [
        {
          id: 'loop-run:run-failed',
          source: 'loop_run',
          ownerId: 'briefing-loop',
          title: 'Briefing Loop',
          status: 'failed',
          message: 'Output file was not created.',
          occurredAt: 9_000,
        },
      ],
    });
    apiMocks.getAutomationsConfig.mockResolvedValue({ globalBackgroundAutoRunEnabled: true });
    apiMocks.setGlobalBackgroundAutoRun.mockResolvedValue({ globalBackgroundAutoRunEnabled: false });
  });

  it('renders the Automations page with Phase 1 tabs', async () => {
    renderApp('/automations');

    expect(await screen.findByRole('heading', { name: '自动化' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '总览' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '计划' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '循环' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '诊断' })).toBeInTheDocument();
  });

  it('renders overview counts and recent failures from the main-process snapshot', async () => {
    renderApp('/automations');

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('循环').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('计划').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('待处理')).toBeInTheDocument();
    expect(screen.getByText('最近需要处理')).toBeInTheDocument();
    expect(screen.getByText('Briefing Loop')).toBeInTheDocument();
    expect(screen.getByText('Output file was not created.')).toBeInTheDocument();
    expect(apiMocks.getAutomationOverviewSnapshot).toHaveBeenCalledTimes(1);
  });

  it('shows and toggles the global background auto-run gate on the overview', async () => {
    renderApp('/automations');

    expect(await screen.findByText('后台自动运行已开启')).toBeInTheDocument();
    expect(screen.getByText('关闭后，计划里的循环和自动任务会记录跳过，不会在后台执行；提醒仍会触发。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '暂停后台自动运行' }));

    await waitFor(() => {
      expect(apiMocks.setGlobalBackgroundAutoRun).toHaveBeenCalledWith({ enabled: false });
    });
    expect(await screen.findByText('后台自动运行已暂停')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用后台自动运行' })).toBeInTheDocument();
  });

  it('redirects the legacy scheduled route into Automations schedules', async () => {
    renderApp('/scheduled');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/automations/schedules');
    });
    expect(screen.getByTestId('scheduled-page')).toHaveAttribute('data-embedded', 'true');
  });
});
