/**
 * MCP Transport Client Implementations
 *
 * 支持 stdio/sse/http/ws 四种 transport
 * 使用 @modelcontextprotocol/client v2 提供的 transport classes
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, SSEClientTransport, StreamableHTTPClientTransport, } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ControlledStdioClientTransport, } from './controlled-stdio-transport.js';
import { WebSocket } from 'ws';
const MCP_STDERR_TAIL = Symbol('mcpStderrTail');
const STDERR_TAIL_LIMIT = 4096;
export class InPlaceStdioClientTransport extends StdioClientTransport {
}
export const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 3_000;
export const DEFAULT_MCP_CATALOG_TIMEOUT_MS = 10_000;
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 120_000;
export const DEFAULT_MCP_RESOURCE_TIMEOUT_MS = 30_000;
export function resolveMcpStartupTimeoutMs(env = process.env) {
    return resolvePositiveTimeout(env.XIAOK_MCP_STARTUP_TIMEOUT_MS, DEFAULT_MCP_STARTUP_TIMEOUT_MS);
}
export function resolveMcpCatalogTimeoutMs(env = process.env) {
    return resolvePositiveTimeout(env.XIAOK_MCP_CATALOG_TIMEOUT_MS, DEFAULT_MCP_CATALOG_TIMEOUT_MS);
}
export function resolveMcpCallToolTimeoutMs(env = process.env) {
    return resolvePositiveTimeout(env.XIAOK_MCP_CALL_TIMEOUT_MS, DEFAULT_MCP_CALL_TIMEOUT_MS);
}
export function resolveMcpResourceTimeoutMs(env = process.env) {
    return resolvePositiveTimeout(env.XIAOK_MCP_RESOURCE_TIMEOUT_MS, DEFAULT_MCP_RESOURCE_TIMEOUT_MS);
}
function resolvePositiveTimeout(raw, fallback) {
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export function resolveMcpClientVersion() {
    try {
        const moduleDir = dirname(fileURLToPath(import.meta.url));
        const pkg = JSON.parse(readFileSync(join(moduleDir, '..', '..', '..', 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
export function createMcpClientOptions(probeTimeoutMs = resolveMcpStartupTimeoutMs(), protocol = { mode: 'auto' }) {
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
export function createMcpSdkClient(probeTimeoutMs = resolveMcpStartupTimeoutMs(), protocol = { mode: 'auto' }, clientName = 'xiaok-cli') {
    return new Client({ name: clientName, version: resolveMcpClientVersion() }, createMcpClientOptions(probeTimeoutMs, protocol));
}
export function resolveStdioCommand(command, platform = process.platform, env = process.env) {
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
export async function createMcpClientConnection(serverName, config, options = {}) {
    const startupTimeoutMs = config.timeout?.startup ?? resolveMcpStartupTimeoutMs();
    const createdTransport = await createTransport(config, options);
    const client = createMcpSdkClient(startupTimeoutMs, config.protocol, options.clientName);
    try {
        await client.connect(createdTransport.transport, {
            timeout: startupTimeoutMs,
            ...(options.startupSignal ? { signal: options.startupSignal } : {}),
        });
        // Controlled transports spawn inside start(), so stderr only exists now.
        createdTransport.attachAfterStart?.();
    }
    catch (error) {
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
    let closing = null;
    const closeFully = async () => {
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
            if (disposed)
                return;
            disposed = true;
            createdTransport.disposeObservability();
            void client.close().catch(() => undefined);
        },
    };
}
const PROCESS_EXIT_POLL_MS = 25;
const PROCESS_EXIT_TIMEOUT_MS = 10_000;
export async function waitForProcessExit(pid, timeoutMs = PROCESS_EXIT_TIMEOUT_MS, killProcess = process.kill.bind(process)) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            killProcess(pid, 0);
        }
        catch {
            return;
        }
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, PROCESS_EXIT_POLL_MS);
            timer.unref?.();
        });
    }
    try {
        killProcess(pid, 'SIGKILL');
    }
    catch (error) {
        if (error.code === 'ESRCH')
            return;
        throw new Error(`MCP server child process ${pid} did not exit within ${timeoutMs}ms and could not be force-killed: ${error.message}`);
    }
    const forceDeadline = Date.now() + 1_000;
    while (Date.now() < forceDeadline) {
        try {
            killProcess(pid, 0);
        }
        catch {
            return;
        }
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, PROCESS_EXIT_POLL_MS);
            timer.unref?.();
        });
    }
    throw new Error(`MCP server child process ${pid} remained alive after SIGKILL`);
}
export function getMcpConnectionStderrTail(error) {
    if (!error || typeof error !== 'object')
        return '';
    const stderrTail = error[MCP_STDERR_TAIL];
    return typeof stderrTail === 'string' ? stderrTail : '';
}
export async function tryConnect(serverName, config) {
    try {
        const connection = await createMcpClientConnection(serverName, config);
        return { status: 'connected', connection };
    }
    catch (error) {
        return {
            status: 'disabled',
            serverName,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
async function createTransport(config, options) {
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
            throw new Error(`Unsupported MCP transport type: ${config.type}`);
    }
}
/**
 * Controlled stdio transport (design v58 §3.4): Xiaok owns spawn/close/env for
 * reserved bundled providers. `finalEnv` is mandatory and passed verbatim, so
 * the inherited-env merge of the `sdk` path can never apply here.
 */
async function createControlledStdioTransport(config, options) {
    if (!options.finalEnv) {
        throw new Error('controlled stdio transport requires an explicit finalEnv');
    }
    if (!options.controlledClose?.forceKillGuard) {
        throw new Error('controlled stdio transport requires a ForceKillGuard frozen at construction');
    }
    const resourceId = `${config.command}:${(config.args ?? []).join(' ')}`;
    const transport = new ControlledStdioClientTransport({
        command: resolveStdioCommand(config.command),
        args: config.args ?? [],
        finalEnv: options.finalEnv,
        cwd: options.cwd,
        resourceId,
        forceKillGuard: options.controlledClose.forceKillGuard,
        closeBudget: options.controlledClose.closeBudget,
        startupSignal: options.startupSignal,
    });
    // Handed over synchronously, before client.connect() can await anything.
    options.onCloseHandle?.({
        kind: 'mcp-connection',
        resourceId,
        getChildPid: () => transport.getChildPid(),
        close: () => transport.close(),
        closed: transport.closed,
    });
    let stderrTail = '';
    const onStderr = (chunk) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
    };
    const attachStderr = () => transport.stderr?.on('data', onStderr);
    return {
        transport,
        getStderrTail: () => stderrTail,
        getChildPid: () => transport.getChildPid(),
        disposeObservability: () => transport.stderr?.off('data', onStderr),
        attachAfterStart: attachStderr,
    };
}
/**
 * Stdio transport: 通过子进程启动 MCP server
 */
async function createStdioTransport(config, options) {
    if (options.stdioLifecycle === 'controlled') {
        return createControlledStdioTransport(config, options);
    }
    // 过滤掉 undefined 值，确保 env 是 Record<string, string>
    const env = {};
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
    const onStderr = (chunk) => {
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
async function withoutStderr(transportPromise) {
    return {
        transport: await transportPromise,
        getStderrTail: () => '',
        getChildPid: () => null,
        disposeObservability: () => { },
    };
}
/**
 * SSE transport: Server-Sent Events
 */
async function createSSETransport(config) {
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
async function createHTTPTransport(config) {
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
async function createWebSocketTransport(config) {
    const ws = new WebSocket(config.url);
    // 等待连接建立
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    // 实现简单的 WebSocket transport
    const transport = {
        async start() { },
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
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            transport.onmessage?.(message);
        }
        catch (error) {
            transport.onerror?.(error);
        }
    });
    ws.on('close', () => transport.onclose?.());
    ws.on('error', (error) => transport.onerror?.(error));
    return transport;
}
