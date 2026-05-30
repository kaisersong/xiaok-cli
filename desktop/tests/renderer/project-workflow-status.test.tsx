import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail, mockStartProjectDiagnoseWorkflow, mockStartProjectAgentReviewSmokeWorkflow } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockStartProjectDiagnoseWorkflow: vi.fn(),
  mockStartProjectAgentReviewSmokeWorkflow: vi.fn(),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    connected: true,
    agents: [],
    getProjectFullDetail: mockGetProjectFullDetail,
    approveProject: vi.fn(),
    retryPlan: vi.fn(),
    continueProject: vi.fn(),
    dispatchTasks: vi.fn(),
    deliverProject: vi.fn(),
    closeProject: vi.fn(),
    deleteProject: vi.fn(),
    startProjectDiagnoseWorkflow: mockStartProjectDiagnoseWorkflow,
    startProjectAgentReviewSmokeWorkflow: mockStartProjectAgentReviewSmokeWorkflow,
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
    showSaveDialog: vi.fn(),
    saveFile: vi.fn(),
  }),
}));
vi.mock('../../renderer/src/api', () => ({
  api: { createThread: vi.fn() },
}));

import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { WorkflowStatusStrip } from '../../renderer/src/components/projects/WorkflowStatusStrip';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithProviders(ui: React.ReactNode, initialPath = '/') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        {ui}
      </MemoryRouter>
    </LocaleProvider>
  );
}

function agentWorkflowRun() {
  return {
    id: 'wf-proj-workflow-agent-review-smoke-1770000000000',
    projectId: 'proj-workflow',
    workflowId: 'agent-review-smoke',
    title: 'Agent 工作流 smoke',
    strategy: 'workflow' as const,
    source: 'builtin-smoke',
    status: 'completed' as const,
    createdAt: 1770000000000,
    updatedAt: 1770000002000,
    startedAt: 1770000000000,
    completedAt: 1770000002000,
    cancelledAt: null,
    requestedBy: 'human',
    approval: { required: false, status: 'not_required', budget: null, approvedBy: null, decidedAt: null },
    phases: [
      { id: 'inspect', title: 'Agent 诊断', status: 'completed' as const, nodeIds: ['worker-diagnose-project'] },
      { id: 'review', title: '对抗性复核', status: 'completed' as const, nodeIds: ['reviewer-adversarial-check'] },
      { id: 'reduce', title: '门禁归约', status: 'completed' as const, nodeIds: ['reduce-review-gate'] },
    ],
    nodes: [
      {
        id: 'worker-diagnose-project',
        phaseId: 'inspect',
        title: 'Worker 项目诊断',
        status: 'completed' as const,
        kind: 'agent_task',
        dependsOn: [],
        assignedAgent: 'xiaok-worker',
        attempt: 1,
        output: { summary: '发现 1 个待执行任务' },
        error: null,
        startedAt: 1770000000000,
        completedAt: 1770000001000,
      },
      {
        id: 'reviewer-adversarial-check',
        phaseId: 'review',
        title: 'Reviewer 对抗性检查',
        status: 'completed' as const,
        kind: 'review',
        dependsOn: ['worker-diagnose-project'],
        assignedAgent: 'xiaok-po',
        attempt: 1,
        output: { summary: '通过对抗性检查' },
        reviewDecision: { status: 'passed', reason: '诊断材料可用', evidenceRefs: ['task:item-1'] },
        error: null,
        startedAt: 1770000001000,
        completedAt: 1770000002000,
      },
      {
        id: 'reduce-review-gate',
        phaseId: 'reduce',
        title: '归约 review gate',
        status: 'completed' as const,
        kind: 'control',
        dependsOn: ['reviewer-adversarial-check'],
        assignedAgent: null,
        output: { decision: { status: 'passed', reason: '诊断材料可用' } },
        error: null,
        startedAt: 1770000002000,
        completedAt: 1770000002000,
      },
    ],
    summary: { total: 3, completed: 3, failed: 0, blocked: 0, running: 0, pending: 0, progress: 1, primaryMessage: 'Review gate passed' },
    gateDecision: { status: 'passed', reason: '诊断材料可用', evidenceRefs: ['task:item-1'] },
  };
}

function runningAgentWorkflowRun() {
  const run = agentWorkflowRun();
  return {
    ...run,
    status: 'running' as const,
    completedAt: null,
    summary: { total: 3, completed: 0, failed: 0, blocked: 0, running: 1, pending: 2, progress: 0, primaryMessage: null },
    gateDecision: null,
    nodes: run.nodes.map((node, index) => ({
      ...node,
      status: index === 0 ? 'running' as const : 'pending' as const,
      output: null,
      reviewDecision: null,
      completedAt: null,
    })),
  };
}

function workflowDetail(overrides: Partial<ProjectFullDetail> = {}): ProjectFullDetail {
  return {
    project: {
      id: 'proj-workflow',
      name: '动态工作流项目',
      goal: '验证项目级 workflow',
      status: 'active',
      poAgent: 'xiaok-po',
      createdAt: '1770000000000',
      updatedAt: '1770000000000',
    },
    tasks: [{ id: 'item-1', title: '写报告', status: 'pending', assignedAgent: 'xiaok-worker' }],
    activities: [],
    humanActions: [],
    workspace: { path: '/tmp/proj-workflow', artifacts: [] },
    plan: null,
    planProgress: null,
    workflowRuns: [
      {
        id: 'wf-proj-workflow-project-diagnose-1770000000000',
        projectId: 'proj-workflow',
        workflowId: 'project-diagnose',
        title: '项目诊断工作流',
        strategy: 'workflow',
        source: 'builtin',
        status: 'completed',
        createdAt: 1770000000000,
        updatedAt: 1770000000000,
        startedAt: 1770000000000,
        completedAt: 1770000000000,
        cancelledAt: null,
        requestedBy: 'human',
        approval: { required: false, status: 'not_required', budget: null, approvedBy: null, decidedAt: null },
        phases: [
          { id: 'inspect', title: '检查项目状态', status: 'completed', nodeIds: ['collect-project-state', 'classify-blockers'] },
          { id: 'recommend', title: '生成处理建议', status: 'completed', nodeIds: ['recommend-actions'] },
        ],
        nodes: [
          { id: 'collect-project-state', phaseId: 'inspect', title: '收集项目状态', status: 'completed', kind: 'control', dependsOn: [], output: { projectStatus: 'active', taskCount: 1, healthState: 'dispatchable' }, error: null, startedAt: 1770000000000, completedAt: 1770000000000 },
          { id: 'classify-blockers', phaseId: 'inspect', title: '识别阻塞与等待原因', status: 'completed', kind: 'control', dependsOn: ['collect-project-state'], output: { blockedTasks: [], waitingCount: 0, dispatchableCount: 1 }, error: null, startedAt: 1770000000000, completedAt: 1770000000000 },
          { id: 'recommend-actions', phaseId: 'recommend', title: '生成下一步建议', status: 'completed', kind: 'review', dependsOn: ['classify-blockers'], output: { recommendedActions: [{ id: 'dispatch_tasks', label: '派发可执行任务', reason: '存在可派发任务' }] }, error: null, startedAt: 1770000000000, completedAt: 1770000000000 },
        ],
        summary: { total: 3, completed: 3, failed: 0, blocked: 0, running: 0, pending: 0, progress: 1, primaryMessage: '派发可执行任务' },
        diagnosis: {
          healthState: 'dispatchable',
          gate: null,
          blockedTasks: [],
          dispatchableCount: 1,
          waitingCount: 0,
          recommendedActions: [{ id: 'dispatch_tasks', label: '派发可执行任务', reason: '存在可派发任务' }],
        },
      },
    ],
    ...overrides,
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

describe('WorkflowStatusStrip', () => {
  it('renders compact workflow status and opens diagnosis details on demand', () => {
    const detail = workflowDetail();

    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={detail.workflowRuns?.[0] ?? null}
        busy={false}
        onStartDiagnose={vi.fn()}
      />
    );

    expect(screen.getByText('系统诊断完成')).toBeInTheDocument();
    expect(screen.getByText('可派发')).toBeInTheDocument();
    expect(screen.getByText('1 个任务')).toBeInTheDocument();
    expect(screen.getByText('无阻塞')).toBeInTheDocument();
    expect(screen.queryByText('项目状态')).not.toBeInTheDocument();
    expect(screen.queryByText('系统内置，未调用智能体')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行系统诊断' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /系统诊断完成/ }));

    const dialog = screen.getByRole('dialog', { name: '系统诊断详情' });
    expect(dialog.className).toContain('bg-[var(--c-bg-card)]');
    expect(dialog.className).not.toContain('/10');
    expect(screen.getByText('已完成 3/3')).toBeInTheDocument();
    expect(screen.getByText('系统内置，未调用智能体')).toBeInTheDocument();
    expect(screen.getAllByText('派发可执行任务').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('项目状态')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('健康状态')).toBeInTheDocument();
    expect(screen.getAllByText('可派发').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/建议：/)).toBeInTheDocument();
    expect(screen.getByText(/存在可派发任务/)).toBeInTheDocument();
    expect(screen.getByText(/诊断依据：收集项目状态 ✓/)).toBeInTheDocument();
  });

  it('renders agent workflow node agents and review gate decision', () => {
    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={agentWorkflowRun()}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    expect(screen.getByText('Agent 工作流 smoke')).toBeInTheDocument();
    expect(screen.getByText('Review gate passed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Agent 工作流 smoke/ }));

    const dialog = screen.getByRole('dialog', { name: '工作流详情' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain('bg-[var(--c-bg-card)]');
    expect(dialog.className).not.toContain('/10');
    expect(screen.getByText('Agent 工作流')).toBeInTheDocument();
    expect(screen.getByText('Worker 项目诊断')).toBeInTheDocument();
    expect(screen.getByText('xiaok-worker')).toBeInTheDocument();
    expect(screen.getByText('Reviewer 对抗性检查')).toBeInTheDocument();
    expect(screen.getByText('xiaok-po')).toBeInTheDocument();
    expect(screen.getByText(/Gate：passed/)).toBeInTheDocument();
    expect(screen.getByText(/诊断材料可用/)).toBeInTheDocument();
  });

  it('labels running agent workflow progress as executing', () => {
    renderWithProviders(
      <WorkflowStatusStrip
        workflowRun={runningAgentWorkflowRun()}
        busy={false}
        onStartDiagnose={vi.fn()}
        onStartAgentWorkflow={vi.fn()}
      />
    );

    expect(screen.getByText('Agent 工作流 smoke')).toBeInTheDocument();
    expect(screen.getByText('执行中 0/3')).toBeInTheDocument();
  });
});

describe('ProjectDetailPage workflow action', () => {
  it('starts project diagnose workflow and refreshes project detail', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const refreshed = workflowDetail();
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    mockStartProjectDiagnoseWorkflow.mockResolvedValue(refreshed.workflowRuns?.[0]);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '运行系统诊断' }));

    await waitFor(() => expect(mockStartProjectDiagnoseWorkflow).toHaveBeenCalledWith('proj-workflow'));
    await waitFor(() => expect(mockGetProjectFullDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('系统诊断完成')).toBeInTheDocument();
    expect(screen.queryByText('项目状态')).not.toBeInTheDocument();
  });

  it('shows completed workflow from the start response even when detail refresh is stale', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const completedRun = workflowDetail().workflowRuns?.[0];
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    mockStartProjectDiagnoseWorkflow.mockResolvedValue(completedRun);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '运行系统诊断' }));

    await waitFor(() => expect(mockStartProjectDiagnoseWorkflow).toHaveBeenCalledWith('proj-workflow'));
    expect(await screen.findByText('系统诊断已完成。')).toBeInTheDocument();
    expect(await screen.findByText('系统诊断完成')).toBeInTheDocument();
    expect(screen.queryByText('系统内置，未调用智能体')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /系统诊断完成/ }));
    expect(screen.getByText('系统内置，未调用智能体')).toBeInTheDocument();
    expect(screen.getAllByText('派发可执行任务').length).toBeGreaterThanOrEqual(1);
  });

  it('starts agent-backed workflow smoke from project detail', async () => {
    const initial = workflowDetail({ workflowRuns: [] });
    const smokeRun = agentWorkflowRun();
    mockGetProjectFullDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial);
    mockStartProjectAgentReviewSmokeWorkflow.mockResolvedValue(smokeRun);

    renderProjectDetail(initial);

    fireEvent.click(await screen.findByRole('button', { name: '运行 Agent 工作流' }));

    await waitFor(() => expect(mockStartProjectAgentReviewSmokeWorkflow).toHaveBeenCalledWith('proj-workflow'));
    expect(await screen.findByText('Agent 工作流已启动。')).toBeInTheDocument();
    expect(await screen.findByText('Agent 工作流 smoke')).toBeInTheDocument();
  });
});
