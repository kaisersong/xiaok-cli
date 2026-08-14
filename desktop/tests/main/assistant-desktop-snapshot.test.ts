import { describe, expect, it, vi } from 'vitest';
import {
  createAssistantDesktopSnapshotReader,
  resolveAssistantSnapshotWindow,
  type AssistantDesktopSnapshotPorts,
} from '../../electron/assistant-desktop-snapshot.js';
import type { AssistantLoopProfile } from '../../electron/assistant-loop-executor.js';

const profile: AssistantLoopProfile = {
  id: 'default-personal-assistant',
  status: 'active',
  locale: 'zh',
  timeZone: 'Asia/Shanghai',
  eveningTime: '22:30',
  morningTime: '08:30',
  workdays: [1, 2, 3, 4, 5],
  quietHours: { start: '23:00', end: '07:00' },
  dataScopes: ['threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings'],
  createdAt: 1,
  updatedAt: 1,
};

const local = (isoWithoutZone: string) => Date.parse(`${isoWithoutZone}+08:00`);

function withForbiddenBody<T extends object>(value: T): T {
  Object.defineProperty(value, 'body', {
    enumerable: true,
    get(): never {
      throw new Error('large body must not be read');
    },
  });
  return value;
}

function ports(overrides: Partial<AssistantDesktopSnapshotPorts> = {}): AssistantDesktopSnapshotPorts {
  return {
    listTaskSnapshots: vi.fn().mockResolvedValue([]),
    listKSwarmProjects: vi.fn().mockResolvedValue([]),
    listTimedActions: vi.fn().mockResolvedValue([]),
    listMeetingMetadata: vi.fn().mockResolvedValue([]),
    listKnowledgeSourceMetadata: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('assistant Desktop snapshot', () => {
  it('projects narrow metadata into all six scopes without reading large bodies', async () => {
    const dependencies = ports({
      listTaskSnapshots: vi.fn().mockResolvedValue([withForbiddenBody({
        id: 'task-1',
        threadId: 'thread-1',
        title: '完成默认助理',
        status: 'running',
        summary: '主流程正在集成',
        updatedAt: local('2026-08-14T14:00:00'),
        artifacts: [withForbiddenBody({
          id: 'artifact-1',
          title: '设计稿',
          summary: '已完成评审',
          updatedAt: local('2026-08-14T13:00:00'),
        })],
      })]),
      listKSwarmProjects: vi.fn().mockResolvedValue([{
        id: 'project-1', name: 'Xiaok', status: 'active', summary: 'P0 开发中', updatedAt: local('2026-08-14T12:00:00'),
      }]),
      listTimedActions: vi.fn().mockResolvedValue([{
        id: 'action-1', title: '晚间复盘', status: 'pending', triggerKind: 'daily', dueAt: local('2026-08-14T22:30:00'), updatedAt: local('2026-08-01T10:00:00'),
      }]),
      listMeetingMetadata: vi.fn().mockResolvedValue([withForbiddenBody({
        id: 'meeting-1', title: '需求评审', status: 'completed', summary: '已达成一致', updatedAt: local('2026-08-14T11:00:00'),
      })]),
      listKnowledgeSourceMetadata: vi.fn().mockResolvedValue([withForbiddenBody({
        id: 'source-1', collectionId: 'collection-1', title: '实现方案', status: 'ready', summary: '只包含来源摘要', updatedAt: local('2026-08-14T10:00:00'),
      })]),
    });

    const snapshot = await createAssistantDesktopSnapshotReader(dependencies).collect({
      kind: 'evening',
      profile,
      now: local('2026-08-14T22:30:00'),
    });

    expect(new Set(snapshot.items.map(item => item.scope))).toEqual(new Set([
      'threads', 'projects', 'tasks', 'artifacts', 'automations', 'meetings',
    ]));
    expect(snapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'tasks', reference: { kind: 'task_snapshot', id: 'task-1' } }),
      expect.objectContaining({ scope: 'threads', reference: { kind: 'thread', id: 'thread-1' } }),
      expect.objectContaining({ scope: 'projects', reference: { kind: 'kswarm_project', id: 'project-1' } }),
      expect.objectContaining({ scope: 'automations', reference: { kind: 'timed_action', id: 'action-1' } }),
      expect.objectContaining({ scope: 'meetings', reference: { kind: 'meeting', id: 'meeting-1' } }),
      expect.objectContaining({ scope: 'artifacts', reference: { kind: 'knowledge_source', id: 'source-1' } }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('body');
    expect(snapshot.sourceErrors).toEqual([]);
  });

  it('filters by profile dataScopes and does not call wholly disabled sources', async () => {
    const dependencies = ports({
      listTaskSnapshots: vi.fn().mockResolvedValue([{
        id: 'task-1',
        threadId: 'thread-1',
        title: '任务',
        updatedAt: local('2026-08-14T14:00:00'),
        artifacts: [{ id: 'artifact-1', title: '产物', updatedAt: local('2026-08-14T14:00:00') }],
      }]),
      listTimedActions: vi.fn().mockResolvedValue([{
        id: 'action-1', title: '自动任务', status: 'pending', triggerKind: 'daily', updatedAt: local('2026-08-14T14:00:00'),
      }]),
    });

    const snapshot = await createAssistantDesktopSnapshotReader(dependencies).collect({
      kind: 'evening',
      profile: { ...profile, dataScopes: ['tasks', 'automations'] },
      now: local('2026-08-14T22:30:00'),
    });

    expect(snapshot.items.map(item => item.scope).sort()).toEqual(['automations', 'tasks']);
    expect(snapshot.dropped.disabledScope).toBe(2);
    expect(dependencies.listKSwarmProjects).not.toHaveBeenCalled();
    expect(dependencies.listMeetingMetadata).not.toHaveBeenCalled();
    expect(dependencies.listKnowledgeSourceMetadata).not.toHaveBeenCalled();
  });

  it('uses local calendar windows for evening, overdue evening, and morning runs', () => {
    expect(resolveAssistantSnapshotWindow({
      kind: 'evening',
      profile,
      now: local('2026-08-14T22:30:00'),
    })).toEqual({
      from: local('2026-08-14T00:00:00'),
      to: local('2026-08-14T22:30:00'),
    });
    expect(resolveAssistantSnapshotWindow({
      kind: 'evening',
      profile,
      now: local('2026-08-15T03:30:00'),
    })).toEqual({
      from: local('2026-08-14T00:00:00'),
      to: local('2026-08-14T23:59:59.999'),
    });
    expect(resolveAssistantSnapshotWindow({
      kind: 'morning',
      profile,
      now: local('2026-08-15T08:30:00'),
    })).toEqual({
      from: local('2026-08-15T00:00:00'),
      to: local('2026-08-15T08:30:00'),
    });
  });

  it('keeps healthy source data when other sources fail and records degradation', async () => {
    const dependencies = ports({
      listTaskSnapshots: vi.fn().mockRejectedValue(new Error('task store unavailable')),
      listKSwarmProjects: vi.fn().mockResolvedValue([{
        id: 'project-1', name: 'Xiaok', status: 'active', updatedAt: local('2026-08-14T12:00:00'),
      }]),
      listTimedActions: vi.fn().mockRejectedValue('timed action timeout'),
    });

    const snapshot = await createAssistantDesktopSnapshotReader(dependencies).collect({
      kind: 'evening',
      profile,
      now: local('2026-08-14T22:30:00'),
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({ scope: 'projects', id: 'project-1' }),
    ]);
    expect(snapshot.sourceErrors).toEqual([
      { source: 'task_snapshots', message: 'task store unavailable' },
      { source: 'timed_actions', message: 'timed action timeout' },
    ]);
    expect(snapshot.dropped.sourceErrors).toBe(2);
  });

  it('delegates deterministic per-scope and byte limits to the bounded collector', async () => {
    const dependencies = ports({
      listKSwarmProjects: vi.fn().mockResolvedValue(Array.from({ length: 3 }, (_, index) => ({
        id: `project-${index}`,
        name: `Project ${index}`,
        status: 'active',
        summary: 'x'.repeat(400),
        updatedAt: local(`2026-08-14T1${index}:00:00`),
      }))),
    });

    const snapshot = await createAssistantDesktopSnapshotReader(dependencies, {
      limits: { maxItemsPerScope: 2, maxSerializedBytes: 650, maxSummaryChars: 200 },
    }).collect({
      kind: 'evening',
      profile: { ...profile, dataScopes: ['projects'] },
      now: local('2026-08-14T22:30:00'),
    });

    expect(snapshot.items.length).toBeLessThanOrEqual(2);
    expect(snapshot.dropped.perScopeLimit).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThanOrEqual(650);
  });
});
