import { existsSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import type {
  XiaokDaemonClientInfo,
  XiaokDaemonClientMessage,
  XiaokDaemonHeartbeatMessage,
  XiaokDaemonHelloMessage,
  XiaokDaemonRpcRequestMessage,
  XiaokDaemonServerMessage,
} from './protocol.js';
import { XIAOK_DAEMON_PROTOCOL_VERSION } from './protocol.js';
import { readXiaokVersion } from '../reminder/version.js';

export interface XiaokDaemonServiceContext {
  readonly now: () => number;
  emitEvent(clientInstanceId: string, name: string, payload: Record<string, unknown>): void;
  listActiveClients(): XiaokDaemonClientInfo[];
}

export interface XiaokDaemonRpcContext {
  client: XiaokDaemonClientInfo;
  method: string;
  params: Record<string, unknown>;
}

export interface XiaokDaemonService {
  name: string;
  start?(context: XiaokDaemonServiceContext): Promise<void> | void;
  onClientConnected?(client: XiaokDaemonClientInfo, context: XiaokDaemonServiceContext): Promise<void> | void;
  onClientHeartbeat?(client: XiaokDaemonClientInfo, sentAt: number, context: XiaokDaemonServiceContext): Promise<void> | void;
  onClientDisconnected?(client: XiaokDaemonClientInfo, context: XiaokDaemonServiceContext): Promise<void> | void;
  handleRpc(context: XiaokDaemonRpcContext, serviceContext: XiaokDaemonServiceContext): Promise<unknown> | unknown;
  dispose?(): Promise<void> | void;
}

export interface XiaokDaemonHostOptions {
  socketPath: string;
  services?: XiaokDaemonService[];
  now?: () => number;
  heartbeatTimeoutMs?: number;
}

export interface XiaokDaemonStatus {
  running: boolean;
  socketPath: string;
  daemonVersion: string;
  protocolVersion: number;
  activeClients: number;
  activeSessions: number;
  serviceNames: string[];
}

interface ConnectionState {
  socket: Socket;
  buffer: string;
  hello?: XiaokDaemonHelloMessage;
  lastHeartbeatAt?: number;
}

export class XiaokDaemonHost {
  private readonly now: () => number;
  private readonly heartbeatTimeoutMs: number;
  private readonly services = new Map<string, XiaokDaemonService>();
  private readonly serviceContexts = new Map<string, XiaokDaemonServiceContext>();
  private readonly connections = new Map<Socket, ConnectionState>();
  private readonly clientsById = new Map<string, ConnectionState>();
  private server: Server | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: XiaokDaemonHostOptions) {
    this.now = options.now ?? (() => Date.now());
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
    for (const service of options.services ?? []) {
      this.services.set(service.name, service);
      this.serviceContexts.set(service.name, {
        now: this.now,
        emitEvent: (clientInstanceId, name, payload) => {
          this.emitServiceEvent(service.name, clientInstanceId, name, payload);
        },
        listActiveClients: () => this.listActiveClients(),
      });
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.cleanupSocketFile();
    this.server = createServer((socket) => {
      const state: ConnectionState = { socket, buffer: '' };
      this.connections.set(socket, state);

      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        void this.handleData(state, chunk);
      });
      socket.on('close', () => {
        void this.handleDisconnect(state);
      });
      socket.on('error', () => {
        void this.handleDisconnect(state);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.socketPath, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    for (const [name, service] of this.services.entries()) {
      await service.start?.(this.serviceContexts.get(name)!);
    }

    this.heartbeatTimer = setInterval(() => {
      void this.expireStaleConnections();
    }, Math.max(1_000, Math.floor(this.heartbeatTimeoutMs / 2)));
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const socket of this.connections.keys()) {
      socket.destroy();
    }
    this.connections.clear();
    this.clientsById.clear();

    for (const service of this.services.values()) {
      await service.dispose?.();
    }

    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    this.cleanupSocketFile();
  }

  getStatus(): XiaokDaemonStatus {
    const clients = this.listActiveClients();
    const sessionIds = new Set(clients
      .map((client) => client.sessionId)
      .filter((sessionId) => sessionId));
    return {
      running: this.server?.listening === true,
      socketPath: this.options.socketPath,
      daemonVersion: readXiaokVersion(),
      protocolVersion: XIAOK_DAEMON_PROTOCOL_VERSION,
      activeClients: clients.length,
      activeSessions: sessionIds.size,
      serviceNames: Array.from(this.services.keys()).sort(),
    };
  }

  private listActiveClients(): XiaokDaemonClientInfo[] {
    return Array.from(this.clientsById.values())
      .map((state) => state.hello)
      .filter((hello): hello is XiaokDaemonHelloMessage => Boolean(hello))
      .filter((hello) => hello.sessionId.trim().length > 0)
      .map((hello) => ({
        clientInstanceId: hello.clientInstanceId,
        sessionId: hello.sessionId,
        creatorUserId: hello.creatorUserId,
        workspaceRoot: hello.workspaceRoot,
        clientVersion: hello.clientVersion,
        protocolVersion: hello.protocolVersion,
        defaultTimeZone: hello.defaultTimeZone,
      }))
      .sort((left, right) => left.clientInstanceId.localeCompare(right.clientInstanceId));
  }

  private async handleData(state: ConnectionState, chunk: string): Promise<void> {
    state.buffer += chunk;
    let newlineIndex = state.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = state.buffer.slice(0, newlineIndex).trim();
      state.buffer = state.buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line) as XiaokDaemonClientMessage;
        await this.handleMessage(state, message);
      }
      newlineIndex = state.buffer.indexOf('\n');
    }
  }

  private async handleMessage(state: ConnectionState, message: XiaokDaemonClientMessage): Promise<void> {
    switch (message.type) {
      case 'hello':
        await this.handleHello(state, message);
        return;
      case 'heartbeat':
        await this.handleHeartbeat(message);
        return;
      case 'rpc':
        await this.handleRpc(state, message);
        return;
      default:
        return;
    }
  }

  private async handleHello(state: ConnectionState, message: XiaokDaemonHelloMessage): Promise<void> {
    if (message.protocolVersion !== XIAOK_DAEMON_PROTOCOL_VERSION) {
      this.writeMessage(state.socket, {
        type: 'rpc_error',
        id: 'hello',
        message: `protocol mismatch: client=${message.protocolVersion}, daemon=${XIAOK_DAEMON_PROTOCOL_VERSION}`,
        code: 'protocol_mismatch',
      });
      state.socket.destroy();
      return;
    }

    state.hello = message;
    state.lastHeartbeatAt = message.sentAt;
    this.clientsById.set(message.clientInstanceId, state);

    if (message.sessionId.trim().length > 0) {
      for (const [name, service] of this.services.entries()) {
        const client = this.toClientInfo(message);
        const context = this.serviceContexts.get(name)!;
        try {
          await service.onClientConnected?.(client, context);
        } catch {
          continue;
        }
      }
    }

    this.writeMessage(state.socket, {
      type: 'hello_ack',
      daemonVersion: readXiaokVersion(),
      protocolVersion: XIAOK_DAEMON_PROTOCOL_VERSION,
      sentAt: this.now(),
    });
  }

  private async handleHeartbeat(message: XiaokDaemonHeartbeatMessage): Promise<void> {
    const state = this.clientsById.get(message.clientInstanceId);
    if (!state?.hello) {
      return;
    }
    state.lastHeartbeatAt = message.sentAt;
    if (state.hello.sessionId.trim().length === 0) {
      return;
    }
    const client = this.toClientInfo(state.hello);
    for (const [name, service] of this.services.entries()) {
      const context = this.serviceContexts.get(name)!;
      try {
        await service.onClientHeartbeat?.(client, message.sentAt, context);
      } catch {
        continue;
      }
    }
  }

  private async handleRpc(state: ConnectionState, message: XiaokDaemonRpcRequestMessage): Promise<void> {
    if (!state.hello) {
      this.writeMessage(state.socket, {
        type: 'rpc_error',
        id: message.id,
        message: 'hello required before RPC',
        code: 'missing_hello',
      });
      return;
    }

    try {
      const result = message.service === 'daemon'
        ? await this.executeControlRpc(message)
        : await this.executeServiceRpc(this.toClientInfo(state.hello), message);
      this.writeMessage(state.socket, {
        type: 'rpc_result',
        id: message.id,
        result,
      });
    } catch (error) {
      this.writeMessage(state.socket, {
        type: 'rpc_error',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async executeControlRpc(message: XiaokDaemonRpcRequestMessage): Promise<unknown> {
    switch (message.method) {
      case 'status':
        return this.getStatus();
      case 'shutdown':
        setImmediate(() => {
          void this.stop();
        });
        return { ok: true };
      default:
        throw new Error(`unsupported daemon RPC method: ${message.method}`);
    }
  }

  private async executeServiceRpc(
    client: XiaokDaemonClientInfo,
    message: XiaokDaemonRpcRequestMessage,
  ): Promise<unknown> {
    const service = this.services.get(message.service);
    if (!service) {
      throw new Error(`unknown daemon service: ${message.service}`);
    }
    return await service.handleRpc({
      client,
      method: message.method,
      params: message.params,
    }, this.serviceContexts.get(message.service)!);
  }

  private async handleDisconnect(state: ConnectionState): Promise<void> {
    this.connections.delete(state.socket);
    if (!state.hello) {
      return;
    }

    this.clientsById.delete(state.hello.clientInstanceId);
    if (state.hello.sessionId.trim().length === 0) {
      return;
    }
    const client = this.toClientInfo(state.hello);
    for (const [name, service] of this.services.entries()) {
      const context = this.serviceContexts.get(name)!;
      try {
        await service.onClientDisconnected?.(client, context);
      } catch {
        continue;
      }
    }
  }

  private async expireStaleConnections(): Promise<void> {
    const cutoff = this.now() - this.heartbeatTimeoutMs;
    for (const state of this.connections.values()) {
      if (!state.hello || !state.lastHeartbeatAt) {
        continue;
      }
      if (state.lastHeartbeatAt > cutoff) {
        continue;
      }
      state.socket.destroy();
    }
  }

  private emitServiceEvent(
    service: string,
    clientInstanceId: string,
    name: string,
    payload: Record<string, unknown>,
  ): void {
    const state = this.clientsById.get(clientInstanceId);
    if (!state?.socket || state.socket.destroyed || !state.socket.writable) {
      throw new Error(`client unavailable: ${clientInstanceId}`);
    }
    this.writeMessage(state.socket, {
      type: 'service_event',
      service,
      name,
      payload,
    });
  }

  private writeMessage(socket: Socket, message: XiaokDaemonServerMessage): void {
    socket.write(`${JSON.stringify(message)}\n`);
  }

  private toClientInfo(message: XiaokDaemonHelloMessage): XiaokDaemonClientInfo {
    return {
      clientInstanceId: message.clientInstanceId,
      sessionId: message.sessionId,
      creatorUserId: message.creatorUserId,
      workspaceRoot: message.workspaceRoot,
      clientVersion: message.clientVersion,
      protocolVersion: message.protocolVersion,
      defaultTimeZone: message.defaultTimeZone,
    };
  }

  private cleanupSocketFile(): void {
    if (process.platform === 'win32') {
      return;
    }
    if (existsSync(this.options.socketPath)) {
      rmSync(this.options.socketPath, { force: true });
    }
  }
}
