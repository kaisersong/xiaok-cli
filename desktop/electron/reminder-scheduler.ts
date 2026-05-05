import { BrowserWindow } from 'electron';
import { JsonReminderStore, type ReminderRecord } from './reminder-store.js';

export interface ReminderSchedulerOptions {
  scanIntervalMs?: number;
  staleAfterMs?: number;
  cleanupMaxAgeMs?: number;
}

export interface ReminderDeliveryEvent {
  reminderId: string;
  content: string;
  sessionId?: string;
  createdAt: number;
}

export type DeliveryCallback = (event: ReminderDeliveryEvent) => void;

export class ReminderScheduler {
  private store: JsonReminderStore;
  private scanInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly scanIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly cleanupMaxAgeMs: number;
  private mainWindow: BrowserWindow | null = null;
  private onDelivery: DeliveryCallback | null = null;

  constructor(store: JsonReminderStore, options: ReminderSchedulerOptions = {}) {
    this.store = store;
    this.scanIntervalMs = options.scanIntervalMs ?? 30_000;
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
    this.cleanupMaxAgeMs = options.cleanupMaxAgeMs ?? 7 * 24 * 60 * 60_000;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setOnDelivery(callback: DeliveryCallback): void {
    this.onDelivery = callback;
  }

  start(): void {
    this.recoverOnStartup();
    this.runOnce();
    this.scanInterval = setInterval(() => this.runOnce(), this.scanIntervalMs);
    // Cleanup old reminders every hour
    this.cleanupInterval = setInterval(() => {
      const removed = this.store.cleanup(this.cleanupMaxAgeMs);
      if (removed > 0) {
        console.log(`[reminder] Cleaned up ${removed} old reminders`);
      }
    }, 60 * 60_000);
  }

  private recoverOnStartup(): void {
    const now = Date.now();
    const missed = this.store.recoverMissed(now);
    if (missed.length > 0) {
      console.log(`[reminder] Recovered ${missed.length} missed reminders`);
    }
    const stale = this.store.recoverStaleDelivering(now, this.staleAfterMs);
    if (stale.length > 0) {
      console.log(`[reminder] Recovered ${stale.length} stale delivering states`);
    }
  }

  async runOnce(): Promise<void> {
    const now = Date.now();
    const due = this.store.claimDueReminders(now, 10);

    for (const reminder of due) {
      try {
        await this.deliverReminder(reminder);
      } catch (e) {
        console.error(`[reminder] Failed to deliver ${reminder.reminderId}:`, e);
        this.store.markFailed(reminder.reminderId, Date.now(), String(e));
      }
    }
  }

  private async deliverReminder(reminder: ReminderRecord): Promise<void> {
    // 1. Desktop notification
    await this.showDesktopNotification(reminder);

    // 2. In-app notification
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('desktop:reminder', {
        reminderId: reminder.reminderId,
        content: reminder.content,
        createdAt: reminder.createdAt,
      } as ReminderDeliveryEvent);
    }

    // 3. Callback
    if (this.onDelivery) {
      this.onDelivery({
        reminderId: reminder.reminderId,
        content: reminder.content,
        createdAt: reminder.createdAt,
      });
    }

    // 4. Mark sent
    this.store.markSent(reminder.reminderId, Date.now());
  }

  private async showDesktopNotification(reminder: ReminderRecord): Promise<void> {
    try {
      const electron = await import('electron');
      const Notification = (electron as any).Notification;
      if (typeof Notification !== 'function') {
        // Not in Electron environment (e.g., tests)
        return;
      }
      return new Promise<void>((resolve) => {
        const notification = new Notification({
          title: 'xiaok 提醒',
          body: reminder.content,
          silent: false,
        });

        notification.on('click', () => {
          if (this.mainWindow) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.show();
            this.mainWindow.focus();
          }
          resolve();
        });

        notification.on('close', () => resolve());
        notification.show();

        // Auto-resolve after 10s if not clicked
        setTimeout(resolve, 10_000);
      });
    } catch {
      // Notification not available - silently skip in test environment
    }
  }

  // Public API for creating reminders
  createReminder(content: string, scheduleAt: number, timezone?: string): ReminderRecord {
    return this.store.createReminder({
      content,
      scheduleAt,
      timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  listReminders(): ReminderRecord[] {
    return this.store.listActive();
  }

  cancelReminder(id: string): boolean {
    return this.store.cancelReminder(id);
  }

  getStatus(): { pendingCount: number; activeReminders: ReminderRecord[] } {
    const active = this.store.listActive();
    return {
      pendingCount: active.filter(r => r.status === 'pending').length,
      activeReminders: active,
    };
  }

  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
