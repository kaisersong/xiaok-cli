/**
 * MCP Transport Client Implementations
 *
 * 支持 stdio/sse/http/ws 四种 transport
 * 使用 @modelcontextprotocol/client v2 提供的 transport classes
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type ClientOptions,
  type ProtocolEra,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { WebSocket } from 'ws';
import type {
  McpServerConfig,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHTTPServerConfig,
  McpProtocolPolicy,
  McpWebSocketServerConfig,
} from './types.js';

const MCP_STDERR_TAIL = Symbol('mcpStderrTail');
const STDERR_TAIL_LIMIT = 4096;

export class InPlaceStdioClientTransport extends StdioClientTransport {}

export interface McpClientConnectionOptions {
  cwd?: string;
  clientName?: string;
}

/**
 * MCP Client Connection
 */
export interface McpClientConnection {
  client: Client;
  protocolEra: ProtocolEra;
  getStderrTail(): string;
  /** stdio child pid captured at connect time, null for network transports. */
  getChildPid(): number | null;
  /** Awaits client shutdown and, for stdio servers, full child process exit. */
  close(): Promise<void>;
  dispose(): void;
}

export type McpConnectionResult =
  | { status: 'connected'; connection: McpClientConnection }
  | { status: 'disabled'; serverName: string; error: Error };

export const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 3_000;
export const DEFAULT_MCP_CATALOG_TIMEOUT_MS = 10_000;
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 120_000;
export const DEFAULT_MCP_RESOURCE_TIMEOUT_MS = 30_000;

export function resolveMcpStartupTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePositiveTimeout(env.XIAOK_MCP_STARTUP_TIMEOUT_MS, DEFAULT_MCP_STARTUP_TIMEOUT_MS);
}

export function resolveMcpCatalogTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePositiveTimeout(env.XIAOK_MCP_CATALOG_TIMEOUT_MS, DEFAULT_MCP_CATALOG_TIMEOUT_MS);
}

export function resolveMcpCallToolTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePositiveTimeout(env.XIAOK_MCP_CALL_TIMEOUT_MS, DEFAULT_MCP_CALL_TIMEOUT_MS);
}

export function resolveMcpResourceTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePositiveTimeout(env.XIAOK_MCP_RESOURCE_TIMEOUT_MS, DEFAULT_MCP_RESOURCE_TIMEOUT_MS);
}

function resolvePositiveTimeout(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveMcpClientVersion(): string {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(moduleDir, '..', '..', '..', 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createMcpClientOptions(
  probeTimeoutMs: number = resolveMcpStartupTimeoutMs(),
  protocol: McpProtocolPolicy = { mode: 'auto' },
): ClientOptions {
  const mode = protocol.mode === 'modern'
    ? { pin: protocol.version }
    : protocol.mode;
  return {
    capabilities: {},
    versionNegotiation: {
      mode,
      ...(protocol.mode === 'legacy'
        ? {}
        : {
            probe: {
              timeoutMs: probeTimeoutMs,
              maxRetries: 0,
            },
          }),
    },
  };
}

export function createMcpSdkClient(
  probeTimeoutMs: number = resolveMcpStartupTimeoutMs(),
  protocol: McpProtocolPolicy = { mode: 'auto' },
  clientName = 'xiaok-cli',
): Client {
  return new Client(
    { name: clientName, version: resolveMcpClientVersion() },
    createMcpClientOptions(probeTimeoutMs, protocol),
  );
}

export function resolveStdioCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if ((command === 'python' || command === 'python3') && env.XIAOK_PYTHON_CMD) {
    return env.XIAOK_PYTHON_CMD;
  }

  if (platform === 'win32' && command === 'python3') {
    return 'python';
  }

  return command;
}

/**
 * 创建 MCP client 连接（统一入口）
 */
export async function createMcpClientConnection(
  serverName: string,
  config: McpServerConfig,
  options: McpClientConnectionOptions = {},
): Promise<McpClientConnection> {
  const startupTimeoutMs = config.timeout?.startup ?? resolveMcpStartupTimeoutMs();
  const createdTransport = await createTransport(config, options);

  const client = createMcpSdkClient(
    startupTimeoutMs,
    config.protocol,
    options.clientName,
  );

  try {
    await client.connect(createdTransport.transport, { timeout: startupTimeoutMs });
  } catch (error) {
    const stderrTail = createdTransport.getStderrTail();
    const childPid = createdTransport.getChildPid();
    await createdTransport.transport.close?.().catch(() => undefined);
    if (childPid !== null) {
      await waitForProcessExit(childPid).catch(() => undefined);
    }
    createdTransport.disposeObservability();
    if (error && typeof error === 'object' && stderrTail) {
      Object.defineProperty(error, MCP_STDERR_TAIL, { value: stderrTail });
    }
    throw error;
  }

  const protocolEra = client.getProtocolEra();
  if (!protocolEra) {
    const childPid = createdTransport.getChildPid();
    await client.close().catch(() => undefined);
    if (childPid !== null) {
      await waitForProcessExit(childPid);
    }
    createdTransport.disposeObservability();
    throw new Error(`MCP server ${serverName} connected without a negotiated protocol era`);
  }

  const childPid = createdTransport.getChildPid();
  let disposed = false;
  let closing: Promise<void> | null = null;

  const closeFully = async (): Promise<void> => {
    createdTransport.disposeObservability();
    await client.close().catch(() => undefined);
    if (childPid !== null) {
      await waitForProcessExit(childPid);
    }
  };

  return {
    client,
    protocolEra,
    getStderrTail: createdTransport.getStderrTail,
    getChildPid: () => childPid,
    close: () => {
      disposed = true;
      closing ??= closeFully();
      return closing;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      createdTransport.disposeObservability();
      void client.close().catch(() => undefined);
    },
  };
}

const PROCESS_EXIT_POLL_MS = 25;
const PROCESS_EXIT_TIMEOUT_MS = 10_000;

type KillProcess = (pid: number, signal?: NodeJS.Signals | 0) => boolean;

export async function waitForProcessExit(
  pid: number,
  timeoutMs = PROCESS_EXIT_TIMEOUT_MS,
  killProcess: KillProcess = process.kill.bind(process),
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      killProcess(pid, 0);
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PROCESS_EXIT_POLL_MS);
      timer.unref?.();
    });
  }

  try {
    killProcess(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw new Error(
      `MCP server child process ${pid} did not exit within ${timeoutMs}ms and could not be force-killed: ${(error as Error).message}`,
    );
  }
  const forceDeadline = Date.now() + 1_000;
  while (Date.now() < forceDeadline) {
    try {
      killProcess(pid, 0);
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PROCESS_EXIT_POLL_MS);
      timer.unref?.();
    });
  }
  throw new Error(`MCP server child process ${pid} remained alive after SIGKILL`);
}

export function getMcpConnectionStderrTail(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const stderrTail = (error as Record<PropertyKey, unknown>)[MCP_STDERR_TAIL];
  return typeof stderrTail === 'string' ? stderrTail : '';
}

export async function tryConnect(
  serverName: string,
  config: McpServerConfig,
): Promise<McpConnectionResult> {
  try {
    const connection = await createMcpClientConnection(serverName, config);
    return { status: 'connected', connection };
  } catch (error) {
    return {
      status: 'disabled',
      serverName,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * 根据 config type 创建对应的 transport
 */
interface CreatedTransport {
  transport: Transport;
  getStderrTail(): string;
  getChildPid(): number | null;
  disposeObservability(): void;
}

async function createTransport(
  config: McpServerConfig,
  options: McpClientConnectionOptions,
): Promise<CreatedTransport> {
  switch (config.type) {
    case 'stdio':
      return createStdioTransport(config, options);
    case 'sse':
      return withoutStderr(createSSETransport(config));
    case 'http':
      return withoutStderr(createHTTPTransport(config));
    case 'ws':
      return withoutStderr(createWebSocketTransport(config));
    default:
      throw new Error(`Unsupported MCP transport type: ${(config as any).type}`);
  }
}

/**
 * Stdio transport: 通过子进程启动 MCP server
 */
async function createStdioTransport(
  config: McpStdioServerConfig,
  options: McpClientConnectionOptions,
): Promise<CreatedTransport> {
  // 过滤掉 undefined 值，确保 env 是 Record<string, string>
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...config.env })) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  const TransportClass = config.protocol?.mode === 'modern'
    ? InPlaceStdioClientTransport
    : StdioClientTransport;
  const transport = new TransportClass({
    command: resolveStdioCommand(config.command),
    args: config.args ?? [],
    env,
    stderr: 'pipe',
    cwd: options.cwd,
  });
  let stderrTail = '';
  const onStderr = (chunk: Buffer | string) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
  };
  transport.stderr?.on('data', onStderr);

  return {
    transport,
    getStderrTail: () => stderrTail,
    getChildPid: () => transport.pid ?? null,
    disposeObservability: () => transport.stderr?.off('data', onStderr),
  };
}

async function withoutStderr(transportPromise: Promise<Transport>): Promise<CreatedTransport> {
  return {
    transport: await transportPromise,
    getStderrTail: () => '',
    getChildPid: () => null,
    disposeObservability: () => {},
  };
}

/**
 * SSE transport: Server-Sent Events
 */
async function createSSETransport(config: McpSSEServerConfig): Promise<Transport> {
  const transport = new SSEClientTransport(new URL(config.url), {
    requestInit: {
      headers: config.headers,
    },
  });

  return transport;
}

/**
 * HTTP transport: Streamable HTTP
 */
async function createHTTPTransport(config: McpHTTPServerConfig): Promise<Transport> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers: config.headers,
    },
  });

  return transport;
}

/**
 * WebSocket transport: 自定义实现（MCP SDK 未提供 WS client）
 */
async function createWebSocketTransport(config: McpWebSocketServerConfig): Promise<Transport> {
  const ws = new WebSocket(config.url);

  // 等待连接建立
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // 实现简单的 WebSocket transport
  const transport: Transport = {
    async start() {},

    async close() {
      ws.close();
    },

    async send(message) {
      ws.send(JSON.stringify(message));
    },

    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
  };

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      transport.onmessage?.(message);
    } catch (error) {
      transport.onerror?.(error as Error);
    }
  });

  ws.on('close', () => transport.onclose?.());
  ws.on('error', (error: Error) => transport.onerror?.(error));

  return transport;
}
