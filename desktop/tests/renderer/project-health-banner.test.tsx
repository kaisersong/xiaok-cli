import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail, mockDeleteProject, mockRetryPlan, mockDispatchTasks, mockShowSaveDialog, mockSaveFile } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockDeleteProject: vi.fn(),
  mockRetryPlan: vi.fn(),
  mockDispatchTasks: vi.fn(),
  mockShowSaveDialog: vi.fn(),
  mockSaveFile: vi.fn(),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    connected: true,
    agents: [],
    getProjectFullDetail: mockGetProjectFullDetail,
    approveProject: vi.fn(),
    retryPlan: mockRetryPlan,
    dispatchTasks: mockDispatchTasks,
    deliverProject: vi.fn(),
    closeProject: vi.fn(),
    deleteProject: mockDeleteProject,
  }),
}));

vi.mock('../../renderer/src/components/projects/KanbanBoard', () => ({
  KanbanBoard: () => <div>kanban</div>,
}));
vi.mock('../../renderer/src/components/projects/PlanView', () => ({
  PlanView: () => <div>plan</div>,
}));
vi.mock('../../renderer/src/components/projects/ActivityTimeline', () => ({
  ActivityTimeline: () => <div>activity</div>,
}));
vi.mock('../../renderer/src/components/projects/DeliverableView', () => ({
  DeliverableView: () => <div>deliverables</div>,
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    showSaveDialog: mockShowSaveDialog,
    saveFile: mockSaveFile,
  }),
}));

import { ProjectCard } from '../../renderer/src/components/projects/ProjectCard';
import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { ProjectProgressCard } from '../../renderer/src/components/projects/ProjectProgressCard';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function loadFixture(name: string): ProjectFullDetail {
  const path = join(process.cwd(), '..', 'tests', 'fixtures', 'kswarm', name);
  return JSON.parse(readFileSync(path, 'utf8')) as ProjectFullDetail;
}

function renderWithProviders(ui: React.ReactNode, initialPath = '/') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        {ui}
      </MemoryRouter>
    </LocaleProvider>
  );
}

function retryableDetail(): ProjectFullDetail {
  return {
    project: {
      id: 'proj-retry',
      name: '卡住的项目',
      goal: '让 PO 重新制定计划',
      status: 'created',
      poAgent: 'xiaok',
      createdAt: '1779000000000',
      updatedAt: '1779000000000',
    },
    tasks: [],
    activities: [],
    humanActions: [],
    workspace: { path: '/tmp/proj-retry', artifacts: [] },
    plan: null,
    planProgress: null,
  };
}

function renderProjectDetail(detail: ProjectFullDetail) {
  mockGetProjectFullDetail.mockResolvedValue(detail);
  renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
    </Routes>,
    `/projects/${detail.project.id}`
  );
}

describe('project health status UI', () => {
  it('renders a blocked project health banner with primary task and recommended action', async () => {
    const detail = loadFixture('full-detail-blocked-project.json');
    mockGetProjectFullDetail.mockResolvedValue(detail);

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      `/projects/${detail.project.id}`
    );

    await waitFor(() => expect(screen.getByText('项目阻塞')).toBeInTheDocument());
    expect(screen.getByText(/结构评审缺少证据/)).toBeInTheDocument();
    expect(screen.getByText(/item-6/)).toBeInTheDocument();
    expect(screen.getByText('诊断')).toBeInTheDocument();
    expect(screen.getByText('派发未阻塞任务')).toBeInTheDocument();
  });

  it('shows project health on project list cards', () => {
    renderWithProviders(
      <ProjectCard
        project={{
          id: 'proj-1',
          name: '技术大会演讲报告',
          status: 'active',
          taskCount: 4,
          doneCount: 1,
          projectHealth: {
            status: 'failed',
            message: '最终校验失败',
            primaryBlockedTaskId: 'item-8',
          },
        }}
      />
    );

    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText(/最终校验失败/)).toBeInTheDocument();
  });

  it('shows simplified intervention state on project list cards', () => {
    renderWithProviders(
      <ProjectCard
        project={{
          id: 'proj-1',
          name: '外贸趋势分析',
          status: 'active',
          taskCount: 4,
          doneCount: 0,
          projectIntervention: {
            required: true,
            headline: '需要处理',
            message: '确定数据源与假设基线 执行失败，后续 2 个任务正在等待它。',
            primaryTaskId: 'item-1',
            primaryAction: { id: 'continue_project', label: '继续推进' },
            secondaryAction: { id: 'ask_xiaok', label: '问小K' },
          },
        }}
      />
    );

    expect(screen.getByText('需要处理')).toBeInTheDocument();
    expect(screen.getByText(/后续 2 个任务/)).toBeInTheDocument();
  });

  it('shows dispatch plan counters on inline project progress cards', () => {
    renderWithProviders(
      <ProjectProgressCard
        project={{
          id: 'proj-1',
          name: '技术大会演讲报告',
          status: 'active',
          taskCount: 4,
          doneCount: 1,
          dispatchPlan: {
            dispatchable: [{ taskId: 'item-7' }],
            blocked: [{ taskId: 'item-6', reason: 'missing_review_evidence' }],
            waiting: [{ taskId: 'item-8', reason: 'quality_retry_required' }],
          },
          projectHealth: {
            status: 'blocked',
            message: '结构评审缺少证据',
          },
        }}
      />
    );

    expect(screen.getByText('阻塞')).toBeInTheDocument();
    expect(screen.getByText('可派发 1')).toBeInTheDocument();
    expect(screen.getByText('阻塞 1')).toBeInTheDocument();
    expect(screen.getByText('等待 1')).toBeInTheDocument();
  });
});

describe('project plan retry feedback', () => {
  it('shows immediate retry feedback and ignores repeated clicks while retry is in progress', async () => {
    const detail = retryableDetail();
    let resolveRetry: (value: { ok: boolean; retried: boolean }) => void = () => {};
    mockRetryPlan.mockReturnValue(new Promise(resolve => {
      resolveRetry = resolve;
    }));
    renderProjectDetail(detail);

    const retryButton = await screen.findByRole('button', { name: '重新制定计划' });
    fireEvent.click(retryButton);

    expect(await screen.findByText('正在通知 PO 重新制定计划...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在发起' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '正在发起' }));
    expect(mockRetryPlan).toHaveBeenCalledTimes(1);

    resolveRetry({ ok: true, retried: true });
  });

  it('shows reassigned PO success feedback and keeps retry disabled during the cooldown', async () => {
    const detail = retryableDetail();
    mockRetryPlan.mockResolvedValue({
      ok: true,
      retried: true,
      poReassigned: true,
      poAgent: 'xiaok-po',
    });
    renderProjectDetail(detail);

    fireEvent.click(await screen.findByRole('button', { name: '重新制定计划' }));

    expect(await screen.findByText('已改派到 xiaok-po 并重新制定计划，正在等待 PO 提交新计划。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已发起' })).toBeDisabled();
  });

  it('shows failure feedback and allows retry again', async () => {
    const detail = retryableDetail();
    mockRetryPlan.mockResolvedValue(null);
    renderProjectDetail(detail);

    fireEvent.click(await screen.findByRole('button', { name: '重新制定计划' }));

    expect(await screen.findByText('重新制定计划失败，请稍后重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新制定计划' })).not.toBeDisabled();
  });
});

describe('project manual dispatch', () => {
  it('shows dispatch when the backend marks a blocked rework task dispatchable', async () => {
    const detail = retryableDetail();
    detail.project.status = 'active';
    detail.tasks = [{
      id: 'proj-story__item-2.1',
      title: '撰写故事初稿',
      status: 'blocked',
      blockKind: 'quality_gate_blocked',
      blockedReason: '缺少故事正文',
      activeRunId: null,
    } as any];
    (detail as any).dispatchPlan = {
      projectId: detail.project.id,
      dispatchedTasks: [{
        id: 'proj-story__item-2.1',
        title: '撰写故事初稿',
        status: 'blocked',
        blockKind: 'quality_gate_blocked',
        activeRunId: null,
      }],
      blocked: [],
      skipped: [],
      projectGate: null,
    };
    mockDispatchTasks.mockResolvedValue({ dispatched: ['proj-story__item-2.1'] });
    renderProjectDetail(detail);

    const dispatchButton = await screen.findByRole('button', { name: '分发任务' });
    fireEvent.click(dispatchButton);

    await waitFor(() => {
      expect(mockDispatchTasks).toHaveBeenCalledWith(detail.project.id, detail.project.poAgent);
    });
  });
});

describe('project detail clipped text hover', () => {
  it('delays full goal and requirements tooltip until the user keeps hovering', async () => {
    const detail = retryableDetail();
    detail.project.goal = '目标：写一个足够真实的 AI 工作小故事，必须包含人物、工作场景、技术限制、意外错误和解决过程。';
    (detail.project as any).requirements = '要求：500 到 800 字；语言自然；避免空泛口号；必须经过两轮真实性评审，并记录修改依据。';
    renderProjectDetail(detail);

    await screen.findByText(detail.project.goal);
    vi.useFakeTimers();
    const goal = screen.getByTestId('project-goal-preview');
    fireEvent.mouseEnter(goal);

    expect(screen.queryByTestId('project-detail-hover-tooltip')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(screen.queryByTestId('project-detail-hover-tooltip')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('project-detail-hover-tooltip')).toHaveTextContent('目标：写一个足够真实的 AI 工作小故事');

    fireEvent.mouseLeave(goal);
    expect(screen.queryByTestId('project-detail-hover-tooltip')).not.toBeInTheDocument();

    const requirements = screen.getByTestId('project-requirements-preview');
    fireEvent.mouseEnter(requirements);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByTestId('project-detail-hover-tooltip')).toHaveTextContent('要求：500 到 800 字');
  });
});

describe('project detail export', () => {
  it('exports project markdown through the desktop save flow with visible feedback', async () => {
    const detail = retryableDetail();
    detail.project.status = 'active';
    detail.tasks = [{ id: 'task-1', title: '完成任务', status: 'done' } as any];
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/proj-retry.md' });
    mockSaveFile.mockResolvedValue(undefined);

    renderProjectDetail(detail);

    fireEvent.click(await screen.findByRole('button', { name: '导出项目' }));

    await waitFor(() => expect(mockShowSaveDialog).toHaveBeenCalledWith({
      defaultPath: '卡住的项目.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    }));
    expect(mockSaveFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/tmp/proj-retry.md',
      content: expect.stringContaining('卡住的项目'),
    }));
    expect(await screen.findByText(/已导出项目报告/)).toBeInTheDocument();
  });
});
