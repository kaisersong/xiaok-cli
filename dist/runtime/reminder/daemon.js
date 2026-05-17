import { join } from 'node:path';
import { XiaokDaemonHost } from '../daemon/host.js';
import { ReminderDaemonRegistry } from './daemon-registry.js';
import { ReminderDeliveryError, getReminderErrorMessage } from './errors.js';
import { ReminderService } from './service.js';
class RegistryReminderNotifier {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    async deliver(reminder) {
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
export class ReminderDaemonService {
    name = 'reminder';
    now;
    scanIntervalMs;
    registry = new ReminderDaemonRegistry();
    notifier = new RegistryReminderNotifier(this.registry);
    services = new Map();
    context = null;
    constructor(options = {}) {
        this.now = options.now ?? (() => Date.now());
        this.scanIntervalMs = options.scanIntervalMs ?? 5_000;
    }
    start(context) {
        this.context = context;
    }
    onClientConnected(client) {
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
            }
            catch {
                this.registry.unregisterClient(client.clientInstanceId);
                throw new ReminderDeliveryError('target session offline', {
                    retryable: false,
                    code: 'target_session_offline',
                });
            }
        });
    }
    onClientHeartbeat(client, sentAt) {
        this.registry.touchHeartbeat(client.clientInstanceId, sentAt);
    }
    onClientDisconnected(client) {
        this.registry.unregisterClient(client.clientInstanceId);
    }
    async handleRpc(context, _serviceContext) {
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
                        ? normalizeRecurrence(context.params.recurrence)
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
    getWorkspaceCount() {
        return this.services.size;
    }
    async runOnceForWorkspace(workspaceRoot, defaultTimeZone = 'UTC') {
        const service = await this.getWorkspaceService(workspaceRoot, defaultTimeZone);
        await service.runOnce();
    }
    async dispose() {
        for (const service of this.services.values()) {
            await service.dispose();
        }
        this.services.clear();
    }
    async getWorkspaceService(workspaceRoot, defaultTimeZone) {
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
    service;
    host;
    constructor(options) {
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
    async start() {
        await this.host.start();
    }
    async stop() {
        await this.host.stop();
    }
    getStatus() {
        return {
            ...this.host.getStatus(),
            workspaceCount: this.service.getWorkspaceCount(),
        };
    }
    async runOnceForWorkspace(workspaceRoot, defaultTimeZone = 'UTC') {
        await this.service.runOnceForWorkspace(workspaceRoot, defaultTimeZone);
    }
}
export function getReminderDaemonErrorMessage(error) {
    return getReminderErrorMessage(error);
}
function normalizeRecurrence(input) {
    if (input.type !== 'interval')
        return undefined;
    const intervalMs = typeof input.interval_ms === 'number' ? input.interval_ms : typeof input.intervalMs === 'number' ? input.intervalMs : 0;
    if (intervalMs <= 0)
        return undefined;
    return {
        type: 'interval',
        intervalMs,
        maxOccurrences: typeof input.max_occurrences === 'number' ? input.max_occurrences : typeof input.maxOccurrences === 'number' ? input.maxOccurrences : undefined,
        occurrenceCount: 0,
    };
}
