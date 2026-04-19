import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const XIAOK_DAEMON_PROTOCOL_VERSION = 1;

export interface XiaokDaemonClientInfo {
  clientInstanceId: string;
  sessionId: string;
  creatorUserId: string;
  workspaceRoot: string;
  clientVersion: string;
  protocolVersion: number;
  defaultTimeZone: string;
}

export interface XiaokDaemonHelloMessage extends XiaokDaemonClientInfo {
  type: 'hello';
  sentAt: number;
}

export interface XiaokDaemonHelloAckMessage {
  type: 'hello_ack';
  daemonVersion: string;
  protocolVersion: number;
  sentAt: number;
}

export interface XiaokDaemonHeartbeatMessage {
  type: 'heartbeat';
  clientInstanceId: string;
  sentAt: number;
}

export interface XiaokDaemonRpcRequestMessage {
  type: 'rpc';
  id: string;
  service: string;
  method: string;
  params: Record<string, unknown>;
}

export interface XiaokDaemonRpcResultMessage {
  type: 'rpc_result';
  id: string;
  result: unknown;
}

export interface XiaokDaemonRpcErrorMessage {
  type: 'rpc_error';
  id: string;
  message: string;
  code?: string;
}

export interface XiaokDaemonServiceEventMessage {
  type: 'service_event';
  service: string;
  name: string;
  payload: Record<string, unknown>;
}

export type XiaokDaemonClientMessage =
  | XiaokDaemonHelloMessage
  | XiaokDaemonHeartbeatMessage
  | XiaokDaemonRpcRequestMessage;

export type XiaokDaemonServerMessage =
  | XiaokDaemonHelloAckMessage
  | XiaokDaemonRpcResultMessage
  | XiaokDaemonRpcErrorMessage
  | XiaokDaemonServiceEventMessage;

export function createXiaokDaemonRpcId(): string {
  return randomUUID();
}

export function resolveXiaokDaemonSocketPath(label?: string): string {
  const base = label ?? `${os.userInfo().username}:${os.homedir()}`;
  const id = createHash('sha256').update(base).digest('hex').slice(0, 16);
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\xiaok-daemon-${id}`;
  }
  return path.join(os.tmpdir(), `xiaok-daemon-${id}.sock`);
}
