import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  createThread: vi.fn(),
  createTask: vi.fn(),
  createTaskWithFiles: vi.fn(),
  updateThreadTaskId: vi.fn(),
  getAutomationOverviewSnapshot: vi.fn(),
  kswarm: {
    connected: true,
    projectsLoaded: true,
    serviceStatus: { running: true, port: 4319, pid: 1, restartCount: 0, lastError: null } as {
      running: boolean;
      port: number;
      pid: number | null;
      restartCount: number;
      lastError: string | null;
    } | null,
    projects: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('../../renderer/src/api', () => ({ api: mocks }));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => mocks.kswarm,
}));

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: ({ placeholder, autoFocus }: { placeholder?: string; autoFocus?: boolean }) => (
    <input data-testid="chat-input" placeholder={placeholder} autoFocus={autoFocus} />
  ),
}));

import { WelcomePage } from '../../renderer/src/components/WelcomePage';

const PROJECTS = [
  {
    id: 'project-risk',
    name: 'Q2 上线计划风险评估',
    status: 'active',
    taskCount: 3,
    doneCount: 1,
    stoppedCount: 1,
    projectIntervention: {
      required: true,
      message: '需要确认风险优先级',
      primaryAction: { id: 'continue_project', label: '确认风险边界' },
    },
  },
  {
    id: 'project-research',
    name: '用户反馈分析',
    status: 'active',
    taskCount: 2,
    doneCount: 1,
  },
  {
    id: 'project-done',
    name: 'API 性能优化',
    status: 'delivered',
  },
];

function automationSnapshot() {
  return {
    generatedAt: 10_000,
    sourceVersions: { loopStore: 1, timedActionStore: 1 },
    globalBackgroundAutoRunEnabled: true,
    totals: {
      loops: 2,
      userLoops: 2,
      schedules: 2,
      activeSchedules: 1,
      diagnostics: 0,
      recentFailures: 1,
    },
    recentFailures: [{
      id: 'failure-1',
      source: 'timed_action_run',
      ownerId: 'schedule-1',
      actionId: 'schedule-1',
      title: '电商价格监控',
      status: 'failed',
      message: '发现 3 个价格异常',
      occurredAt: 9_000,
    }],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocaleProvider>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="*" element={<LocationDump />} />
        </Routes>
      </LocaleProvider>
    </MemoryRouter>,
  );
}

function LocationDump() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.hash}</div>;
}

describe('WelcomePage conversation-first home', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.kswarm.connected = true;
    mocks.kswarm.projectsLoaded = true;
    mocks.kswarm.serviceStatus = { running: true, port: 4319, pid: 1, restartCount: 0, lastError: null };
    mocks.kswarm.projects = PROJECTS.map(project => ({ ...project }));
    mocks.getAutomationOverviewSnapshot.mockResolvedValue(automationSnapshot());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders one neutral conversation-first home without A/B controls', async () => {
    renderPage();

    expect(screen.getByTestId('welcome-home')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-home-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('welcome-home-b')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /方案 [AB]/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toHaveFocus();
    expect(screen.getByRole('region', { name: '工作概览' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '待处理 / 继续工作' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('welcome-metric-active-projects')).toHaveTextContent('2');
      expect(screen.getByTestId('welcome-metric-attention')).toHaveTextContent('2');
      expect(screen.getByTestId('welcome-metric-automations')).toHaveTextContent('1');
      expect(screen.getByTestId('welcome-metric-completed')).toHaveTextContent('1');
    });
  });

  it('keeps conversation content before the scrollable work summary', () => {
    renderPage();

    const orderedNodes = [
      screen.getByRole('heading', { level: 1 }),
      screen.getByTestId('chat-input'),
      screen.getByTestId('quick-prompts'),
      document.getElementById('welcome-overview-title'),
      document.getElementById('welcome-continue-title'),
    ];

    for (let index = 0; index < orderedNodes.length - 1; index += 1) {
      const current = orderedNodes[index];
      const next = orderedNodes[index + 1];
      expect(current).not.toBeNull();
      expect(next).not.toBeNull();
      expect(current!.compareDocumentPosition(next!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('ignores a persisted B selection and still renders the single home', () => {
    localStorage.setItem('xiaok:welcome-home-variant', 'b');
    renderPage();

    expect(screen.getByTestId('welcome-home')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-home-b')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /方案 [AB]/ })).not.toBeInTheDocument();
  });

  it('preserves project reason and next step on the single home', async () => {
    renderPage();

    const projectItem = await screen.findByRole('button', { name: /打开关注事项：Q2 上线计划风险评估.*需要确认风险优先级.*确认风险边界/ });
    expect(within(projectItem).getByText('需要确认风险优先级')).toBeInTheDocument();
    expect(within(projectItem).getByText('下一步：确认风险边界')).toBeInTheDocument();
    expect(within(projectItem).getAllByText(/确认风险边界/)).toHaveLength(1);
  });

  it('opens project, schedule, and user-loop attention routes', async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /打开关注事项：Q2 上线计划风险评估/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/project-risk');

    view.unmount();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /打开关注事项：电商价格监控/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/automations/schedules#task-schedule-1');

    cleanup();
    mocks.getAutomationOverviewSnapshot.mockResolvedValue({
      ...automationSnapshot(),
      totals: { ...automationSnapshot().totals, schedules: 0, activeSchedules: 0 },
      recentFailures: [{
        id: 'loop-failure-1',
        source: 'loop_run',
        ownerId: 'weekly-review',
        loopId: 'weekly-review',
        loopOrigin: 'user_template',
        title: '每周项目复盘',
        status: 'failed',
        message: '输出文件缺失',
        occurredAt: 9_000,
      }],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /打开关注事项：每周项目复盘/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/automations/loops#loop-weekly-review');
  });

  it('limits attention summary to three items', async () => {
    mocks.kswarm.projects = Array.from({ length: 4 }, (_, index) => ({
      id: `attention-${index}`,
      name: `待处理项目 ${index + 1}`,
      status: 'active',
      projectIntervention: { required: true, message: `问题 ${index + 1}` },
    }));
    mocks.getAutomationOverviewSnapshot.mockResolvedValue({
      ...automationSnapshot(),
      totals: { ...automationSnapshot().totals, recentFailures: 0 },
      recentFailures: [],
    });
    renderPage();

    const attentionSummary = await screen.findByRole('region', { name: '待处理 / 继续工作' });
    expect(within(attentionSummary).getAllByRole('button', { name: /^打开关注事项：/ })).toHaveLength(3);
  });

  it('keeps the chat entry usable when automation overview fails', async () => {
    mocks.kswarm.projects = PROJECTS.filter(project => !('projectIntervention' in project));
    mocks.getAutomationOverviewSnapshot.mockRejectedValue(new Error('overview unavailable'));
    renderPage();

    expect(screen.getByTestId('chat-input')).toHaveAttribute('placeholder', '描述你的工作需求...');
    await waitFor(() => expect(screen.getAllByText('自动化摘要暂不可用')).toHaveLength(1));
    expect(screen.getByTestId('welcome-metric-automations')).toHaveTextContent('—');
  });

  it('shows unknown automation metrics while the overview is loading', () => {
    mocks.getAutomationOverviewSnapshot.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByTestId('welcome-metric-automations')).toHaveTextContent('—');
    expect(screen.getByTestId('welcome-metric-attention')).toHaveTextContent('—');
    expect(screen.getByText('自动化摘要加载中')).toBeInTheDocument();
  });

  it('shows known zero project metrics after the project snapshot loads empty', async () => {
    mocks.kswarm.connected = false;
    mocks.kswarm.projectsLoaded = true;
    mocks.kswarm.projects = [];
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('welcome-metric-active-projects')).toHaveTextContent('0');
      expect(screen.getByTestId('welcome-metric-completed')).toHaveTextContent('0');
    });
    expect(screen.queryByText('项目数据暂不可用')).not.toBeInTheDocument();
  });

  it('keeps project-derived metrics unknown before the first project snapshot', async () => {
    mocks.kswarm.connected = false;
    mocks.kswarm.projectsLoaded = false;
    mocks.kswarm.serviceStatus = null;
    mocks.kswarm.projects = [];
    renderPage();

    expect(await screen.findByText('项目数据暂不可用')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-metric-active-projects')).toHaveTextContent('—');
    expect(screen.getByTestId('welcome-metric-attention')).toHaveTextContent('—');
    expect(screen.getByTestId('welcome-metric-completed')).toHaveTextContent('—');
  });
});
