import { createServer } from 'node:http';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { WebSocketServer } from 'ws';
import { createMcpClientConnection } from '../../../src/platform/mcp/transport.js';

describe('MCP SDK v2 integration', () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closeCallbacks.splice(0).reverse()) {
      await close();
    }
  });

  it('negotiates the 2026-07-28 modern era and calls a tool', async () => {
    const handler = createMcpHandler(({ era }) => {
      const server = new Server(
        { name: 'xiaok-modern-test', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler('tools/list', async () => ({
        tools: [{
          name: 'echo',
          description: 'Echo a value',
          inputSchema: { type: 'object' },
        }],
      }));
      server.setRequestHandler('tools/call', async (request) => ({
        content: [{
          type: 'text',
          text: `${era}:${String(request.params.arguments?.value ?? '')}`,
        }],
      }));
      return server;
    });
    const httpServer = createServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    closeCallbacks.push(() => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    }));

    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const connection = await createMcpClientConnection('modern-test', {
      type: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`,
    });
    closeCallbacks.push(async () => connection.dispose());

    expect(connection.protocolEra).toBe('modern');
    expect((await connection.client.listTools()).tools.map((tool) => tool.name)).toContain('echo');
    await expect(connection.client.callTool({
      name: 'echo',
      arguments: { value: 'ok' },
    })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'modern:ok' }],
    });
  });

  it('runs a pinned modern stdio server in one child process', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'xiaok-mcp-v2-stdio-'));
    const launchLog = join(testDir, 'launches.log');
    closeCallbacks.push(async () => rmSync(testDir, { recursive: true, force: true }));
    const serverScript = [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(launchLog)}, 'started\\n');`,
      "import { McpServer } from '@modelcontextprotocol/server';",
      "import { serveStdio } from '@modelcontextprotocol/server/stdio';",
      "const server = new McpServer({ name: 'stdio-modern-test', version: '1.0.0' });",
      "server.registerTool('ping', { description: 'ping', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));",
      'await serveStdio(() => server);',
    ].join('\n');

    const connection = await createMcpClientConnection('stdio-modern-test', {
      type: 'stdio',
      command: process.execPath,
      args: ['--input-type=module', '--eval', serverScript],
      protocol: { mode: 'modern', version: '2026-07-28' },
      timeout: { startup: 5_000 },
    }, {
      cwd: process.cwd(),
      clientName: 'xiaok-stdio-integration-test',
    });
    closeCallbacks.push(async () => connection.dispose());

    expect(connection.protocolEra).toBe('modern');
    expect((await connection.client.listTools()).tools.map((tool) => tool.name)).toContain('ping');
    expect(readFileSync(launchLog, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('absorbs asynchronous close failures during best-effort disposal', async () => {
    const handler = createMcpHandler(() => new Server(
      { name: 'xiaok-close-test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    ));
    const httpServer = createServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    closeCallbacks.push(() => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    }));

    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const connection = await createMcpClientConnection('close-test', {
      type: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`,
    });
    const originalClose = connection.client.close.bind(connection.client);
    connection.client.close = async () => {
      await originalClose();
      throw new Error('simulated asynchronous close failure');
    };
    let unhandledReason: unknown;
    const onUnhandledRejection = (reason: unknown) => {
      unhandledReason = reason;
    };
    process.once('unhandledRejection', onUnhandledRejection);

    connection.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.removeListener('unhandledRejection', onUnhandledRejection);

    expect(unhandledReason).toBeUndefined();
  });

  it('falls back to the legacy era and still calls a tool', async () => {
    const receivedMethods: string[] = [];
    const httpServer = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const message = body ? JSON.parse(body) as {
        id?: string | number;
        method?: string;
        params?: { arguments?: { value?: unknown } };
      } : {};
      if (message.method) receivedMethods.push(message.method);

      response.setHeader('content-type', 'application/json');
      if (message.method === 'server/discover') {
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found' },
        }));
        return;
      }
      if (message.method === 'initialize') {
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'xiaok-legacy-test', version: '1.0.0' },
          },
        }));
        return;
      }
      if (message.method === 'notifications/initialized') {
        response.statusCode = 202;
        response.end();
        return;
      }
      if (message.method === 'tools/list') {
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [{
              name: 'echo',
              description: 'Echo a value',
              inputSchema: { type: 'object' },
            }],
          },
        }));
        return;
      }
      if (message.method === 'tools/call') {
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [{
              type: 'text',
              text: `legacy:${String(message.params?.arguments?.value ?? '')}`,
            }],
          },
        }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    closeCallbacks.push(() => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    }));

    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const connection = await createMcpClientConnection('legacy-test', {
      type: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`,
    });
    closeCallbacks.push(async () => connection.dispose());

    expect(connection.protocolEra).toBe('legacy');
    await expect(connection.client.callTool({
      name: 'echo',
      arguments: { value: 'ok' },
    })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'legacy:ok' }],
    });
    expect(receivedMethods).toEqual(expect.arrayContaining([
      'server/discover',
      'initialize',
      'tools/call',
    ]));
  });

  it('keeps the custom WebSocket transport compatible with v2 legacy fallback', async () => {
    const receivedMethods: string[] = [];
    const webSocketServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => webSocketServer.once('listening', resolve));
    closeCallbacks.push(() => new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => error ? reject(error) : resolve());
    }));
    webSocketServer.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as {
          id?: string | number;
          method?: string;
          params?: { arguments?: { value?: unknown } };
        };
        if (message.method) receivedMethods.push(message.method);

        if (message.method === 'server/discover') {
          socket.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Method not found' },
          }));
          return;
        }
        if (message.method === 'initialize') {
          socket.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'xiaok-ws-legacy-test', version: '1.0.0' },
            },
          }));
          return;
        }
        if (message.method === 'tools/list') {
          socket.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [{
                name: 'echo',
                description: 'Echo a value',
                inputSchema: { type: 'object' },
              }],
            },
          }));
          return;
        }
        if (message.method === 'tools/call') {
          socket.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{
                type: 'text',
                text: `legacy-ws:${String(message.params?.arguments?.value ?? '')}`,
              }],
            },
          }));
        }
      });
    });

    const address = webSocketServer.address();
    if (!address || typeof address === 'string') throw new Error('test WebSocket server did not bind');
    const connection = await createMcpClientConnection('ws-legacy-test', {
      type: 'ws',
      url: `ws://127.0.0.1:${address.port}`,
    });
    closeCallbacks.push(async () => connection.dispose());

    expect(connection.protocolEra).toBe('legacy');
    await expect(connection.client.callTool({
      name: 'echo',
      arguments: { value: 'ok' },
    })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'legacy-ws:ok' }],
    });
    expect(receivedMethods).toEqual(expect.arrayContaining([
      'server/discover',
      'initialize',
      'tools/call',
    ]));
  });

  it.each([403, 500])(
    'does not hide HTTP %s failures behind legacy fallback',
    async (statusCode) => {
    const receivedMethods: string[] = [];
    const httpServer = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const message = body ? JSON.parse(body) as { method?: string } : {};
      if (message.method) receivedMethods.push(message.method);
      response.statusCode = statusCode;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: statusCode === 403 ? 'forbidden' : 'unavailable' }));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    closeCallbacks.push(() => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    }));

    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    await expect(createMcpClientConnection('auth-test', {
      type: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`,
    })).rejects.toThrow();
    expect(receivedMethods).toEqual(['server/discover']);
    },
  );

  it('uses the configured startup timeout for modern discovery without fallback', async () => {
    const receivedMethods: string[] = [];
    const httpServer = createServer(async (request) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const message = body ? JSON.parse(body) as { method?: string } : {};
      if (message.method) receivedMethods.push(message.method);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    closeCallbacks.push(() => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    }));

    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const startedAt = Date.now();
    await expect(createMcpClientConnection('timeout-test', {
      type: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`,
      timeout: { startup: 50 },
    })).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(receivedMethods).toEqual(['server/discover']);
  });
});
