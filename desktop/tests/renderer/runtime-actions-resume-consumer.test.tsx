import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

const { mockGetProjectFullDetail, mockContinueProject, mockCreateThread, mockResume } = vi.hoisted(() => ({
  mockGetProjectFullDetail: vi.fn(),
  mockContinueProject: vi.fn(),
  mockCreateThread: vi.fn(),
  mockResume: vi.fn(),
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
  getDesktopApi: () => ({ kswarmResumeWorkflowRun: mockResume }),
}));
vi.mock('../../renderer/src/api', () => ({
  api: {
    createThread: mockCreateThread,
  },
}));

import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

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


function SwitchLocale() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>Switch to EN</button>; }
function SwitchProject() { const navigate = useNavigate(); return <button onClick={() => navigate('/projects/next-owned')}>Switch project</button>; }
function page() {
  mockGetProjectFullDetail.mockImplementation(async (id: string) => { const value = interventionDetail({ kind: 'script_workflow', workflowRunId: id === 'proj-intervention' ? 'owned-run' : 'next-run' }); value.project.id = id; return value; });
  return render(<LocaleProvider><MemoryRouter initialEntries={['/projects/proj-intervention']}><SwitchLocale /><SwitchProject /><Routes><Route path="/projects/:projectId" element={<ProjectDetailPage />} /></Routes></MemoryRouter></LocaleProvider>);
}
function deferred() { let resolve!: (value: { restored: boolean; reason?: string }) => void; let reject!: (error: unknown) => void; const promise = new Promise<{ restored: boolean; reason?: string }>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
it('actual script resume preserves original success path and two-id preload input', async () => {
  mockResume.mockResolvedValueOnce({ restored: true }); page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' }));
  expect(await screen.findByText('已直接续跑动态工作流。')).toBeInTheDocument(); expect(mockResume).toHaveBeenCalledWith({ projectId: 'proj-intervention', workflowRunId: 'owned-run' }); expect(mockContinueProject).not.toHaveBeenCalled();
});
it.each([
  { reason: 'already_running', text: '已直接续跑动态工作流。' },
  { reason: 'no_script_source', text: '该工作流缺少脚本源，无法直接续跑，请改用「让小K帮忙」。' },
  { reason: 'kswarm_unavailable', text: '内核未就绪，请稍后重试。' },
  { reason: 'future-business-failure', text: '直接续跑失败，请改用「让小K帮忙」。' },
])('actual resume retains resolved false reason $reason', async ({ reason, text }) => {
  mockResume.mockResolvedValueOnce({ restored: false, reason }); page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' })); expect(await screen.findByText(text)).toBeInTheDocument(); expect(mockResume).toHaveBeenCalledTimes(1);
});
it('actual resume transport rejection renders localized failure without replay', async () => {
  mockResume.mockRejectedValueOnce(Error('owned-sensitive-marker')); page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' })); expect(await screen.findByText('直接续跑失败，请稍后重试。')).toBeInTheDocument(); expect(screen.queryByText('owned-sensitive-marker')).not.toBeInTheDocument(); expect(mockResume).toHaveBeenCalledTimes(1);
});
it('actual resume completion uses current locale after an in-flight language switch', async () => {
  const held = deferred(); mockResume.mockReturnValueOnce(held.promise); page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' })); fireEvent.click(screen.getByRole('button', { name: 'Switch to EN' }));
  await act(async () => held.resolve({ restored: true })); expect(await screen.findByText('Dynamic workflow resumed.')).toBeInTheDocument(); expect(screen.queryByText('已直接续跑动态工作流。')).not.toBeInTheDocument(); expect(mockResume).toHaveBeenCalledTimes(1);
});
it('actual resume settlement after unmount does not refresh the old project', async () => {
  const held = deferred(); mockResume.mockReturnValueOnce(held.promise); const view = page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' })); const before = mockGetProjectFullDetail.mock.calls.length; view.unmount();
  await act(async () => held.resolve({ restored: true })); expect(mockGetProjectFullDetail).toHaveBeenCalledTimes(before); expect(mockResume).toHaveBeenCalledTimes(1);
});
it('actual resume pending click is single flight and disables the original button', async () => {
  const held = deferred(); mockResume.mockReturnValueOnce(held.promise); page(); const button = await screen.findByRole('button', { name: '继续推进' }); fireEvent.click(button); fireEvent.click(button); expect(mockResume).toHaveBeenCalledTimes(1); expect(button).toBeDisabled(); await act(async () => held.resolve({ restored: false, reason: 'no_script_source' }));
});

it('actual route switch discards old resume reply and leaves the new project action available', async () => {
  const old = deferred(); mockResume.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ restored: true }); page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' })); fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
  await screen.findByText('next-owned'); const button = await screen.findByRole('button', { name: '继续推进' }); expect(button).toBeEnabled(); await act(async () => old.resolve({ restored: true })); expect(screen.queryByText('已直接续跑动态工作流。')).not.toBeInTheDocument();
  fireEvent.click(button); expect(await screen.findByText('已直接续跑动态工作流。')).toBeInTheDocument(); expect(mockResume).toHaveBeenLastCalledWith({ projectId: 'next-owned', workflowRunId: 'next-run' });
});
it('old project resume completion cannot clear a new project pending action', async () => {
  const old = deferred(), current = deferred(); mockResume.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); page(); fireEvent.click(await screen.findByRole('button', { name: '继续推进' })); fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
  await screen.findByText('next-owned'); const button = await screen.findByRole('button', { name: '继续推进' }); fireEvent.click(button); expect(mockResume).toHaveBeenCalledTimes(2); expect(button).toBeDisabled();
  await act(async () => old.resolve({ restored: true })); expect(button).toBeDisabled(); expect(screen.queryByText('已直接续跑动态工作流。')).not.toBeInTheDocument(); await act(async () => current.resolve({ restored: false, reason: 'no_script_source' }));
});
