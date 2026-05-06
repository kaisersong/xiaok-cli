import { join } from 'node:path';
import { XiaokDaemonHost, type XiaokDaemonRpcContext, type XiaokDaemonService, type XiaokDaemonServiceContext, type XiaokDaemonStatus } from '../daemon/host.js';
import { ReminderDaemonRegistry } from './daemon-registry.js';
import { ReminderDeliveryError, getReminderErrorMessage } from './errors.js';
import { ReminderService } from './service.js';
import type { ReminderNotifier, ReminderNotifierResult, ReminderRecord, RecurrenceConfig } from './types.js';

export interface ReminderDaemonServiceOptions {
  now?: () => number;
  scanIntervalMs?: number;
}

export interface ReminderDaemonServerOptions extends ReminderDaemonServiceOptions {
  socketPath: string;
  heartbeatTimeoutMs?: number;
}

export interface ReminderDaemonStatus extends XiaokDaemonStatus {
  workspaceCount: number;
}

class RegistryReminderNotifier implements ReminderNotifier {
  constructor(private readonly registry: ReminderDaemonRegistry) {}

  async deliver(reminder: ReminderRecord): Promise<ReminderNotifierResult> {
    const sessionId = typeof reminder.deliveryTarget.targetSessionId === 'string'
      ? reminder.deliveryTarget.targetSessionId
      : reminder.sessionId;
    await this.registry.deliverToSession({
      sessionId,
      reminderId: reminder.reminderId,
      content: reminder.content,
      createdAt: reminder.createdAt,
      taskType: reminder.taskType,
      execution: reminder.execution,
    });
    return {};
  }
}

export class ReminderDaemonService implements XiaokDaemonService {
  readonly name = 'reminder';
  private readonly now: () => number;
  private readonly scanIntervalMs: number;
  private readonly registry = new ReminderDaemonRegistry();
  private readonly notifier = new RegistryReminderNotifier(this.registry);
  private readonly services = new Map<string, ReminderService>();
  private context: XiaokDaemonServiceContext | null = null;

  constructor(options: ReminderDaemonServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.scanIntervalMs = options.scanIntervalMs ?? 5_000;
  }

  start(context: XiaokDaemonServiceContext): void {
    this.context = context;
  }

  onClientConnected(client: XiaokDaemonRpcContext['client']): void {
    if (!client.sessionId) {
      return;
    }
    this.registry.register({
      clientInstanceId: client.clientInstanceId,
      sessionId: client.sessionId,
      creatorUserId: client.creatorUserId,
      workspaceRoot: client.workspaceRoot,
      clientVersion: client.clientVersion,
      protocolVersion: client.protocolVersion,
      heartbeatAt: this.now(),
    }, async (delivery) => {
      try {
        this.context?.emitEvent(client.clientInstanceId, 'delivery', {
          sessionId: delivery.sessionId,
          reminderId: delivery.reminderId,
          content: delivery.content,
          message: delivery.taskType === 'scheduled_task' ? delivery.content : `提醒：${delivery.content}`,
          createdAt: delivery.createdAt,
          taskType: delivery.taskType,
          execution: delivery.execution,
        });
      } catch {
        this.registry.unregisterClient(client.clientInstanceId);
        throw new ReminderDeliveryError('target session offline', {
          retryable: false,
          code: 'target_session_offline',
        });
      }
    });
  }

  onClientHeartbeat(client: XiaokDaemonRpcContext['client'], sentAt: number): void {
    this.registry.touchHeartbeat(client.clientInstanceId, sentAt);
  }

  onClientDisconnected(client: XiaokDaemonRpcContext['client']): void {
    this.registry.unregisterClient(client.clientInstanceId);
  }

  async handleRpc(
    context: XiaokDaemonRpcContext,
    _serviceContext: XiaokDaemonServiceContext,
  ): Promise<unknown> {
    const service = await this.getWorkspaceService(context.client.workspaceRoot, context.client.defaultTimeZone);

    switch (context.method) {
      case 'create_from_request':
        return service.createFromRequest({
          sessionId: context.client.sessionId,
          creatorUserId: context.client.creatorUserId,
          request: String(context.params.request ?? ''),
          timezone: typeof context.params.timezone === 'string'
            ? context.params.timezone
            : context.client.defaultTimeZone,
          deliveryTarget: { targetSessionId: context.client.sessionId },
        });
      case 'create_structured':
        return service.createStructured({
          sessionId: context.client.sessionId,
          creatorUserId: context.client.creatorUserId,
          content: String(context.params.content ?? ''),
          scheduleAt: String(context.params.schedule_at ?? ''),
          timezone: typeof context.params.timezone === 'string'
            ? context.params.timezone
            : context.client.defaultTimeZone,
          deliveryTarget: { targetSessionId: context.client.sessionId },
          taskType: context.params.task_type === 'scheduled_task' ? 'scheduled_task' : 'reminder',
          recurrence: typeof context.params.recurrence === 'object' && context.params.recurrence !== null
            ? normalizeRecurrence(context.params.recurrence as Record<string, unknown>)
            : undefined,
          execution: typeof context.params.execution_prompt === 'string'
            ? { prompt: String(context.params.execution_prompt) }
            : undefined,
        });
      case 'list_for_creator':
        return service.listForCreator(context.client.sessionId, context.client.creatorUserId);
      case 'cancel_for_creator':
        return service.cancelForCreator(String(context.params.reminderId ?? ''), context.client.creatorUserId);
      case 'list_tasks':
        return service.listTasksForCreator(context.client.sessionId, context.client.creatorUserId);
      case 'cancel_task':
        return { cancelledCount: service.cancelTaskChain(String(context.params.task_id ?? ''), context.client.creatorUserId) };
      case 'status':
        return {
          activeSessions: this.registry.listActiveSessions().length,
          workspaceCount: this.services.size,
        };
      default:
        throw new Error(`unsupported reminder RPC method: ${context.method}`);
    }
  }

  getWorkspaceCount(): number {
    return this.services.size;
  }

  async runOnceForWorkspace(workspaceRoot: string, defaultTimeZone = 'UTC'): Promise<void> {
    const service = await this.getWorkspaceService(workspaceRoot, defaultTimeZone);
    await service.runOnce();
  }

  async dispose(): Promise<void> {
    for (const service of this.services.values()) {
      await service.dispose();
    }
    this.services.clear();
  }

  private async getWorkspaceService(workspaceRoot: string, defaultTimeZone: string): Promise<ReminderService> {
    const existing = this.services.get(workspaceRoot);
    if (existing) {
      return existing;
    }

    const service = new ReminderService({
      dbPath: join(workspaceRoot, '.xiaok', 'state', 'reminders.sqlite'),
      now: this.now,
      defaultTimeZone,
      notifier: this.notifier,
      scanIntervalMs: this.scanIntervalMs,
    });
    await service.start();
    this.services.set(workspaceRoot, service);
    return service;
  }
}

export class ReminderDaemonServer {
  private readonly service: ReminderDaemonService;
  private readonly host: XiaokDaemonHost;

  constructor(options: ReminderDaemonServerOptions) {
    this.service = new ReminderDaemonService({
      now: options.now,
      scanIntervalMs: options.scanIntervalMs,
    });
    this.host = new XiaokDaemonHost({
      socketPath: options.socketPath,
      now: options.now,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
      services: [this.service],
    });
  }

  async start(): Promise<void> {
    await this.host.start();
  }

  async stop(): Promise<void> {
    await this.host.stop();
  }

  getStatus(): ReminderDaemonStatus {
    return {
      ...this.host.getStatus(),
      workspaceCount: this.service.getWorkspaceCount(),
    };
  }

  async runOnceForWorkspace(workspaceRoot: string, defaultTimeZone = 'UTC'): Promise<void> {
    await this.service.runOnceForWorkspace(workspaceRoot, defaultTimeZone);
  }
}

export function getReminderDaemonErrorMessage(error: unknown): string {
  return getReminderErrorMessage(error);
}

function normalizeRecurrence(input: Record<string, unknown>): RecurrenceConfig | undefined {
  if (input.type !== 'interval') return undefined;
  const intervalMs = typeof input.interval_ms === 'number' ? input.interval_ms : typeof input.intervalMs === 'number' ? input.intervalMs : 0;
  if (intervalMs <= 0) return undefined;
  return {
    type: 'interval',
    intervalMs,
    maxOccurrences: typeof input.max_occurrences === 'number' ? input.max_occurrences : typeof input.maxOccurrences === 'number' ? input.maxOccurrences : undefined,
    occurrenceCount: 0,
  };
}