import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  ProjectSmartTeamPanel,
  type ProjectTeamPlanView,
} from '../../renderer/src/components/projects/ProjectSmartTeamPanel';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ProjectDetailPage } from '../../renderer/src/components/projects/ProjectDetailPage';

const projectClient = {
  getProjectFullDetail: vi.fn(),
  approveProject: vi.fn(),
  updateProjectExecutionMode: vi.fn(),
  retryPlan: vi.fn(),
  continueProject: vi.fn(),
  dispatchTasks: vi.fn(),
  deliverProject: vi.fn(),
  closeProject: vi.fn(),
  startProjectDiagnoseWorkflow: vi.fn(),
  createWorkflowProposal: vi.fn(),
  startWorkflowRunFromProposal: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  planProjectTeam: vi.fn(),
  applyProjectTeamPlan: vi.fn(),
  getProjectTeamOperation: vi.fn(),
  fetchAgents: vi.fn(),
  fetchRuntimes: vi.fn().mockResolvedValue([]),
  fetchLlmProviders: vi.fn().mockResolvedValue([]),
  createAgent: vi.fn(),
  connected: true,
  serviceStatus: { state: 'ready' },
  agents: [],
  lastEventSeq: 0,
  getLastEvent: vi.fn(),
};

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => projectClient,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ projectId: 'project-1' }), useNavigate: () => vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function proposalPlan(): ProjectTeamPlanView {
  return {
    planId: 'plan-1',
    projectId: 'project-1',
    projectRevision: 7,
    outcome: 'proposal',
    summary: '复用现有 PO，并补充一名研究智能体。',
    items: [
      { desiredAgentId: 'xiaok-po', action: 'reuse', role: 'PO', agentName: 'PO-Agent', capabilityLabels: ['项目规划'], reasonCode: 'existing_capability_match' },
      { desiredAgentId: 'managed-researcher', action: 'create', role: '研究员', agentName: '研究智能体', capabilityLabels: ['网页研究'], reasonCode: 'capability_gap' },
    ],
  };
}

describe('ProjectSmartTeamPanel', () => {
  it('plans first and applies only after explicit confirmation', async () => {
    const planProjectTeam = vi.fn().mockResolvedValue(proposalPlan());
    const applyProjectTeamPlan = vi.fn().mockResolvedValue({
      operationId: 'operation-1',
      status: 'completed',
      message: '团队方案已应用',
    });
    const onOpenManual = vi.fn();

    render(
      <LocaleProvider>
        <ProjectSmartTeamPanel
          projectId="project-1"
          client={{ planProjectTeam, applyProjectTeamPlan, getProjectTeamOperation: vi.fn().mockResolvedValue(null) }}
          onOpenManual={onOpenManual}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '智能组建团队' }));
    await waitFor(() => expect(screen.getByText('已分析 2 个团队角色。')).toBeInTheDocument());
    expect(applyProjectTeamPlan).not.toHaveBeenCalled();
    expect(screen.getByText('复用')).toBeInTheDocument();
    expect(screen.getByText('新建')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '应用团队方案' }));
    await waitFor(() => {
      expect(applyProjectTeamPlan).toHaveBeenCalledWith({
        projectId: 'project-1',
        planId: 'plan-1',
        projectRevision: 7,
      });
    });
    expect(await screen.findByText('团队方案已应用')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '手工配置智能体（高级）' }));
    expect(onOpenManual).toHaveBeenCalledTimes(1);
  });

  it('does not enter a create confirmation flow when the current team already satisfies the project', async () => {
    const applyProjectTeamPlan = vi.fn();
    render(
      <LocaleProvider>
        <ProjectSmartTeamPanel
          projectId="project-1"
          client={{
            planProjectTeam: vi.fn().mockResolvedValue({ ...proposalPlan(), outcome: 'no_change', summary: '现有团队已经满足项目需要。', items: [] }),
            applyProjectTeamPlan,
            getProjectTeamOperation: vi.fn().mockResolvedValue(null),
          }}
          onOpenManual={() => {}}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '智能组建团队' }));
    expect(await screen.findByText('现有团队已覆盖项目需要，无需调整。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '应用团队方案' })).not.toBeInTheDocument();
    expect(applyProjectTeamPlan).not.toHaveBeenCalled();
  });

  it('localizes the semantic team summary instead of rendering main-process English', async () => {
    render(
      <LocaleProvider>
        <ProjectSmartTeamPanel
          projectId="project-1"
          client={{
            planProjectTeam: vi.fn().mockResolvedValue({
              ...proposalPlan(),
              summary: '3 team role(s) analyzed.',
              items: proposalPlan().items.concat({
                desiredAgentId: 'reviewer',
                action: 'reuse',
                role: 'reviewer',
                capabilityLabels: ['qa'],
                reasonCode: 'existing_capability_match',
              }),
            }),
            applyProjectTeamPlan: vi.fn(),
            getProjectTeamOperation: vi.fn().mockResolvedValue(null),
          }}
          onOpenManual={() => {}}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '智能组建团队' }));
    expect(await screen.findByText('已分析 3 个团队角色。')).toBeInTheDocument();
    expect(screen.queryByText('3 team role(s) analyzed.')).not.toBeInTheDocument();
  });

  it('restores an in-flight operation from the durable operation snapshot', async () => {
    render(
      <LocaleProvider>
        <ProjectSmartTeamPanel
          projectId="project-1"
          client={{
            planProjectTeam: vi.fn(),
            applyProjectTeamPlan: vi.fn(),
            getProjectTeamOperation: vi.fn().mockResolvedValue({
              operationId: 'operation-recovered',
              status: 'running',
              message: '正在创建研究智能体',
            }),
          }}
          onOpenManual={() => {}}
        />
      </LocaleProvider>,
    );

    expect(await screen.findByText('正在创建研究智能体')).toBeInTheDocument();
    expect(screen.getByText('执行中')).toBeInTheDocument();
  });

  it('wires the agents tab to semantic smart-team actions and keeps manual configuration reachable', async () => {
    projectClient.getProjectFullDetail.mockResolvedValue({
      project: { id: 'project-1', name: 'Demo', status: 'active', members: [] },
      tasks: [], activities: [], humanActions: [], workspace: { path: '/tmp/demo', artifacts: [] }, plan: null, planProgress: null,
    });
    projectClient.getProjectTeamOperation.mockResolvedValue(null);

    render(<LocaleProvider><ProjectDetailPage /></LocaleProvider>);

    fireEvent.click(await screen.findByRole('button', { name: '智能体' }));
    expect(await screen.findByRole('button', { name: '智能组建团队' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '手工配置智能体（高级）' }));
    expect(await screen.findByRole('heading', { name: '选择智能体类型' })).toBeInTheDocument();
  });
});
