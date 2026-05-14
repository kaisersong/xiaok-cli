import { BrowserWindow } from 'electron';

export interface ScheduledTaskRecord {
  id: string;
  name: string;
  prompt: string;
  frequency: 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly';
  status: 'active' | 'paused';
  nextRunAt?: number;
  lastRunAt?: number;
  scheduleConfig?: {
    intervalMinutes?: number;
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
  };
}

export class ScheduledTaskScheduler {
  private tasks: ScheduledTaskRecord[] = [];
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly scanIntervalMs: number;
  private mainWindow: BrowserWindow | null = null;

  constructor(options: { scanIntervalMs?: number } = {}) {
    this.scanIntervalMs = options.scanIntervalMs ?? 30_000;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  syncTasks(tasks: ScheduledTaskRecord[]): void {
    this.tasks = tasks;
  }

  start(): void {
    this.scanInterval = setInterval(() => this.scan(), this.scanIntervalMs);
    // Run once immediately
    this.scan();
  }

  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  private scan(): void {
    const now = Date.now();
    for (const task of this.tasks) {
      if (
        task.status === 'active' &&
        task.frequency !== 'manual' &&
        task.nextRunAt &&
        task.nextRunAt <= now
      ) {
        this.deliver(task);
      }
    }
  }

  private deliver(task: ScheduledTaskRecord): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    console.log(`[scheduled-task] Due: "${task.name}" (${task.id})`);
    this.mainWindow.webContents.send('desktop:scheduledTaskDue', {
      taskId: task.id,
      name: task.name,
      prompt: task.prompt,
    });
  }
}
