import {z} from 'zod';
import {captureScheduledMutation,captureScheduledTarget,captureScheduledRequest,assertScheduledCreator,assertUserScheduledId} from './scheduled-mutation-authority.js';
import {SCHEDULED_CREATE_INPUT_SCHEMA,SCHEDULED_UPDATE_INPUT_SCHEMA,SCHEDULED_LOOP_CREATE_INPUT_SCHEMA,SCHEDULED_ASSISTANT_INPUT_SCHEMA,SCHEDULED_ROOM_TARGET_SCHEMA,SCHEDULED_ACTION_SCHEMA} from '../shared/scheduled-timed-action-ipc-contract.js';
import {ASSISTANT_EVENING_LOOP_ID,ASSISTANT_MORNING_LOOP_ID,DEFAULT_PERSONAL_ASSISTANT_ID} from './assistant-types.js';
import type { ReminderRecord } from './reminder-store.js';
import type { TimedActionStore } from './timed-action-store.js';
import type {
  CreateTimedActionInput,
  TimedActionPolicy,
  TimedActionRecord,
  TimedActionMutationRequest,
  TimedActionOwnerKind,
  TimedActionOwnership,
  TimedActionSource,
  TimedActionTrigger,
  TimedActionRoomTarget,
} from './timed-action-types.js';

export interface ReminderDeliveryEvent {
  reminderId: string;
  content: string;
  sessionId?: string;
  createdAt: number;
}

export interface ScheduledTaskRecord {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  executorKind: 'agent_task' | 'loop';
  loopId?: string;
  frequency: 'manual' | 'hourly' | 'interval' | 'daily' | 'weekdays' | 'weekly';
  status: 'active' | 'paused';
  source: 'user' | 'agent';
  createdAt: number;
  updatedAt: number;
  automationStoreVersion?: number;
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
  prompt?: string;
  trigger: TimedActionTrigger;
  policy?: TimedActionPolicy;
  now?: number;
  nextDueAt?: number;
  expectedUpdatedAt?: number;
  expectedAutomationStoreVersion?: number;
}

export interface StaleAutomationViewConflict {
  ok: false;
  code: 'stale_automation_view';
  recoverable: true;
  message: string;
  sourceVersions: {
    timedActionStore: number;
  };
  current?: ScheduledTaskRecord;
}

export type UpdateScheduledTaskResult = ScheduledTaskRecord | StaleAutomationViewConflict | undefined;

export interface LoopScheduleBindingSchedule {
  id: string;
  title: string;
  status: 'active' | 'paused';
  trigger: TimedActionTrigger;
  nextDueAt?: number;
  updatedAt: number;
}

export interface LoopScheduleBindingRecord {
  loopId: string;
  kind: 'single' | 'multiple';
  count: number;
  activeCount: number;
  actionIds: string[];
  primaryActionId?: string;
  schedules: LoopScheduleBindingSchedule[];
}

export interface CreateLoopScheduleInput {
  id?: string;
  loopId: string;
  title: string;
  description?: string;
  trigger: TimedActionTrigger;
  source?: TimedActionSource;
  policy?: TimedActionPolicy;
  now?: number;
  nextDueAt?: number;
}

export interface TimedActionServiceOptions {
  now?: () => number;
}

export interface CreateTimedActionOwnership extends TimedActionMutationRequest {
  ownerKind: TimedActionOwnerKind;
  ownerId: string;
}

export class TimedActionService {
  private readonly now: () => number;

  constructor(private readonly store: TimedActionStore, options: TimedActionServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  createReminder(content: string, scheduleAt: number, timezone?: string, ownership?: CreateTimedActionOwnership): ReminderRecord {
    const actor = captureScheduledRequest(ownership);
    assertScheduledCreator(actor, ['user', 'agent']);
    [content, scheduleAt, timezone] = captureScheduledMutation([content, scheduleAt, timezone], z.tuple([z.string(), z.number().finite(), z.string().optional()]));
    const now = this.now();
    const record = this.store.createAction({title: content, trigger: {kind: 'once', at: scheduleAt}, executor: {kind: 'notify', message: content}, source: actor.requestSource === 'user' ? 'user' : 'agent', ownerKind: actor.requestSource === 'user' ? 'user' : 'agent_task', ownerId: actor.requestSource === 'user' ? 'desktop-user' : actor.ownerId!, now});
    return this.actionToReminder(record, timezone);
  }

  listReminders(): ReminderRecord[] {
    return this.store
      .listActions({ executorKind: 'notify' })
      .filter(action => action.status === 'active')
      .map(action => this.actionToReminder(action));
  }

  cancelReminder(id: string, request?: TimedActionMutationRequest): boolean {
    request = captureScheduledRequest(request);
    if (request.requestSource === 'scheduler' || (request.requestSource === 'agent' && !request.ownerId)) return false;
    id = captureScheduledMutation(id, z.string());
    const action = this.getMutationTarget(id);
    if (!action || action.executor.kind !== 'notify') return false;
    if (!this.authorizeTimedActionMutation(action, 'cancel', request)) return false;
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

  createScheduledTask(input: CreateScheduledTaskInput, request?: TimedActionMutationRequest): ScheduledTaskRecord {
    const actor = captureScheduledRequest(request);
    assertScheduledCreator(actor, ['user', 'agent']);
    input = captureScheduledMutation(input, SCHEDULED_CREATE_INPUT_SCHEMA);
    if (actor.requestSource === 'agent') {
      if (input.id !== undefined || (input.source !== undefined && input.source !== 'agent') || (input.createdByTaskId !== undefined && input.createdByTaskId !== actor.ownerId)) throw Error('scheduled_creator_identity_forbidden');
      input = {...input, source: 'agent', createdByTaskId: actor.ownerId};
    } else assertUserScheduledId(input.id);
    return this.createScheduledTaskRecord(input, undefined, {ownerKind: actor.requestSource === 'user' ? 'user' : 'agent_task', ownerId: actor.requestSource === 'user' ? 'desktop-user' : actor.ownerId!});
  }
  createRoomScheduledTask(input: CreateScheduledTaskInput, target: TimedActionRoomTarget, request: TimedActionMutationRequest): ScheduledTaskRecord {
    const actor = captureScheduledRequest(request);
    assertScheduledCreator(actor, ['agent']);
    target = captureScheduledMutation(target, SCHEDULED_ROOM_TARGET_SCHEMA);
    const ownerId = JSON.stringify([target.roomId, target.logicalAgentId]);
    if (actor.ownerId !== ownerId || !target.roomId || !target.logicalAgentId || !target.bindingId || !Number.isSafeInteger(target.generation) || target.generation < 1) throw Error('room_schedule_forbidden');
    input = captureScheduledMutation(input, SCHEDULED_CREATE_INPUT_SCHEMA);
    if (input.id !== undefined || (input.source !== undefined && input.source !== 'agent') || (input.createdByTaskId !== undefined && input.createdByTaskId !== ownerId)) throw Error('scheduled_creator_identity_forbidden');
    return this.createScheduledTaskRecord({...input, source: 'agent', createdByTaskId: ownerId}, target, {ownerKind: 'agent_task', ownerId});
  }
  private createScheduledTaskRecord(input:CreateScheduledTaskInput,roomTarget:TimedActionRoomTarget|undefined,ownership:TimedActionOwnership):ScheduledTaskRecord {
    const now = input.now ?? this.now();
    const source = input.source ?? 'user';
    const policy = this.withScheduledTaskDefaults(input.trigger, input.policy, source, now);
    const createInput: CreateTimedActionInput = {
      id: input.id,
      title: input.name,
      description: input.description ?? '',
      trigger: input.trigger,
      executor: { kind: 'agent_task', prompt: input.prompt, ...(roomTarget?{roomTarget:{...roomTarget}}:{}) },
      userApprovedAuto: roomTarget ? true : undefined,
      policy,
      source,
      createdByTaskId: input.createdByTaskId,
      ownerKind: ownership.ownerKind,
      ownerId: ownership.ownerId,
      now,
      nextDueAt: input.nextDueAt,
      lastDueAt: input.lastDueAt,
      lastRuntimeTaskId: input.lastRuntimeTaskId,
    };
    const action = this.store.createAction(createInput);
    return this.actionToScheduledTask(action);
  }

  createLoopSchedule(input: CreateLoopScheduleInput, request?: TimedActionMutationRequest): TimedActionRecord {
    const actor = captureScheduledRequest(request);
    assertScheduledCreator(actor, ['user']);
    input = captureScheduledMutation(input, SCHEDULED_LOOP_CREATE_INPUT_SCHEMA);
    assertUserScheduledId(input.id);
    const now = input.now ?? this.now();
    const policy: TimedActionPolicy = {
      maxConsecutiveFailures: 3,
      ...(input.policy ?? {}),
    };
    return this.store.createAction({
      id: input.id,
      title: input.title,
      description: input.description ?? '',
      trigger: input.trigger,
      executor: { kind: 'loop', loopId: input.loopId },
      policy,
      source: input.source ?? 'user',
      ownerKind: 'user',
      ownerId: 'desktop-user',
      now,
      nextDueAt: input.nextDueAt,
      userApprovedAuto: false,
    });
  }

  listLoopSchedules(): TimedActionRecord[] {
    return this.store
      .listActions({ executorKind: 'loop' })
      .filter(action => action.status === 'active' || action.status === 'paused');
  }

  listLoopScheduleBindings(): LoopScheduleBindingRecord[] {
    const grouped = new Map<string, TimedActionRecord[]>();
    for (const action of this.listLoopSchedules()) {
      if (action.executor.kind !== 'loop') continue;
      const list = grouped.get(action.executor.loopId) ?? [];
      list.push(action);
      grouped.set(action.executor.loopId, list);
    }

    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([loopId, actions]) => {
        const schedules: LoopScheduleBindingSchedule[] = actions.map(action => ({
          id: action.id,
          title: action.title,
          status: action.status === 'active' ? 'active' : 'paused',
          trigger: action.trigger,
          nextDueAt: action.nextDueAt,
          updatedAt: action.updatedAt,
        }));
        const actionIds = schedules.map(schedule => schedule.id);
        const activeCount = schedules.filter(schedule => schedule.status === 'active').length;
        const base = {
          loopId,
          kind: schedules.length === 1 ? 'single' as const : 'multiple' as const,
          count: schedules.length,
          activeCount,
          actionIds,
          schedules,
        };
        return schedules.length === 1
          ? { ...base, primaryActionId: schedules[0]?.id }
          : base;
      });
  }

  listScheduledTasks(): ScheduledTaskRecord[] {
    return this.store
      .listActions({ executorKinds: ['agent_task', 'loop'] })
      .filter(action => (action.status === 'active' || action.status === 'paused')
        && (action.executor.kind === 'agent_task' || action.executor.kind === 'loop'))
      .map(action => this.actionToScheduledTask(action));
  }

  updateScheduledTask(input: UpdateScheduledTaskInput, request?: TimedActionMutationRequest): UpdateScheduledTaskResult {
    request = captureScheduledRequest(request);
    if (request.requestSource !== 'user') return undefined;
    input = captureScheduledMutation(input, SCHEDULED_UPDATE_INPUT_SCHEMA);
    const current = this.getMutationTarget(input.id);
    if (!current || (current.executor.kind !== 'agent_task' && current.executor.kind !== 'loop')) return undefined;
    if (!this.authorizeTimedActionMutation(current, 'update', request)) return undefined;

    if (current.executor.kind === 'agent_task' && typeof input.prompt !== 'string') throw Error('scheduled_input_invalid');
    const currentStoreVersion = this.store.getAutomationStoreVersion();
    const staleByUpdatedAt = input.expectedUpdatedAt !== undefined && current.updatedAt !== input.expectedUpdatedAt;
    const staleByStoreVersion = input.expectedAutomationStoreVersion !== undefined
      && currentStoreVersion !== input.expectedAutomationStoreVersion;
    if (staleByUpdatedAt || staleByStoreVersion) {
      return {
        ok: false,
        code: 'stale_automation_view',
        recoverable: true,
        message: 'This automation changed elsewhere. Review the latest values before saving again.',
        sourceVersions: { timedActionStore: currentStoreVersion },
        current: this.actionToScheduledTask(current),
      };
    }

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
      executor: current.executor.kind === 'loop'
        ? current.executor
        : { ...current.executor, prompt: input.prompt! },
      policy,
      nextDueAt: input.nextDueAt,
      now,
    });
    return updated ? this.actionToScheduledTask(updated) : undefined;
  }

  cancelScheduledTask(id: string, reason?: string, request?: TimedActionMutationRequest | 'user' | 'agent'): boolean {
    request = captureScheduledRequest(typeof request === 'string' ? {requestSource: request} : request);
    id = captureScheduledMutation(id, z.string());
    reason = captureScheduledMutation(reason, z.string().optional());
    const action = this.getMutationTarget(id);
    if (!action || (action.executor.kind !== 'agent_task' && action.executor.kind !== 'loop')) return false;
    const authority = typeof request === 'string' ? { requestSource: request } : request;
    if (!this.authorizeTimedActionMutation(action, 'cancel', authority)) return false;
    if (this.isTemporaryAgentIntervalTask(action) && authority.requestSource === 'agent') {
      return this.store.deleteAction(id);
    }
    return this.store.cancelAction(id, reason ?? 'scheduled task cancelled', this.now());
  }

  setScheduledTaskStatus(
    id: string,
    status: ScheduledTaskRecord['status'],
    now = this.now(),
    request?: TimedActionMutationRequest
  ): ScheduledTaskRecord | undefined {
    request = captureScheduledRequest(request);
    id = captureScheduledMutation(id, z.string());
    [status, now] = captureScheduledMutation([status, now], z.tuple([z.enum(['active','paused']), z.number().finite()]));
    const action = this.getMutationTarget(id);
    if (!action || (action.executor.kind !== 'agent_task' && action.executor.kind !== 'loop')) return undefined;
    if (!this.authorizeTimedActionMutation(action, 'status', request)) return undefined;
    const updated = this.store.setActionStatus(id, status, now);
    return updated ? this.actionToScheduledTask(updated) : undefined;
  }

  getActions(): TimedActionRecord[] {
    return this.store.listActions({ includeInactive: true });
  }

  getRuns(actionId: string) {
    return this.store.listRuns(actionId);
  }

  approveAuto(id: string, request?: TimedActionMutationRequest): TimedActionRecord | undefined {
    request = captureScheduledRequest(request);
    if (request.requestSource !== 'user') return undefined;
    id = captureScheduledMutation(id, z.string());
    const action = this.getMutationTarget(id);
    if (!action || !this.authorizeTimedActionMutation(action, 'approve', request)) return undefined;
    return this.store.approveAuto(id);
  }

  revokeAuto(id: string, request?: TimedActionMutationRequest): TimedActionRecord | undefined {
    request = captureScheduledRequest(request);
    if (request.requestSource !== 'user') return undefined;
    id = captureScheduledMutation(id, z.string());
    const action = this.getMutationTarget(id);
    if (!action || !this.authorizeTimedActionMutation(action, 'revoke', request)) return undefined;
    return this.store.revokeAuto(id);
  }

  deleteScheduledTask(id: string, request?: TimedActionMutationRequest): boolean {
    request = captureScheduledRequest(request);
    if (request.requestSource !== 'user') return false;
    id = captureScheduledMutation(id, z.string());
    const action = this.getMutationTarget(id);
    if (!action || !this.authorizeTimedActionMutation(action, 'delete', request)) return false;
    return this.store.deleteAction(id);
  }

  ensureAssistantLoopSchedule(input: { id: string; loopId: string; title: string; time: string; timeZone: string; workdays: number[]; status: 'active' | 'paused' }, request?: TimedActionMutationRequest): TimedActionRecord {
    const actor = captureScheduledRequest(request);
    assertScheduledCreator(actor, ['scheduler']);
    if (actor.ownerId !== DEFAULT_PERSONAL_ASSISTANT_ID) throw Error('scheduled_assistant_owner_forbidden');
    input = captureScheduledMutation(input, SCHEDULED_ASSISTANT_INPUT_SCHEMA);
    if (!this.isFixedAssistantIdentity(input.id, input.loopId)) throw Error('scheduled_assistant_identity_forbidden');
    const [hour, minute] = input.time.split(':').map(Number);
    const existing = this.getMutationTarget(input.id);
    if (existing) {
      if (!this.isOwnedFixedAssistant(existing, true)) throw Error('scheduled_assistant_identity_conflict');
      if (existing.status !== input.status) this.store.setActionStatus(existing.id, input.status, this.now());
      return this.store.getAction(existing.id)!;
    }
    return this.store.createAction({
      id: input.id, title: input.title, trigger: { kind: 'daily', hour, minute, timeZone: input.timeZone, daysOfWeek: input.workdays },
      executor: { kind: 'loop', loopId: input.loopId }, source: 'system', ownerKind: 'assistant', ownerId: 'default-personal-assistant',
      status: input.status, now: this.now(), userApprovedAuto: true,
    });
  }

  clearScheduledTaskRunHistory(id: string, statuses?: string[], request?: TimedActionMutationRequest): {ok: true; removed: number} {
    const actor = captureScheduledRequest(request);
    assertScheduledCreator(actor, ['user']);
    [id, statuses] = captureScheduledMutation([id, statuses], z.tuple([z.string().refine(value=>value.trim().length>0), z.array(z.string()).optional()]));
    this.getMutationTarget(id);
    return {ok: true, removed: this.store.clearActionRunHistory(id, statuses)};
  }
  private getMutationTarget(id: string): TimedActionRecord | undefined {
    const action = this.store.getAction(id);
    return action ? captureScheduledTarget(action, SCHEDULED_ACTION_SCHEMA) : undefined;
  }
  private isFixedAssistantIdentity(id: string, loopId: string): boolean {
    return (id === 'assistant:default-personal-assistant:evening' && loopId === ASSISTANT_EVENING_LOOP_ID) || (id === 'assistant:default-personal-assistant:morning' && loopId === ASSISTANT_MORNING_LOOP_ID);
  }
  private isOwnedFixedAssistant(action: TimedActionRecord, allowLegacy = false): boolean {
    return action.source === 'system' && action.executor.kind === 'loop' && this.isFixedAssistantIdentity(action.id, action.executor.loopId) && ((action.ownerKind === 'assistant' && action.ownerId === DEFAULT_PERSONAL_ASSISTANT_ID) || (allowLegacy && action.ownerKind === 'migration' && action.ownerId === 'legacy-migration'));
  }
  private authorizeTimedActionMutation(action: TimedActionRecord, operation: 'update' | 'status' | 'cancel' | 'approve' | 'revoke' | 'delete', request: TimedActionMutationRequest): boolean {
    if (request.requestSource === 'user') return true;
    if (request.requestSource === 'scheduler') return request.ownerId === DEFAULT_PERSONAL_ASSISTANT_ID && operation === 'status' && this.isOwnedFixedAssistant(action, true);
    return request.requestSource === 'agent' && action.source === 'agent' && action.ownerKind === 'agent_task' && !!request.ownerId && request.ownerId === action.ownerId && operation === 'cancel' && (action.executor.kind === 'notify' || this.isTemporaryAgentIntervalTask(action));
  }

  private withScheduledTaskDefaults(
    trigger: TimedActionTrigger,
    policy: TimedActionPolicy | undefined,
    source: TimedActionSource,
    now: number
  ): TimedActionPolicy {
    const next: TimedActionPolicy = { ...(policy ?? {}) };
    if (trigger.kind === 'interval' && source === 'agent') {
      next.minIntervalMinutes = next.minIntervalMinutes ?? 0.5;
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
    const executorKind = action.executor.kind === 'loop' ? 'loop' : 'agent_task';
    const prompt = action.executor.kind === 'agent_task' ? action.executor.prompt : '';
    const loopId = action.executor.kind === 'loop' ? action.executor.loopId : undefined;
    return {
      id: action.id,
      name: action.title,
      prompt,
      executorKind,
      loopId,
      frequency: triggerToFrequency(action.trigger),
      status: action.status === 'active' ? 'active' : 'paused',
      source: action.source === 'agent' ? 'agent' : 'user',
      nextRunAt: action.nextDueAt,
      lastRunAt: action.lastDueAt,
      scheduleConfig: triggerToScheduleConfig(action.trigger),
      description: action.description ?? '',
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      runtimeTaskId: action.lastRuntimeTaskId,
      reviewedAt: action.reviewedAt,
      userApprovedAuto: action.userApprovedAuto ?? false,
      automationStoreVersion: this.store.getAutomationStoreVersion(),
    };
  }

  private isTemporaryAgentIntervalTask(action: TimedActionRecord): boolean {
    return action.ownerKind === 'agent_task' && action.trigger.kind === 'interval';
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
