import { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createElectronDesktopNotificationPort,
  type DesktopNotificationPort,
  type DesktopNotificationResult,
} from './desktop-notifications.js';

export interface ScheduledTaskRecord {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  frequency: 'manual' | 'hourly' | 'interval' | 'daily' | 'weekdays' | 'weekly';
  status: 'active' | 'paused';
  nextRunAt?: number;
  lastRunAt?: number;
  runtimeTaskId?: string;
  reviewedAt?: number;
  userApprovedAuto?: boolean;
  scheduleConfig?: {
    intervalMinutes?: number;
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
  };
}

type TaskExecutor = (prompt: string) => Promise<{ taskId: string }>;

export function computeNextRunAt(
  frequency: ScheduledTaskRecord['frequency'],
  config: ScheduledTaskRecord['scheduleConfig'],
  fromTime = Date.now()
): number | undefined {
  if (frequency === 'manual' || !config) return undefined;

  if (frequency === 'hourly' || frequency === 'interval') {
    const interval = (config.intervalMinutes || 60) * 60_000;
    return fromTime + interval;
  }

  const hour = config.hour ?? 9;
  const minute = config.minute ?? 0;
  const now = new Date(fromTime);

  if (frequency === 'daily') {
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= fromTime) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  if (frequency === 'weekdays') {
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= fromTime) target.setDate(target.getDate() + 1);
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (frequency === 'weekly') {
    const dayOfWeek = config.dayOfWeek ?? 1;
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    const diff = (dayOfWeek - target.getDay() + 7) % 7;
    if (diff === 0 && target.getTime() <= fromTime) {
      target.setDate(target.getDate() + 7);
    } else {
      target.setDate(target.getDate() + diff);
    }
    return target.getTime();
  }

  return undefined;
}

const SCHEDULED_CONTEXT_PREFIX = `[SYSTEM: 这是用户设置的自动定时任务，请给出友好简洁的回复。]\n\n`;

const EXECUTOR_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const MAX_CONCURRENT = 2;
const STAGGER_MS = 5_000; // 5 seconds between batch executions

export class ScheduledTaskScheduler {
  private tasks: ScheduledTaskRecord[] = [];
  private scanInterval: NodeJS.Timeout | null = null;
  private initialTimeout: NodeJS.Timeout | null = null;
  private readonly scanIntervalMs: number;
  private mainWindow: BrowserWindow | null = null;
  private executor: TaskExecutor | null = null;
  private executing = new Map<string, number>(); // taskId → start timestamp
  private dataDir: string | null = null;
  private pendingQueue: ScheduledTaskRecord[] = [];
  private processingQueue = false;
  private readonly notificationPort: DesktopNotificationPort;
  private lastDesktopNotification: (DesktopNotificationResult & { at: number }) | null = null;

  constructor(options: { scanIntervalMs?: number; dataDir?: string; notificationPort?: DesktopNotificationPort } = {}) {
    this.scanIntervalMs = options.scanIntervalMs ?? 30_000;
    this.dataDir = options.dataDir ?? null;
    this.notificationPort = options.notificationPort ?? createElectronDesktopNotificationPort();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  /**
   * Sync tasks from renderer. Merges: skips tasks currently executing to avoid
   * overwriting in-flight state updates.
   */
  syncTasks(tasks: ScheduledTaskRecord[]): void {
    const incoming = new Map(tasks.map(t => [t.id, t]));
    // Preserve state of currently executing tasks
    for (const [id] of this.executing) {
      const current = this.tasks.find(t => t.id === id);
      if (current) incoming.set(id, current);
    }
    this.tasks = [...incoming.values()];
    // Heal tasks missing nextRunAt (e.g. due to renderer bug overwriting state)
    const now = Date.now();
    for (let i = 0; i < this.tasks.length; i++) {
      const t = this.tasks[i];
      if (t.status === 'active' && t.frequency !== 'manual' && !t.nextRunAt) {
        this.tasks[i] = { ...t, nextRunAt: computeNextRunAt(t.frequency, t.scheduleConfig, now) };
      }
    }
    this.persistToDisk();
  }

  /** Return current task list (main process is source of truth) */
  getTasks(): ScheduledTaskRecord[] {
    return this.tasks;
  }

  getLastDesktopNotification(): (DesktopNotificationResult & { at: number }) | null {
    return this.lastDesktopNotification;
  }

  start(): void {
    this.loadFromDisk();
    this.scanInterval = setInterval(() => this.scan(), this.scanIntervalMs);
    // Run first scan after a short delay to let services initialize
    this.initialTimeout = setTimeout(() => this.scan(), 2_000);
  }

  stop(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  private getStorePath(): string | null {
    if (!this.dataDir) return null;
    return join(this.dataDir, 'scheduled-tasks.json');
  }

  private persistToDisk(): void {
    const storePath = this.getStorePath();
    if (!storePath) return;
    try {
      mkdirSync(this.dataDir!, { recursive: true });
      writeFileSync(storePath, JSON.stringify(this.tasks, null, 2), 'utf-8');
    } catch (e) {
      console.error('[scheduled-task] Failed to persist tasks:', (e as Error).message);
    }
  }

  private loadFromDisk(): void {
    const storePath = this.getStorePath();
    if (!storePath) return;
    try {
      const raw = readFileSync(storePath, 'utf-8');
      const loaded = JSON.parse(raw) as ScheduledTaskRecord[];
      if (Array.isArray(loaded) && loaded.length > 0) {
        // Disk data is loaded unconditionally on startup (before any renderer sync)
        this.tasks = loaded;
        // Heal tasks missing nextRunAt
        const now = Date.now();
        for (let i = 0; i < this.tasks.length; i++) {
          const t = this.tasks[i];
          if (t.status === 'active' && t.frequency !== 'manual' && !t.nextRunAt) {
            this.tasks[i] = { ...t, nextRunAt: computeNextRunAt(t.frequency, t.scheduleConfig, now) };
          }
        }
        console.log(`[scheduled-task] Loaded ${loaded.length} tasks from disk`);
      }
    } catch {
      // File doesn't exist or is invalid — that's fine
    }
  }

  private scan(): void {
    const now = Date.now();

    // Clean up stale executing entries (timeout protection)
    for (const [id, startedAt] of this.executing) {
      if (now - startedAt > EXECUTOR_TIMEOUT_MS) {
        console.warn(`[scheduled-task] Execution timeout for task ${id}, releasing lock`);
        this.executing.delete(id);
      }
    }

    for (const task of this.tasks) {
      if (
        task.status === 'active' &&
        task.frequency !== 'manual' &&
        task.nextRunAt &&
        task.nextRunAt <= now &&
        !this.executing.has(task.id)
      ) {
        this.pendingQueue.push(task);
      }
    }

    if (this.pendingQueue.length > 0 && !this.processingQueue) {
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.pendingQueue.length === 0) {
      this.processingQueue = false;
      return;
    }
    if (this.executing.size >= MAX_CONCURRENT) {
      this.processingQueue = false;
      return;
    }

    this.processingQueue = true;
    const task = this.pendingQueue.shift()!;

    // Skip if already executing (may have been queued twice)
    if (this.executing.has(task.id)) {
      this.processQueue();
      return;
    }

    this.executeTask(task);

    // Stagger next execution
    if (this.pendingQueue.length > 0 && this.executing.size < MAX_CONCURRENT) {
      setTimeout(() => this.processQueue(), STAGGER_MS);
    } else {
      this.processingQueue = false;
    }
  }

  private executeTask(task: ScheduledTaskRecord): void {
    if (!this.executor) {
      // No executor — just advance the schedule
      this.advanceSchedule(task, true);
      return;
    }

    this.executing.set(task.id, Date.now());
    console.log(`[scheduled-task] Executing: "${task.name}" (${task.id})`);

    const prompt = SCHEDULED_CONTEXT_PREFIX + task.prompt;

    // Wrap with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Execution timeout')), EXECUTOR_TIMEOUT_MS);
    });

    Promise.race([this.executor(prompt), timeoutPromise])
      .then((result) => {
        console.log(`[scheduled-task] Completed: "${task.name}"`);
        this.advanceSchedule(task, true, result?.taskId);
      })
      .catch((err) => {
        console.error(`[scheduled-task] Failed: "${task.name}"`, (err as Error).message);
        // On failure: don't advance nextRunAt — will retry on next scan cycle
        this.advanceSchedule(task, false);
      })
      .finally(() => {
        this.executing.delete(task.id);
        // Continue processing queue
        if (this.pendingQueue.length > 0) {
          setTimeout(() => this.processQueue(), STAGGER_MS);
        }
      });
  }

  private advanceSchedule(task: ScheduledTaskRecord, success: boolean, runtimeTaskId?: string): void {
    const now = Date.now();
    if (success) {
      const nextRunAt = computeNextRunAt(task.frequency, task.scheduleConfig, now);
      this.tasks = this.tasks.map(t =>
        t.id === task.id ? { ...t, lastRunAt: now, nextRunAt } : t
      );
    }
    // On failure: leave nextRunAt unchanged so next scan retries
    this.persistToDisk();
    this.notifyRenderer(task, success, runtimeTaskId);
    void this.notifyDesktop(task, success, runtimeTaskId);
  }

  private async notifyDesktop(task: ScheduledTaskRecord, success: boolean, runtimeTaskId?: string): Promise<void> {
    const result = await this.notificationPort.show({
      title: success ? 'xiaok 定时任务已完成' : 'xiaok 定时任务失败',
      body: success
        ? `${task.name}${runtimeTaskId ? `：已生成任务 ${runtimeTaskId}` : ''}`
        : `${task.name} 执行失败，将在下次扫描时重试`,
      silent: false,
      onClick: () => {
        try {
          if (this.mainWindow) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        } catch { /* focus is best-effort */ }
      },
    });
    this.lastDesktopNotification = { ...result, at: Date.now() };
    if (!result.ok && !result.skipped) {
      console.warn('[scheduled-task] Desktop notification failed:', result.reason ?? 'unknown');
    }
  }

  private notifyRenderer(task: ScheduledTaskRecord, success: boolean, runtimeTaskId?: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    // Find the updated task record to send authoritative state
    const current = this.tasks.find(t => t.id === task.id);
    this.mainWindow.webContents.send('desktop:scheduledTaskDue', {
      taskId: task.id,
      runtimeTaskId,
      completed: true,
      success,
      lastRunAt: current?.lastRunAt,
      nextRunAt: current?.nextRunAt,
    });
  }
}
