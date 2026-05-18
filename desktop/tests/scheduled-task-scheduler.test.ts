import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock electron before importing the scheduler
vi.mock('electron', () => ({
  BrowserWindow: class {},
}));

import { ScheduledTaskScheduler, computeNextRunAt, type ScheduledTaskRecord } from '../electron/scheduled-task-scheduler.js';

function makeTask(overrides: Partial<ScheduledTaskRecord> = {}): ScheduledTaskRecord {
  return {
    id: `task_${Math.random().toString(36).slice(2)}`,
    name: 'Test Task',
    prompt: 'do something',
    frequency: 'hourly',
    status: 'active',
    nextRunAt: Date.now() - 1000,
    scheduleConfig: { intervalMinutes: 60 },
    ...overrides,
  };
}

function createMockWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn(),
    },
  } as any;
}

function createNotificationRecorder() {
  const notifications: Array<{ title: string; body: string }> = [];
  return {
    notifications,
    port: {
      show: vi.fn(async (input: { title: string; body: string }) => {
        notifications.push({ title: input.title, body: input.body });
        return { ok: true };
      }),
    },
  };
}

/** Flush microtask queue (let promises resolve) — process.nextTick is never faked */
function flushPromises(): Promise<void> {
  return new Promise(resolve => process.nextTick(resolve));
}

// ─── computeNextRunAt ──────────────────────────────────────────────

describe('computeNextRunAt', () => {
  it('returns undefined for manual frequency', () => {
    expect(computeNextRunAt('manual', {})).toBeUndefined();
  });

  it('returns undefined when no config', () => {
    expect(computeNextRunAt('hourly', undefined)).toBeUndefined();
  });

  it('computes hourly interval correctly', () => {
    const base = 1_000_000;
    const result = computeNextRunAt('hourly', { intervalMinutes: 30 }, base);
    expect(result).toBe(base + 30 * 60_000);
  });

  it('defaults hourly to 60 minutes', () => {
    const base = 1_000_000;
    const result = computeNextRunAt('hourly', {}, base);
    expect(result).toBe(base + 60 * 60_000);
  });

  it('computes daily — next day if time already passed', () => {
    const fromTime = new Date('2024-01-15T10:00:00').getTime();
    const result = computeNextRunAt('daily', { hour: 9, minute: 0 }, fromTime)!;
    const d = new Date(result);
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it('computes daily — same day if time not yet passed', () => {
    const fromTime = new Date('2024-01-15T08:00:00').getTime();
    const result = computeNextRunAt('daily', { hour: 9, minute: 30 }, fromTime)!;
    const d = new Date(result);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('computes weekdays — skips weekend', () => {
    // 2024-01-12 is Friday 18:00
    const fromTime = new Date('2024-01-12T18:00:00').getTime();
    const result = computeNextRunAt('weekdays', { hour: 9, minute: 0 }, fromTime)!;
    const d = new Date(result);
    expect(d.getDay()).toBe(1); // Monday
    expect(d.getDate()).toBe(15);
  });

  it('computes weekly — next occurrence of dayOfWeek', () => {
    // 2024-01-15 is Monday, config says Wednesday (3)
    const fromTime = new Date('2024-01-15T08:00:00').getTime();
    const result = computeNextRunAt('weekly', { hour: 10, minute: 0, dayOfWeek: 3 }, fromTime)!;
    const d = new Date(result);
    expect(d.getDay()).toBe(3); // Wednesday
    expect(d.getDate()).toBe(17);
  });

  it('computes weekly — same day but time passed, goes to next week', () => {
    // 2024-01-15 is Monday 11:00, config says Monday (1) at 10:00
    const fromTime = new Date('2024-01-15T11:00:00').getTime();
    const result = computeNextRunAt('weekly', { hour: 10, minute: 0, dayOfWeek: 1 }, fromTime)!;
    const d = new Date(result);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(22); // next Monday
  });

  it('defaults to hour=9, minute=0 when not specified', () => {
    const fromTime = new Date('2024-01-15T10:00:00').getTime();
    const result = computeNextRunAt('daily', {}, fromTime)!;
    const d = new Date(result);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it('weekly defaults to Monday when dayOfWeek not specified', () => {
    // 2024-01-17 is Wednesday
    const fromTime = new Date('2024-01-17T08:00:00').getTime();
    const result = computeNextRunAt('weekly', { hour: 9, minute: 0 }, fromTime)!;
    const d = new Date(result);
    expect(d.getDay()).toBe(1); // Monday (default)
  });
});

// ─── ScheduledTaskScheduler ────────────────────────────────────────

describe('ScheduledTaskScheduler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `xiaok-sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // Helper: advance timers and flush promises to let async executor resolve
  async function tick(ms: number) {
    vi.advanceTimersByTime(ms);
    // Flush multiple rounds to let chained .then/.finally resolve
    for (let i = 0; i < 5; i++) {
      await flushPromises();
      vi.advanceTimersByTime(0);
    }
  }

  // ─── Basic execution ─────────────────────────────────────────────

  it('executes due tasks via executor', async () => {
    const executed: string[] = [];
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 10_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async (prompt) => {
      executed.push(prompt);
      return { taskId: 'result_1' };
    });

    const task = makeTask({ nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();

    await tick(2_000); // initial scan fires after 2s delay

    expect(executed.length).toBe(1);
    expect(executed[0]).toContain('do something');
    expect(executed[0]).toContain('[SYSTEM:');
    scheduler.stop();
  });

  it('does not execute paused tasks', async () => {
    const executed: string[] = [];
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 10_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async (prompt) => {
      executed.push(prompt);
      return { taskId: 'r' };
    });

    const task = makeTask({ status: 'paused', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(executed).toHaveLength(0);
    scheduler.stop();
  });

  it('does not execute manual tasks', async () => {
    const executed: string[] = [];
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 10_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async (prompt) => {
      executed.push(prompt);
      return { taskId: 'r' };
    });

    const task = makeTask({ frequency: 'manual', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(executed).toHaveLength(0);
    scheduler.stop();
  });

  it('does not execute tasks whose nextRunAt is in the future', async () => {
    const executed: string[] = [];
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 10_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async (prompt) => {
      executed.push(prompt);
      return { taskId: 'r' };
    });

    const task = makeTask({ nextRunAt: Date.now() + 999_999 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(executed).toHaveLength(0);
    scheduler.stop();
  });

  it('does not execute tasks without nextRunAt', async () => {
    const executed: string[] = [];
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 10_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async (prompt) => {
      executed.push(prompt);
      return { taskId: 'r' };
    });

    const task = makeTask({ nextRunAt: undefined });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(executed).toHaveLength(0);
    scheduler.stop();
  });

  // ─── Concurrency control ─────────────────────────────────────────

  it('respects MAX_CONCURRENT=2 — does not run more than 2 tasks simultaneously', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    const resolvers: Array<() => void> = [];

    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise<void>(resolve => resolvers.push(resolve));
      concurrentCount--;
      return { taskId: 'r' };
    });

    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `task_${i}`, nextRunAt: Date.now() - 1000 })
    );
    scheduler.syncTasks(tasks);
    scheduler.start();

    // First scan + first processQueue
    await tick(2_000);
    // Stagger delay for second task
    await tick(5_000);
    // Another stagger
    await tick(5_000);

    expect(maxConcurrent).toBeLessThanOrEqual(2);

    // Cleanup
    resolvers.forEach(r => r());
    await flushPromises();
    scheduler.stop();
  });

  it('does not double-execute the same task while it is in-flight', async () => {
    let execCount = 0;
    let resolver: (() => void) | null = null;

    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 500, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => {
      execCount++;
      await new Promise<void>(resolve => { resolver = resolve; });
      return { taskId: 'r' };
    });

    const task = makeTask({ id: 'dedup_test', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();

    // First scan triggers execution
    await tick(2_000);
    expect(execCount).toBe(1);

    // Additional scan cycles — task still executing
    await tick(500);
    await tick(500);
    expect(execCount).toBe(1);

    resolver!();
    await flushPromises();
    scheduler.stop();
  });

  // ─── State advancement ────────────────────────────────────────────

  it('advances nextRunAt and sets lastRunAt on success', async () => {
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => ({ taskId: 'r' }));

    const task = makeTask({
      id: 'adv_test',
      frequency: 'hourly',
      scheduleConfig: { intervalMinutes: 60 },
      nextRunAt: Date.now() - 1000,
    });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    const updated = scheduler.getTasks().find(t => t.id === 'adv_test')!;
    expect(updated.lastRunAt).toBeGreaterThan(0);
    expect(updated.nextRunAt).toBeGreaterThan(Date.now());
    scheduler.stop();
  });

  it('does NOT advance nextRunAt on failure — allows retry', async () => {
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => { throw new Error('network error'); });

    const originalNextRunAt = Date.now() - 1000;
    const task = makeTask({
      id: 'fail_test',
      nextRunAt: originalNextRunAt,
    });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    const updated = scheduler.getTasks().find(t => t.id === 'fail_test')!;
    expect(updated.nextRunAt).toBe(originalNextRunAt);
    expect(updated.lastRunAt).toBeUndefined();
    scheduler.stop();
  });

  // ─── Renderer notification ────────────────────────────────────────

  it('notifies renderer with authoritative state on success', async () => {
    const window = createMockWindow();
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(window);
    scheduler.setExecutor(async () => ({ taskId: 'runtime_task_123' }));

    const task = makeTask({ id: 'notify_ok', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(window.webContents.send).toHaveBeenCalledWith(
      'desktop:scheduledTaskDue',
      expect.objectContaining({
        taskId: 'notify_ok',
        runtimeTaskId: 'runtime_task_123',
        completed: true,
        success: true,
        lastRunAt: expect.any(Number),
        nextRunAt: expect.any(Number),
      })
    );
    scheduler.stop();
  });

  it('notifies renderer with success=false on failure', async () => {
    const window = createMockWindow();
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(window);
    scheduler.setExecutor(async () => { throw new Error('fail'); });

    const task = makeTask({ id: 'notify_fail', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(window.webContents.send).toHaveBeenCalledWith(
      'desktop:scheduledTaskDue',
      expect.objectContaining({
        taskId: 'notify_fail',
        completed: true,
        success: false,
      })
    );
    scheduler.stop();
  });

  it('notifies macOS notification port when a background task succeeds', async () => {
    const notification = createNotificationRecorder();
    const scheduler = new ScheduledTaskScheduler({
      scanIntervalMs: 60_000,
      dataDir: tmpDir,
      notificationPort: notification.port,
    });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => ({ taskId: 'runtime_task_456' }));

    const task = makeTask({ id: 'notify_desktop_ok', name: '每日复盘', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);
    await flushPromises();

    expect(notification.notifications).toEqual([
      {
        title: 'xiaok 定时任务已完成',
        body: '每日复盘：已生成任务 runtime_task_456',
      },
    ]);
    expect(scheduler.getLastDesktopNotification()).toMatchObject({ ok: true });
    scheduler.stop();
  });

  it('notifies macOS notification port when a background task fails', async () => {
    const notification = createNotificationRecorder();
    const scheduler = new ScheduledTaskScheduler({
      scanIntervalMs: 60_000,
      dataDir: tmpDir,
      notificationPort: notification.port,
    });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => { throw new Error('fail'); });

    const task = makeTask({ id: 'notify_desktop_fail', name: '外贸趋势分析', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);
    await flushPromises();

    expect(notification.notifications).toEqual([
      {
        title: 'xiaok 定时任务失败',
        body: '外贸趋势分析 执行失败，将在下次扫描时重试',
      },
    ]);
    expect(scheduler.getLastDesktopNotification()).toMatchObject({ ok: true });
    scheduler.stop();
  });

  it('does not throw when window is destroyed', async () => {
    const window = {
      isDestroyed: () => true,
      webContents: { send: vi.fn() },
    } as any;

    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(window);
    scheduler.setExecutor(async () => ({ taskId: 'r' }));

    const task = makeTask({ nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    expect(window.webContents.send).not.toHaveBeenCalled();
    scheduler.stop();
  });

  // ─── Persistence ──────────────────────────────────────────────────

  it('persists tasks to disk on syncTasks', () => {
    const scheduler = new ScheduledTaskScheduler({ dataDir: tmpDir });
    const tasks = [makeTask({ id: 'persist_1', name: 'Persisted' })];
    scheduler.syncTasks(tasks);

    const raw = readFileSync(join(tmpDir, 'scheduled-tasks.json'), 'utf-8');
    const saved = JSON.parse(raw);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('persist_1');
    expect(saved[0].name).toBe('Persisted');
  });

  it('loads tasks from disk on start', () => {
    const s1 = new ScheduledTaskScheduler({ dataDir: tmpDir });
    s1.syncTasks([makeTask({ id: 'load_1', name: 'FromDisk' })]);

    const s2 = new ScheduledTaskScheduler({ dataDir: tmpDir });
    s2.start();
    s2.stop();
    expect(s2.getTasks()).toHaveLength(1);
    expect(s2.getTasks()[0].name).toBe('FromDisk');
  });

  it('persists updated state after successful execution', async () => {
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => ({ taskId: 'r' }));

    const task = makeTask({ id: 'persist_exec', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    const raw = readFileSync(join(tmpDir, 'scheduled-tasks.json'), 'utf-8');
    const saved = JSON.parse(raw);
    const t = saved.find((s: any) => s.id === 'persist_exec');
    expect(t.lastRunAt).toBeGreaterThan(0);
    expect(t.nextRunAt).toBeGreaterThan(Date.now());
    scheduler.stop();
  });

  // ─── Merge logic ──────────────────────────────────────────────────

  it('syncTasks preserves in-flight task state', async () => {
    let resolver: (() => void) | null = null;
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => {
      await new Promise<void>(resolve => { resolver = resolve; });
      return { taskId: 'r' };
    });

    const task = makeTask({ id: 'merge_test', name: 'Original', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    // Renderer syncs stale data for executing task + a new task
    const staleTask = { ...task, name: 'StaleOverwrite' };
    const otherTask = makeTask({ id: 'other', name: 'Other' });
    scheduler.syncTasks([staleTask, otherTask]);

    const current = scheduler.getTasks().find(t => t.id === 'merge_test')!;
    expect(current.name).toBe('Original'); // preserved

    expect(scheduler.getTasks().find(t => t.id === 'other')).toBeDefined();

    resolver!();
    await flushPromises();
    scheduler.stop();
  });

  // ─── Timeout protection ───────────────────────────────────────────

  it('cleans up stale executing entries after timeout', async () => {
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 1000, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => {
      // Simulate hung executor — never resolves
      await new Promise<void>(() => {});
      return { taskId: 'r' };
    });

    const task = makeTask({ id: 'timeout_task', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();

    // First scan starts execution
    await tick(2_000);

    // Advance past 5-minute timeout + trigger another scan
    vi.advanceTimersByTime(5 * 60_000 + 1_000);
    await flushPromises();

    // The task's nextRunAt should remain unchanged (not advanced on timeout/failure)
    const t = scheduler.getTasks().find(t => t.id === 'timeout_task')!;
    expect(t.nextRunAt).toBe(task.nextRunAt);

    scheduler.stop();
  });

  // ─── getTasks / stop ──────────────────────────────────────────────

  it('getTasks returns current state', () => {
    const scheduler = new ScheduledTaskScheduler({ dataDir: tmpDir });
    expect(scheduler.getTasks()).toEqual([]);

    scheduler.syncTasks([makeTask({ id: 'get_1' }), makeTask({ id: 'get_2' })]);
    expect(scheduler.getTasks()).toHaveLength(2);
  });

  it('stop prevents further scans from triggering', async () => {
    const executed: string[] = [];
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 100, dataDir: tmpDir });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async (p) => { executed.push(p); return { taskId: 'r' }; });

    scheduler.start();
    scheduler.stop(); // stop immediately

    // Sync tasks AFTER stop
    scheduler.syncTasks([makeTask({ nextRunAt: Date.now() - 1000 })]);

    // Even if timers advance, no execution should occur
    await tick(10_000);

    expect(executed).toHaveLength(0);
  });

  // ─── No executor ──────────────────────────────────────────────────

  it('advances schedule without error when no executor is set', async () => {
    const window = createMockWindow();
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000, dataDir: tmpDir });
    scheduler.setMainWindow(window);
    // No executor set

    const task = makeTask({ id: 'no_exec', nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    const updated = scheduler.getTasks().find(t => t.id === 'no_exec')!;
    expect(updated.lastRunAt).toBeGreaterThan(0);
    expect(updated.nextRunAt).toBeGreaterThan(Date.now());
    scheduler.stop();
  });

  // ─── No dataDir ───────────────────────────────────────────────────

  it('works without dataDir (no persistence, no crash)', async () => {
    const scheduler = new ScheduledTaskScheduler({ scanIntervalMs: 60_000 });
    scheduler.setMainWindow(createMockWindow());
    scheduler.setExecutor(async () => ({ taskId: 'r' }));

    const task = makeTask({ nextRunAt: Date.now() - 1000 });
    scheduler.syncTasks([task]);
    scheduler.start();
    await tick(2_000);

    const updated = scheduler.getTasks().find(t => t.id === task.id)!;
    expect(updated.lastRunAt).toBeGreaterThan(0);
    scheduler.stop();
  });

  // ─── nextRunAt healing ────────────────────────────────────────────

  it('syncTasks heals active non-manual tasks with missing nextRunAt', () => {
    const scheduler = new ScheduledTaskScheduler({ dataDir: tmpDir });
    const task = makeTask({
      id: 'heal_sync',
      frequency: 'daily',
      status: 'active',
      scheduleConfig: { hour: 9, minute: 0 },
      nextRunAt: undefined,
    });
    scheduler.syncTasks([task]);

    const healed = scheduler.getTasks().find(t => t.id === 'heal_sync')!;
    expect(healed.nextRunAt).toBeGreaterThan(0);
  });

  it('syncTasks does not overwrite existing nextRunAt', () => {
    const scheduler = new ScheduledTaskScheduler({ dataDir: tmpDir });
    const futureTime = Date.now() + 999_999;
    const task = makeTask({
      id: 'heal_no_overwrite',
      frequency: 'hourly',
      status: 'active',
      scheduleConfig: { intervalMinutes: 60 },
      nextRunAt: futureTime,
    });
    scheduler.syncTasks([task]);

    const result = scheduler.getTasks().find(t => t.id === 'heal_no_overwrite')!;
    expect(result.nextRunAt).toBe(futureTime);
  });

  it('loadFromDisk heals tasks with missing nextRunAt', () => {
    // Write a task with missing nextRunAt to disk
    const task = makeTask({
      id: 'heal_disk',
      frequency: 'hourly',
      status: 'active',
      scheduleConfig: { intervalMinutes: 30 },
      nextRunAt: undefined,
    });
    const { writeFileSync, mkdirSync } = require('node:fs');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'scheduled-tasks.json'), JSON.stringify([task]));

    const scheduler = new ScheduledTaskScheduler({ dataDir: tmpDir });
    scheduler.start();
    scheduler.stop();

    const healed = scheduler.getTasks().find(t => t.id === 'heal_disk')!;
    expect(healed.nextRunAt).toBeGreaterThan(0);
  });
});
