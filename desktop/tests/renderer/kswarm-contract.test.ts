import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertKnownKSwarmTaskStatus,
  describeKSwarmAgentStatus,
  summarizeProjectHealth,
} from '../../renderer/src/components/projects/kswarmStatus';
import type { KSwarmAgent, KSwarmTask, ProjectFullDetail } from '../../renderer/src/hooks/useKSwarmClient';

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

    expect(summarizeProjectHealth(detail)).toEqual({
      status: 'blocked',
      message: '评审任务缺少证据',
      primaryTaskId: 'item-6',
      dispatchableCount: 1,
      blockedCount: 1,
      waitingCount: 0,
    });
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
