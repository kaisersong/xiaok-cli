/**
 * MCP Transport Client Implementations
 *
 * 支持 stdio/sse/http/ws 四种 transport
 * 使用 @modelcontextprotocol/sdk 提供的 transport classes
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket } from 'ws';
/**
 * 创建 MCP client 连接（统一入口）
 */
export async function createMcpClientConnection(serverName, config) {
    const transport = await createTransport(serverName, config);
    const client = new Client({ name: 'xiaok-cli', version: '0.5.6' }, { capabilities: {} });
    try {
        await client.connect(transport);
    }
    catch (error) {
        transport.close?.();
        throw error;
    }
    return {
        client,
        dispose: () => {
            client.close();
            transport.close?.();
        },
    };
}
/**
 * 根据 config type 创建对应的 transport
 */
async function createTransport(serverName, config) {
    switch (config.type) {
        case 'stdio':
            return createStdioTransport(config);
        case 'sse':
            return createSSETransport(config);
        case 'http':
            return createHTTPTransport(config);
        case 'ws':
            return createWebSocketTransport(config);
        default:
            throw new Error(`Unsupported MCP transport type: ${config.type}`);
    }
}
/**
 * Stdio transport: 通过子进程启动 MCP server
 */
async function createStdioTransport(config) {
    // 过滤掉 undefined 值，确保 env 是 Record<string, string>
    const env = {};
    for (const [key, value] of Object.entries({ ...process.env, ...config.env })) {
        if (value !== undefined) {
            env[key] = value;
        }
    }
    const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env,
        stderr: 'pipe',
    });
    // 注意：不要调用 start()，Client.connect() 会自动调用
    return transport;
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
    await transport.start();
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
    await transport.start();
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
