import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail, mockContinueProject, mockCreateThread } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockContinueProject: vi.fn(),
  mockCreateThread: vi.fn(),
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
vi.mock('../../renderer/src/api', () => ({
  api: {
    createThread: mockCreateThread,
  },
}));

import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function renderProjectDetail(detail: ProjectFullDetail) {
  mockGetProjectFullDetail.mockResolvedValue(detail);
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[`/projects/${detail.project.id}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/t/:threadId" element={<ChatRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>
  );
}

function ChatRouteProbe() {
  const location = useLocation();
  const params = useParams<{ threadId: string }>();
  return (
    <div>
      <span data-testid="chat-thread-id">{params.threadId}</span>
      <pre data-testid="chat-state">{JSON.stringify(location.state)}</pre>
    </div>
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
    expect(screen.getByRole('button', { name: '让小K帮忙' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '问小K' })).not.toBeInTheDocument();
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

  it('closes the reason drawer from the close button on mouse down', async () => {
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '查看原因' }));
    const dialog = screen.getByRole('dialog', { name: '处理原因' });

    fireEvent.mouseDown(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
    });
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

  it('opens a xiaok chat draft with project intervention context', async () => {
    mockCreateThread.mockResolvedValue({
      id: 'thread-help',
      title: '让小K帮忙：外贸趋势分析',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: null,
      taskIds: [],
    });
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '让小K帮忙' }));

    await waitFor(() => {
      expect(mockCreateThread).toHaveBeenCalledWith({ title: expect.stringContaining('让小K帮忙') });
    });
    expect(await screen.findByTestId('chat-thread-id')).toHaveTextContent('thread-help');
    const state = JSON.parse(screen.getByTestId('chat-state').textContent || '{}');
    expect(state.draftPrompt).toContain('外贸趋势分析');
    expect(state.draftPrompt).toContain('proj-intervention');
    expect(state.draftPrompt).toContain('item-1');
    expect(state.draftPrompt).toContain('CLI failed');
    expect(state.draftPrompt).toContain('continue_project');
    expect(state.draftPrompt).toContain('repair_project_task');
    expect(state.swarmContinueContext).toMatchObject({
      projectId: 'proj-intervention',
      taskId: 'item-1',
      taskTitle: '确定数据源与假设基线',
    });

    const stored = JSON.parse(window.sessionStorage.getItem('xiaok.swarmContinueContext') || '{}');
    expect(stored.projectId).toBe('proj-intervention');
    expect(stored.threadId).toBe('thread-help');
    expect(stored.draftPrompt).toContain('continue_project');
    expect(stored.availableTools).toContain('repair_project_task');

    const threadDraft = JSON.parse(window.localStorage.getItem('xiaok.threadDraft.thread-help') || '{}');
    expect(threadDraft.threadId).toBe('thread-help');
    expect(threadDraft.projectId).toBe('proj-intervention');
    expect(threadDraft.draftPrompt).toContain('continue_project');
  });

  it('shows stale-state feedback when continue returns 409', async () => {
    mockContinueProject.mockResolvedValue({ ok: false, error: 'task_state_changed', status: 409 });
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '继续推进' }));

    expect(await screen.findByText('状态已变化，已刷新项目。')).toBeInTheDocument();
    expect(mockGetProjectFullDetail).toHaveBeenCalledTimes(2);
  });

  it('shows a concrete message when recoverable artifacts are missing', async () => {
    mockContinueProject.mockResolvedValue({
      ok: false,
      error: 'no_recoverable_artifacts',
      strategy: 'needs_conversation',
    });
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '继续推进' }));

    expect(await screen.findByText('没有找到可恢复产物，请查看原因或让小K帮忙处理。')).toBeInTheDocument();
  });

  it('stores executable next action when continue needs user action', async () => {
    mockContinueProject.mockResolvedValue({
      ok: false,
      error: 'recovery_budget_exceeded',
      outcome: 'needs_user_action',
      humanActionRequired: true,
      xiaokContext: { projectId: 'proj-intervention', taskId: 'item-1' },
      nextActions: [
        {
          id: 'repair_and_submit',
          toolName: 'repair_project_task',
          params: {
            projectId: 'proj-intervention',
            expectedPrimaryTaskId: 'item-1',
            expectedTaskUpdatedAt: 1779093510355,
          },
        },
      ],
    });
    renderProjectDetail(interventionDetail());

    fireEvent.click(await screen.findByRole('button', { name: '继续推进' }));

    expect(await screen.findByText('需要让小K帮忙诊断并提交修复产物。')).toBeInTheDocument();
    const stored = JSON.parse(window.sessionStorage.getItem('xiaok.swarmContinueContext') || '{}');
    expect(stored.nextActions[0].toolName).toBe('repair_project_task');
    expect(stored.nextActions[0].params.expectedPrimaryTaskId).toBe('item-1');
  });
});
