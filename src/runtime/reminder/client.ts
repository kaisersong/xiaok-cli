import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  createReminderRpcId,
  REMINDER_DAEMON_SERVICE,
  REMINDER_DAEMON_PROTOCOL_VERSION,
  resolveXiaokDaemonSocketPath,
  type ReminderEventMessage,
  type ReminderRpcErrorMessage,
  type ReminderRpcResultMessage,
  type ReminderServerMessage,
} from './ipc.js';
import {
  type CreateReminderFromRequestInput,
  type CreateStructuredReminderInput,
  type ReminderApi,
  type ReminderCreateResult,
} from './service.js';
import type { ReminderSink } from './notifier.js';
import type { ReminderRecord } from './types.js';
import { spawnXiaokDaemonDetached } from '../daemon/launcher.js';
import { readXiaokVersion } from './version.js';

export interface ReminderClientServiceOptions {
  workspaceRoot: string;
  sessionId: string;
  creatorUserId: string;
  defaultTimeZone: string;
  socketPath?: string;
  autoStart?: boolean;
  heartbeatIntervalMs?: number;
  reconnectDelayMs?: number;
  clientVersion?: string;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class ReminderClientService implements ReminderApi {
  readonly defaultTimeZone: string;
  readonly sessionId: string;
  readonly creatorUserId: string;
  private readonly workspaceRoot: string;
  private readonly socketPath: string;
  private readonly autoStart: boolean;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectDelayMs: number;
  private readonly clientInstanceId = randomUUID();
  private readonly clientVersion: string;
  private readonly sinks = new Map<string, ReminderSink>();
  private readonly pending = new Map<string, PendingRpc>();
  private socket: Socket | null = null;
  private buffer = '';
  private connectPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private helloResolver: (() => void) | null = null;
  private helloRejecter: ((error: Error) => void) | null = null;
  private disposed = false;

  constructor(options: ReminderClientServiceOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
    this.creatorUserId = options.creatorUserId;
    this.defaultTimeZone = options.defaultTimeZone;
    this.socketPath = options.socketPath ?? resolveXiaokDaemonSocketPath();
    this.autoStart = options.autoStart ?? true;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.clientVersion = options.clientVersion ?? readXiaokVersion();
  }

  async start(): Promise<void> {
    try {
      await this.ensureConnected();
    } catch {
      // Daemon availability must not block the front-end instance.
    }
  }

  registerInChatSink(sessionId: string, sink: ReminderSink): () => void {
    this.sinks.set(sessionId, sink);
    return () => {
      if (this.sinks.get(sessionId) === sink) {
        this.sinks.delete(sessionId);
      }
    };
  }

  async createFromRequest(input: CreateReminderFromRequestInput): Promise<ReminderCreateResult> {
    return this.callRpc('create_from_request', {
      request: input.request,
      timezone: input.timezone,
    }) as Promise<ReminderCreateResult>;
  }

  async createStructured(input: CreateStructuredReminderInput): Promise<ReminderCreateResult> {
    return this.callRpc('create_structured', {
      content: input.content,
      schedule_at: input.scheduleAt,
      timezone: input.timezone,
      task_type: input.taskType,
      recurrence: input.recurrence,
      execution_prompt: input.execution?.prompt,
    }) as Promise<ReminderCreateResult>;
  }

  async listForCreator(_sessionId: string, _creatorUserId: string): Promise<ReminderRecord[]> {
    return this.callRpc('list_for_creator', {}) as Promise<ReminderRecord[]>;
  }

  async listTasksForCreator(_sessionId: string, _creatorUserId: string): Promise<ReminderRecord[]> {
    return this.callRpc('list_tasks', {}) as Promise<ReminderRecord[]>;
  }

  async cancelForCreator(reminderId: string, _creatorUserId: string): Promise<ReminderRecord | undefined> {
    return this.callRpc('cancel_for_creator', { reminderId }) as Promise<ReminderRecord | undefined>;
  }

  async cancelTaskChain(taskId: string, _creatorUserId: string): Promise<number> {
    const result = await this.callRpc('cancel_task', { task_id: taskId }) as { cancelledCount: number };
    return result.cancelledCount ?? 0;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };
        socket.once('close', finish);
        socket.destroy();
        setTimeout(finish, 50);
      });
    }
    for (const pending of this.pending.values()) {
      pending.reject(new Error('xiaok daemon unavailable'));
    }
    this.pending.clear();
  }

  private async callRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error('xiaok daemon unavailable');
    }

    const id = createReminderRpcId();
    const deferred = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    socket.write(`${JSON.stringify({
      type: 'rpc',
      id,
      service: REMINDER_DAEMON_SERVICE,
      method,
      params,
    })}\n`);
    return await deferred;
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed && this.socket.writable) {
      return;
    }
    if (this.connectPromise) {
      return await this.connectPromise;
    }
    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connect(): Promise<void> {
    try {
      await this.openSocket();
      return;
    } catch (error) {
      if (!this.autoStart || this.disposed) {
        throw error;
      }
    }

    await spawnXiaokDaemonDetached(this.socketPath);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await this.openSocket();
  }

  private async openSocket(): Promise<void> {
    const socket = createConnection(this.socketPath);
    this.buffer = '';

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', (error) => reject(error));
    });

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      void this.handleData(chunk);
    });
    socket.on('close', () => {
      this.handleDisconnect();
    });
    socket.on('error', () => {
      this.handleDisconnect();
    });

    this.socket = socket;

    const helloAck = new Promise<void>((resolve, reject) => {
      this.helloResolver = resolve;
      this.helloRejecter = reject;
    });
    socket.write(`${JSON.stringify({
      type: 'hello',
      clientInstanceId: this.clientInstanceId,
      sessionId: this.sessionId,
      creatorUserId: this.creatorUserId,
      workspaceRoot: this.workspaceRoot,
      clientVersion: this.clientVersion,
      protocolVersion: REMINDER_DAEMON_PROTOCOL_VERSION,
      defaultTimeZone: this.defaultTimeZone,
      sentAt: Date.now(),
    })}\n`);
    await helloAck;
    this.startHeartbeat();
  }

  private async handleData(chunk: string): Promise<void> {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line) as ReminderServerMessage;
        this.handleServerMessage(message);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleServerMessage(message: ReminderServerMessage): void {
    switch (message.type) {
      case 'hello_ack':
        this.helloResolver?.();
        this.helloResolver = null;
        this.helloRejecter = null;
        return;
      case 'rpc_result':
        this.resolveRpc(message);
        return;
      case 'rpc_error':
        this.rejectRpc(message);
        return;
      case 'service_event':
        this.dispatchReminder(message);
        return;
      default:
        return;
    }
  }

  private resolveRpc(message: ReminderRpcResultMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    pending.resolve(message.result);
  }

  private rejectRpc(message: ReminderRpcErrorMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      if (message.id === 'hello') {
        this.helloRejecter?.(new Error(message.message));
      }
      return;
    }
    this.pending.delete(message.id);
    pending.reject(new Error(message.message));
  }

  private dispatchReminder(message: ReminderServerMessage): void {
    if (message.type !== 'service_event'
      || message.service !== REMINDER_DAEMON_SERVICE
      || message.name !== 'delivery') {
      return;
    }
    const event = message as ReminderEventMessage;
    const sink = this.sinks.get(event.payload.sessionId);
    if (!sink) {
      return;
    }
    Promise.resolve(sink(event.payload.message, {
      reminderId: event.payload.reminderId,
      sessionId: event.payload.sessionId,
      creatorUserId: this.creatorUserId,
      content: event.payload.content,
      scheduleAt: event.payload.createdAt,
      timezone: this.defaultTimeZone,
      channel: 'in_chat',
      deliveryPolicy: 'bound_session',
      deliveryTarget: { targetSessionId: event.payload.sessionId },
      taskType: event.payload.taskType ?? 'reminder',
      recurrence: event.payload.recurrence,
      execution: event.payload.execution,
      status: 'sent',
      idempotencyKey: `reminder:${event.payload.reminderId}`,
      retryCount: 0,
      maxRetry: 0,
      nextAttemptAt: event.payload.createdAt,
      createdAt: event.payload.createdAt,
      updatedAt: event.payload.createdAt,
      sentAt: event.payload.createdAt,
    })).catch(() => undefined);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.destroyed) {
        return;
      }
      socket.write(`${JSON.stringify({
        type: 'heartbeat',
        clientInstanceId: this.clientInstanceId,
        sentAt: Date.now(),
      })}\n`);
    }, this.heartbeatIntervalMs);
  }

  private handleDisconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.socket = null;

    if (this.helloRejecter) {
      this.helloRejecter(new Error('xiaok daemon unavailable'));
      this.helloResolver = null;
      this.helloRejecter = null;
    }

    for (const pending of this.pending.values()) {
      pending.reject(new Error('xiaok daemon unavailable'));
    }
    this.pending.clear();

    if (this.disposed || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch(() => undefined);
    }, this.reconnectDelayMs);
  }
}
