import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { XiaokDaemonHost, type XiaokDaemonClientInfo, type XiaokDaemonService } from '../../../src/runtime/daemon/host.js';
import {
  XIAOK_DAEMON_PROTOCOL_VERSION,
  createXiaokDaemonRpcId,
  resolveXiaokDaemonSocketPath,
  type XiaokDaemonServerMessage,
} from '../../../src/runtime/daemon/protocol.js';
import { queryXiaokDaemonStatus } from '../../../src/runtime/daemon/control.js';
import { waitFor } from '../../support/wait-for.js';

class TestDaemonClient {
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private socket: Socket | null = null;
  private buffer = '';
  private helloAcked = false;

  constructor(
    private readonly socketPath: string,
    private readonly hello: Pick<XiaokDaemonClientInfo, 'sessionId' | 'creatorUserId' | 'workspaceRoot' | 'defaultTimeZone'>,
  ) {}

  async start(): Promise<void> {
    const socket = createConnection(this.socketPath);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.handleData(chunk);
    });
    socket.on('close', () => {
      this.handleClose();
    });
    socket.on('error', () => {
      this.handleClose();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', (error) => reject(error));
    });

    this.socket = socket;
    socket.write(`${JSON.stringify({
      type: 'hello',
      clientInstanceId: `test_${randomUUID()}`,
      sessionId: this.hello.sessionId,
      creatorUserId: this.hello.creatorUserId,
      workspaceRoot: this.hello.workspaceRoot,
      clientVersion: 'test-client',
      protocolVersion: XIAOK_DAEMON_PROTOCOL_VERSION,
      defaultTimeZone: this.hello.defaultTimeZone,
      sentAt: Date.now(),
    })}\n`);

    await waitFor(() => {
      expect(this.helloAcked).toBe(true);
    });
  }

  async call(service: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error('test daemon client unavailable');
    }

    const id = createXiaokDaemonRpcId();
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    socket.write(`${JSON.stringify({
      type: 'rpc',
      id,
      service,
      method,
      params,
    })}\n`);

    return await result;
  }

  async dispose(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
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

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(JSON.parse(line) as XiaokDaemonServerMessage);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(message: XiaokDaemonServerMessage): void {
    if (message.type === 'hello_ack') {
      this.helloAcked = true;
      return;
    }
    if (message.type === 'rpc_result') {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      pending.resolve(message.result);
      return;
    }
    if (message.type === 'rpc_error') {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      pending.reject(new Error(message.message));
    }
  }

  private handleClose(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('test daemon client unavailable'));
    }
    this.pending.clear();
  }
}

describe('xiaok daemon host', () => {
  const hosts: XiaokDaemonHost[] = [];

  afterEach(async () => {
    for (const host of hosts.splice(0)) {
      await host.stop();
    }
  });

  it('routes service-scoped RPCs and reports generic daemon status', async () => {
    const connectedClients: XiaokDaemonClientInfo[] = [];
    const disconnectedClients: string[] = [];
    const service: XiaokDaemonService = {
      name: 'echo',
      onClientConnected(client) {
        connectedClients.push(client);
      },
      onClientDisconnected(client) {
        disconnectedClients.push(client.clientInstanceId);
      },
      async handleRpc({ method, params }) {
        if (method !== 'echo') {
          throw new Error(`unsupported method: ${method}`);
        }
        return {
          echoed: params.value,
        };
      },
    };

    const socketPath = resolveXiaokDaemonSocketPath(`host-${Date.now()}`);
    const host = new XiaokDaemonHost({
      socketPath,
      services: [service],
    });
    hosts.push(host);
    await host.start();

    const client = new TestDaemonClient(socketPath, {
      sessionId: 'sess_host',
      creatorUserId: 'user_host',
      workspaceRoot: 'D:/projects/xiaok-cli',
      defaultTimeZone: 'Asia/Shanghai',
    });
    await client.start();

    expect(await client.call('echo', 'echo', { value: 42 })).toEqual({ echoed: 42 });
    expect(await queryXiaokDaemonStatus(socketPath)).toMatchObject({
      running: true,
      activeClients: 1,
      activeSessions: 1,
      serviceNames: ['echo'],
    });
    expect(connectedClients).toHaveLength(1);

    await client.dispose();

    await waitFor(() => {
      expect(host.getStatus().activeClients).toBe(0);
      expect(disconnectedClients).toHaveLength(1);
    });
  });

  it('keeps the host healthy when a service RPC fails', async () => {
    const service: XiaokDaemonService = {
      name: 'broken',
      async handleRpc() {
        throw new Error('service exploded');
      },
    };

    const socketPath = resolveXiaokDaemonSocketPath(`host-error-${Date.now()}`);
    const host = new XiaokDaemonHost({
      socketPath,
      services: [service],
    });
    hosts.push(host);
    await host.start();

    const client = new TestDaemonClient(socketPath, {
      sessionId: 'sess_error',
      creatorUserId: 'user_error',
      workspaceRoot: 'D:/projects/xiaok-cli',
      defaultTimeZone: 'Asia/Shanghai',
    });
    await client.start();

    await expect(client.call('broken', 'explode', {})).rejects.toThrow('service exploded');
    expect(await queryXiaokDaemonStatus(socketPath)).toMatchObject({
      running: true,
      activeClients: 1,
      serviceNames: ['broken'],
    });

    await client.dispose();
  });
});
