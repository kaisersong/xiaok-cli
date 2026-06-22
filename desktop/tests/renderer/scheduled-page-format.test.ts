import { describe, expect, it } from 'vitest';

import {
  formatScheduledFrequency,
  isRuntimeTaskId,
  mergeScheduledTaskCache,
  normalizeScheduledTaskRuntimeLink,
} from '../../renderer/src/components/ScheduledPage';

const t = {
  scheduledManual: '手动',
  scheduledHourly: '每小时',
  scheduledDaily: '每天',
  scheduledWeekdays: '工作日',
  scheduledWeekly: '每周',
  scheduledEvery30Min: '每 30 分钟',
  scheduledEveryHour: '每小时',
  scheduledEvery2Hours: '每 2 小时',
  scheduledEvery3Hours: '每 3 小时',
  scheduledEvery4Hours: '每 4 小时',
  scheduledEvery6Hours: '每 6 小时',
  scheduledEvery8Hours: '每 8 小时',
  scheduledEvery12Hours: '每 12 小时',
  scheduledEveryNMinutes: (n: number) => `每 ${n} 分钟`,
} as const;

describe('ScheduledPage formatting', () => {
  it('shows a five minute interval as five minutes, not hourly', () => {
    expect(formatScheduledFrequency({
      frequency: 'interval',
      scheduleConfig: { intervalMinutes: 5 },
    }, t)).toBe('每 5 分钟');
  });

  it('keeps old hourly interval records readable with their real interval', () => {
    expect(formatScheduledFrequency({
      frequency: 'hourly',
      scheduleConfig: { intervalMinutes: 5 },
    }, t)).toBe('每 5 分钟');
  });

  it('does not treat runtime task ids as renderer thread ids', () => {
    const normalized = normalizeScheduledTaskRuntimeLink({
      id: 'scheduled-dream',
      name: 'Dream',
      description: '',
      prompt: '复盘',
      frequency: 'daily',
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
      threadId: 'task_mpfz5w3x_vh8c',
    });

    expect(isRuntimeTaskId('task_mpfz5w3x_vh8c')).toBe(true);
    expect(normalized.runtimeTaskId).toBe('task_mpfz5w3x_vh8c');
    expect(normalized.threadId).toBeUndefined();
  });

  it('merges main runtime task ids with cached renderer thread ids', () => {
    const [merged] = mergeScheduledTaskCache([
      {
        id: 'scheduled-dream',
        name: 'Dream',
        description: '',
        prompt: '复盘',
        frequency: 'daily',
        status: 'active',
        createdAt: 1,
        updatedAt: 3,
        runtimeTaskId: 'task_mpfz5w3x_vh8c',
      },
    ], [
      {
        id: 'scheduled-dream',
        name: 'Dream',
        description: '',
        prompt: '复盘',
        frequency: 'daily',
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
        threadId: 'thread-dream',
      },
    ]);

    expect(merged.runtimeTaskId).toBe('task_mpfz5w3x_vh8c');
    expect(merged.threadId).toBe('thread-dream');
  });

  it('preserves cached descriptions only when main has not persisted one yet', () => {
    const [legacyMerged] = mergeScheduledTaskCache([
      {
        id: 'scheduled-description',
        name: 'Dream',
        description: '',
        prompt: '复盘',
        frequency: 'daily',
        status: 'active',
        createdAt: 1,
        updatedAt: 3,
      },
    ], [
      {
        id: 'scheduled-description',
        name: 'Dream',
        description: '本地编辑过的描述',
        prompt: '复盘',
        frequency: 'daily',
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    const [mainMerged] = mergeScheduledTaskCache([
      {
        id: 'scheduled-description',
        name: 'Dream',
        description: 'main 已持久化的描述',
        prompt: '复盘',
        frequency: 'daily',
        status: 'active',
        createdAt: 1,
        updatedAt: 4,
      },
    ], [
      {
        id: 'scheduled-description',
        name: 'Dream',
        description: '旧本地描述',
        prompt: '复盘',
        frequency: 'daily',
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    expect(legacyMerged.description).toBe('本地编辑过的描述');
    expect(mainMerged.description).toBe('main 已持久化的描述');
  });
});
