import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertKnownKSwarmTaskStatus,
  describeKSwarmAgentStatus,
  summarizeProjectHealth,
} from '../../renderer/src/components/projects/kswarmStatus';
import type { KSwarmLabels } from '../../renderer/src/components/projects/kswarmStatus';
import type { KSwarmAgent, KSwarmTask, ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

/** Minimal labels fixture for tests. */
const testLabels: KSwarmLabels = {
  projectHealthBlocked: '项目阻塞',
  projectHealthFailed: '项目失败',
  projectHealthWaiting: '等待中',
  projectHealthNeedsReview: '等待审核',
  projectHealthRunning: '执行中',
  projectHealthHealthy: '正常',
  projectHealthUnknown: '状态未知',
  projectHealthBlockedShort: '阻塞',
  projectHealthFailedShort: '失败',
  projectHealthWaitingShort: '等待',
  projectHealthNeedsReviewShort: '待审核',
  projectHealthRunningShort: '执行中',
  projectHealthHealthyShort: '正常',
  projectHealthUnknownShort: '未知',
  projectHealthMsgNeedsReview: '等待 PO 复审',
  projectHealthMsgWaiting: '等待可派发任务或可用智能体',
  projectHealthMsgBlocked: '项目存在阻塞任务',
  projectHealthMsgFailed: '项目存在失败任务',
  agentStatusWaiting: '等待',
  agentStatusWorking: '工作中',
  agentStatusBlocked: '阻塞',
  agentStatusFailed: '失败',
  agentStatusError: '错误',
  agentStatusCompleted: '完成',
  agentStatusOffline: '离线',
  agentStatusIdle: '空闲',
};

describe('KSwarm renderer contract', () => {
  it('keeps checked fixtures aligned with full-detail API status shape', () => {
    const blocked = loadFixture('full-detail-blocked-project.json');
    const busy = loadFixture('full-detail-cross-project-busy.json');

    const taskStatuses = [...blocked.tasks, ...busy.tasks].map((task) => task.status);
    const agentStatuses = [...blocked.agents, ...busy.agents].map((agent) => agent.status);

    expect(taskStatuses.map(assertKnownKSwarmTaskStatus)).toEqual(taskStatuses);
    expect(agentStatuses).toEqual(expect.arrayContaining(['idle', 'waiting', 'working', 'completed']));
    expect(blocked.projectHealth?.status).toBe('blocked');
    expect(busy.dispatchPlan?.waiting?.[0]).toMatchObject({ reason: 'agent_busy_elsewhere' });
  });

  it('accepts task statuses returned by the current KSwarm full-detail API', () => {
    const statuses: KSwarmTask['status'][] = [
      'pending',
      'dispatched',
      'accepted',
      'in_progress',
      'submitted',
      'review',
      'done',
      'failed',
      'blocked',
      'cancelled',
    ];

    expect(statuses.map(assertKnownKSwarmTaskStatus)).toEqual(statuses);
    expect(() => assertKnownKSwarmTaskStatus('mystery')).toThrow(/Unknown KSwarm task status/);
  });

  it('summarizes project health from full detail without losing dispatch plan details', () => {
    const detail: ProjectFullDetail = {
      project: { id: 'proj-1', name: '技术大会演讲报告', status: 'active' },
      tasks: [
        { id: 'item-6', title: '评审', status: 'blocked', blockedReason: 'missing_review_evidence' },
        { id: 'item-7', title: '视觉风格', status: 'pending' },
      ],
      activities: [],
      humanActions: [],
      workspace: { path: '/Users/[USER]/projects/proj-1', artifacts: [] },
      plan: null,
      planProgress: null,
      dispatchPlan: {
        dispatchable: [{ taskId: 'item-7', reason: 'no_dependencies' }],
        blocked: [{ taskId: 'item-6', reason: 'missing_review_evidence' }],
        waiting: [],
      },
      projectHealth: {
        status: 'blocked',
        primaryBlockedTaskId: 'item-6',
        message: '评审任务缺少证据',
      },
    };

    expect(summarizeProjectHealth(detail, testLabels)).toEqual({
      status: 'blocked',
      message: '评审任务缺少证据',
      primaryTaskId: 'item-6',
      dispatchableCount: 1,
      blockedCount: 1,
      waitingCount: 0,
    });
  });

  it('summarizes project health from the current backend state-shaped payload', () => {
    const detail: ProjectFullDetail = {
      project: { id: 'proj-1', name: 'OpenAI本月分析', status: 'active' },
      tasks: [
        { id: 'item-6', title: '撰写报告草稿', status: 'submitted' },
      ],
      activities: [],
      humanActions: [],
      workspace: { path: '/Users/[USER]/projects/proj-1', artifacts: [] },
      plan: null,
      planProgress: null,
      dispatchPlan: {
        dispatchable: [],
        blocked: [],
        waiting: [],
      },
      projectHealth: {
        state: 'needs_review',
        gate: 'submitted_tasks',
        counts: { submitted: 1 },
        reasons: [],
      } as any,
    };

    expect(summarizeProjectHealth(detail, testLabels)).toEqual({
      status: 'needs_review',
      message: '等待 PO 复审',
      primaryTaskId: undefined,
      dispatchableCount: 0,
      blockedCount: 0,
      waitingCount: 0,
    });
  });

  it('accepts workflow runs returned by the KSwarm full-detail API', () => {
    const detail: ProjectFullDetail = {
      project: { id: 'proj-1', name: '动态工作流项目', status: 'active' },
      tasks: [],
      activities: [],
      humanActions: [],
      workspace: { path: '/Users/[USER]/projects/proj-1', artifacts: [] },
      plan: null,
      planProgress: null,
      workflowRuns: [
        {
          id: 'wf-proj-1-project-diagnose-1770000000000',
          projectId: 'proj-1',
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
          phases: [{ id: 'inspect', title: '检查项目状态', status: 'completed', nodeIds: ['collect-project-state'] }],
          nodes: [
            {
              id: 'collect-project-state',
              phaseId: 'inspect',
              title: '收集项目状态',
              status: 'completed',
              kind: 'control',
              dependsOn: [],
              output: { taskCount: 0 },
              error: null,
              startedAt: 1770000000000,
              completedAt: 1770000000000,
            },
          ],
          summary: { total: 1, completed: 1, failed: 0, blocked: 0, running: 0, pending: 0, progress: 1, primaryMessage: '派发可执行任务' },
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
    };

    expect(detail.workflowRuns?.[0].diagnosis?.recommendedActions[0].id).toBe('dispatch_tasks');
    expect(detail.workflowRuns?.[0].summary.completed).toBe(1);
  });

  it('derives agent card states from assigned task context', () => {
    const agent: KSwarmAgent = { id: 'cli-claude', name: 'Claude', status: 'idle' };
    const tasks: KSwarmTask[] = [
      { id: 'item-1', title: '等待执行', status: 'pending', assignedAgent: 'cli-claude' },
      { id: 'item-2', title: '阻塞任务', status: 'blocked', assignedAgent: 'cli-codex' },
      { id: 'item-3', title: '失败任务', status: 'failed', assignedAgent: 'cli-qoder' },
    ];

    expect(describeKSwarmAgentStatus(agent, tasks)).toMatchObject({
      status: 'waiting',
      taskId: 'item-1',
    });
    expect(describeKSwarmAgentStatus({ id: 'cli-codex', name: 'Codex', status: 'idle' }, tasks)).toMatchObject({
      status: 'blocked',
      taskId: 'item-2',
    });
    expect(describeKSwarmAgentStatus({ id: 'cli-qoder', name: 'Qoder', status: 'idle' }, tasks)).toMatchObject({
      status: 'failed',
      taskId: 'item-3',
    });
  });
});

function loadFixture(name: string): ProjectFullDetail & { agents: KSwarmAgent[] } {
  const path = join(process.cwd(), '..', 'tests', 'fixtures', 'kswarm', name);
  return JSON.parse(readFileSync(path, 'utf8')) as ProjectFullDetail & { agents: KSwarmAgent[] };
}
