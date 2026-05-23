import type { ReminderDeliveryEvent } from './reminder-scheduler.js';
import type { ReminderRecord } from './reminder-store.js';
import type { ScheduledTaskRecord } from './scheduled-task-scheduler.js';
import type { TimedActionStore } from './timed-action-store.js';
import type {
  CreateTimedActionInput,
  TimedActionPolicy,
  TimedActionRecord,
  TimedActionSource,
  TimedActionTrigger,
} from './timed-action-types.js';

export interface CreateScheduledTaskInput {
  id?: string;
  name: string;
  description?: string;
  prompt: string;
  trigger: TimedActionTrigger;
  source?: TimedActionSource;
  createdByTaskId?: string;
  policy?: TimedActionPolicy;
  now?: number;
  nextDueAt?: number;
  lastDueAt?: number;
  lastRuntimeTaskId?: string;
}

export interface UpdateScheduledTaskInput {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  trigger: TimedActionTrigger;
  policy?: TimedActionPolicy;
  now?: number;
  nextDueAt?: number;
}

export interface TimedActionServiceOptions {
  now?: () => number;
}

export class TimedActionService {
  private readonly now: () => number;

  constructor(private readonly store: TimedActionStore, options: TimedActionServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  createReminder(content: string, scheduleAt: number, timezone?: string): ReminderRecord {
    const now = this.now();
    const record = this.store.createAction({
      title: content,
      trigger: { kind: 'once', at: scheduleAt },
      executor: { kind: 'notify', message: content },
      source: 'agent',
      now,
    });
    return this.actionToReminder(record, timezone);
  }

  listReminders(): ReminderRecord[] {
    return this.store
      .listActions({ executorKind: 'notify' })
      .filter(action => action.status === 'active')
      .map(action => this.actionToReminder(action));
  }

  cancelReminder(id: string): boolean {
    const action = this.store.getAction(id);
    if (!action || action.executor.kind !== 'notify') return false;
    return this.store.cancelAction(id, 'reminder cancelled', this.now());
  }

  getReminderStatus(): { pendingCount: number; activeReminders: ReminderRecord[]; desktopNotification: null } {
    const activeReminders = this.listReminders();
    return {
      pendingCount: activeReminders.length,
      activeReminders,
      desktopNotification: null,
    };
  }

  createScheduledTask(input: CreateScheduledTaskInput): ScheduledTaskRecord {
    const now = input.now ?? this.now();
    const source = input.source ?? 'user';
    const policy = this.withScheduledTaskDefaults(input.trigger, input.policy, source, now);
    const createInput: CreateTimedActionInput = {
      id: input.id,
      title: input.name,
      description: input.description ?? '',
      trigger: input.trigger,
      executor: { kind: 'agent_task', prompt: input.prompt },
      policy,
      source,
      createdByTaskId: input.createdByTaskId,
      now,
      nextDueAt: input.nextDueAt,
      lastDueAt: input.lastDueAt,
      lastRuntimeTaskId: input.lastRuntimeTaskId,
    };
    const action = this.store.createAction(createInput);
    return this.actionToScheduledTask(action);
  }

  listScheduledTasks(): ScheduledTaskRecord[] {
    return this.store
      .listActions({ executorKind: 'agent_task' })
      .filter(action => action.status === 'active' || action.status === 'paused')
      .map(action => this.actionToScheduledTask(action));
  }

  updateScheduledTask(input: UpdateScheduledTaskInput): ScheduledTaskRecord | undefined {
    const current = this.store.getAction(input.id);
    if (!current || current.executor.kind !== 'agent_task') return undefined;

    const now = input.now ?? this.now();
    const policy = this.withScheduledTaskDefaults(
      input.trigger,
      input.policy ?? current.policy,
      current.source,
      now
    );
    const updated = this.store.updateActionDefinition(input.id, {
      title: input.name,
      description: input.description ?? current.description ?? '',
      trigger: input.trigger,
      executor: { kind: 'agent_task', prompt: input.prompt },
      policy,
      nextDueAt: input.nextDueAt,
      now,
    });
    return updated ? this.actionToScheduledTask(updated) : undefined;
  }

  cancelScheduledTask(id: string, reason?: string): boolean {
    const action = this.store.getAction(id);
    if (!action || action.executor.kind !== 'agent_task') return false;
    if (this.isTemporaryAgentIntervalTask(action)) {
      return this.store.deleteAction(id);
    }
    return this.store.cancelAction(id, reason ?? 'scheduled task cancelled', this.now());
  }

  getActions(): TimedActionRecord[] {
    return this.store.listActions({ includeInactive: true });
  }

  getRuns(actionId: string) {
    return this.store.listRuns(actionId);
  }

  private withScheduledTaskDefaults(
    trigger: TimedActionTrigger,
    policy: TimedActionPolicy | undefined,
    source: TimedActionSource,
    now: number
  ): TimedActionPolicy {
    const next: TimedActionPolicy = { ...(policy ?? {}) };
    if (trigger.kind === 'interval' && source === 'agent') {
      next.minIntervalMinutes = next.minIntervalMinutes ?? 5;
      if (trigger.intervalMinutes < next.minIntervalMinutes) {
        throw new Error(`intervalMinutes must be at least ${next.minIntervalMinutes}`);
      }
      next.maxRuns = next.maxRuns ?? 288;
      next.expiresAt = next.expiresAt ?? now + 24 * 60 * 60_000;
      next.maxConsecutiveFailures = next.maxConsecutiveFailures ?? 3;
    } else if (source === 'agent') {
      next.maxConsecutiveFailures = next.maxConsecutiveFailures ?? 3;
    }
    return next;
  }

  private actionToReminder(action: TimedActionRecord, timezone?: string): ReminderRecord {
    const content = action.executor.kind === 'notify' ? action.executor.message : action.title;
    return {
      reminderId: action.id,
      content,
      scheduleAt: action.nextDueAt ?? action.lastDueAt ?? action.createdAt,
      timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: action.status === 'active' ? 'pending' : action.status === 'cancelled' ? 'cancelled' : 'sent',
      retryCount: action.consecutiveFailures,
      maxRetry: action.policy.maxConsecutiveFailures ?? 5,
      nextAttemptAt: action.nextDueAt ?? action.createdAt,
      lastError: action.lastError,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      sentAt: action.status === 'completed' ? action.lastDueAt : undefined,
    };
  }

  private actionToScheduledTask(action: TimedActionRecord): ScheduledTaskRecord {
    const prompt = action.executor.kind === 'agent_task' ? action.executor.prompt : '';
    return {
      id: action.id,
      name: action.title,
      prompt,
      frequency: triggerToFrequency(action.trigger),
      status: action.status === 'active' ? 'active' : 'paused',
      nextRunAt: action.nextDueAt,
      lastRunAt: action.lastDueAt,
      scheduleConfig: triggerToScheduleConfig(action.trigger),
      description: action.description ?? '',
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      runtimeTaskId: action.lastRuntimeTaskId,
    } as ScheduledTaskRecord & { description?: string; createdAt?: number; updatedAt?: number };
  }

  private isTemporaryAgentIntervalTask(action: TimedActionRecord): boolean {
    return action.source === 'agent' && action.trigger.kind === 'interval';
  }
}

function triggerToFrequency(trigger: TimedActionTrigger): ScheduledTaskRecord['frequency'] {
  if (trigger.kind === 'interval') return 'interval';
  if (trigger.kind === 'once') return 'manual';
  return trigger.kind;
}

function triggerToScheduleConfig(trigger: TimedActionTrigger): ScheduledTaskRecord['scheduleConfig'] {
  if (trigger.kind === 'interval') return { intervalMinutes: trigger.intervalMinutes };
  if (trigger.kind === 'daily' || trigger.kind === 'weekdays') {
    return { hour: trigger.hour, minute: trigger.minute };
  }
  if (trigger.kind === 'weekly') {
    return { dayOfWeek: trigger.dayOfWeek, hour: trigger.hour, minute: trigger.minute };
  }
  return undefined;
}

export function reminderEventFromAction(action: TimedActionRecord): ReminderDeliveryEvent {
  return {
    reminderId: action.id,
    content: action.executor.kind === 'notify' ? action.executor.message : action.title,
    createdAt: action.createdAt,
  };
}
