import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail, mockContinueProject } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockContinueProject: vi.fn(),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    connected: true,
    agents: [],
    getProjectFullDetail: mockGetProjectFullDetail,
    approveProject: vi.fn(),
    retryPlan: vi.fn(),
    dispatchTasks: vi.fn(),
    deliverProject: vi.fn(),
    closeProject: vi.fn(),
    deleteProject: vi.fn(),
    continueProject: mockContinueProject,
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
  getDesktopApi: () => ({}),
}));

import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

function renderProjectDetail(detail: ProjectFullDetail) {
  mockGetProjectFullDetail.mockResolvedValue(detail);
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[`/projects/${detail.project.id}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>
  );
}

function interventionDetail(overrides: Partial<ProjectFullDetail['projectIntervention']> = {}): ProjectFullDetail {
  return {
    project: {
      id: 'proj-intervention',
      name: '外贸趋势分析',
      goal: '分析本月外贸趋势',
      status: 'active',
      poAgent: 'po',
      createdAt: '1779000000000',
      updatedAt: '1779000000000',
    },
    tasks: [
      {
        id: 'item-1',
        title: '确定数据源与假设基线',
        status: 'failed',
        assignedAgent: 'cli-codex',
        failureReason: 'agent_error',
        updatedAt: '1779093510355',
      } as any,
      { id: 'item-2', title: '生成模拟数据集', status: 'pending' } as any,
    ],
    activities: [],
    humanActions: [],
    workspace: { path: '/tmp/proj-intervention', artifacts: [] },
    plan: null,
    planProgress: null,
    projectIntervention: {
      required: true,
      headline: '需要处理',
      message: '确定数据源与假设基线 执行失败，后续 1 个任务正在等待它。',
      primaryTaskId: 'item-1',
      primaryTaskTitle: '确定数据源与假设基线',
      lastEventAt: 1779093510355,
      downstreamBlockedCount: 1,
      primaryFailure: {
        reason: 'agent_error',
        feedback: 'CLI failed',
        assignedAgent: 'cli-codex',
        status: 'failed',
        qualityFailureCount: 0,
      },
      primaryAction: {
        id: 'continue_project',
        label: '继续推进',
        strategy: 'retry_best_agent',
        taskId: 'item-1',
        taskUpdatedAt: 1779093510355,
      },
      secondaryAction: {
        id: 'ask_xiaok',
        label: '问小K',
        context: {
          projectId: 'proj-intervention',
          projectName: '外贸趋势分析',
          taskId: 'item-1',
          taskTitle: '确定数据源与假设基线',
          downstreamBlockedCount: 1,
          lastFailure: 'CLI failed',
        },
      },
      ...overrides,
    } as any,
  };
}

describe('project intervention actions', () => {
  it('renders only continue and ask xiaok as primary user actions', async () => {
    renderProjectDetail(interventionDetail());

    expect(await screen.findByText('需要处理')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续推进' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '问小K' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看原因' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /人工放行/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /跳过/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /换 Agent/ })).not.toBeInTheDocument();
  });

  it('opens a read-only reason drawer', async () => {
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '查看原因' }));

    expect(screen.getByRole('dialog', { name: '处理原因' })).toBeInTheDocument();
    expect(screen.getByText(/CLI failed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /人工放行|跳过|换 Agent/ })).not.toBeInTheDocument();
  });

  it('calls continueProject with expected stale-state guards', async () => {
    mockContinueProject.mockResolvedValue({ ok: true, strategy: 'retry_best_agent', dispatched: ['item-1'] });
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '继续推进' }));

    await waitFor(() => {
      expect(mockContinueProject).toHaveBeenCalledWith('proj-intervention', expect.objectContaining({
        expectedPrimaryTaskId: 'item-1',
        expectedTaskUpdatedAt: 1779093510355,
        idempotencyKey: expect.stringMatching(/^continue-proj-intervention-/),
      }));
    });
  });

  it('stores xiaok context when the user asks xiaok', async () => {
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '问小K' }));

    const stored = JSON.parse(window.sessionStorage.getItem('xiaok.swarmContinueContext') || '{}');
    expect(stored.projectId).toBe('proj-intervention');
    expect(stored.taskId).toBe('item-1');
    expect(await screen.findByText('已准备小K上下文，可在会话中继续处理。')).toBeInTheDocument();
  });

  it('shows stale-state feedback when continue returns 409', async () => {
    mockContinueProject.mockResolvedValue({ ok: false, error: 'task_state_changed', status: 409 });
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '继续推进' }));

    expect(await screen.findByText('状态已变化，已刷新项目。')).toBeInTheDocument();
    expect(mockGetProjectFullDetail).toHaveBeenCalledTimes(2);
  });
});
