import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeMcpMessage } from '../../../src/ai/mcp/runtime/server-process.js';
import { encodeLspMessage } from '../../../src/platform/lsp/client.js';
import { createLspManager } from '../../../src/platform/lsp/manager.js';
import { resolvePluginShellCommand } from '../../../src/platform/plugins/runtime.js';

const { startMcpServerProcessMock, startLspServerProcessMock } = vi.hoisted(() => ({
  startMcpServerProcessMock: vi.fn(),
  startLspServerProcessMock: vi.fn(),
}));

vi.mock('../../../src/ai/mcp/runtime/server-process.js', async () => {
  const actual = await vi.importActual('../../../src/ai/mcp/runtime/server-process.js');
  return {
    ...actual,
    startMcpServerProcess: startMcpServerProcessMock,
  };
});

vi.mock('../../../src/platform/lsp/server-process.js', async () => {
  const actual = await vi.importActual('../../../src/platform/lsp/server-process.js');
  return {
    ...actual,
    startLspServerProcess: startLspServerProcessMock,
  };
});

function parseFramedPayload(payload: string): Record<string, unknown> {
  const [, body = ''] = payload.split('\r\n\r\n');
  return JSON.parse(body) as Record<string, unknown>;
}

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe('platform plugin runtime', () => {
  beforeEach(() => {
    startMcpServerProcessMock.mockReset();
    startLspServerProcessMock.mockReset();
  });

  it('builds shell invocations for plugin commands per host platform', async () => {
    const { resolvePluginShellCommand } = await import('../../../src/platform/plugins/runtime.js');

    expect(resolvePluginShellCommand('node ./server.js', 'darwin')).toEqual({
      command: 'sh',
      args: ['-c', 'node ./server.js'],
    });
    expect(resolvePluginShellCommand('node .\\server.js', 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"node .\\server.js"'],
    });
  });

  it('connects to a declared MCP server over the shared stdio transport', async () => {
    const child = createMockChildProcess();
    child.stdin.on('data', (chunk) => {
      const request = parseFramedPayload(String(chunk));
      const id = Number(request.id);
      if (request.method === 'initialize') {
        child.stdout.write(encodeMcpMessage({
          jsonrpc: '2.0',
          id,
          result: { serverInfo: { name: 'docs' } },
        }));
        return;
      }
      if (request.method === 'tools/list') {
        child.stdout.write(encodeMcpMessage({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'search',
                description: 'search docs',
                inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
              },
            ],
          },
        }));
        return;
      }
      if (request.method === 'tools/call') {
        child.stdout.write(encodeMcpMessage({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'docs:prompt cache' }],
          },
        }));
      }
    });

    startMcpServerProcessMock.mockReturnValue({
      child,
      dispose: () => child.kill(),
    });

    const { connectDeclaredMcpServer } = await import('../../../src/platform/plugins/runtime.js');
    const connection = await connectDeclaredMcpServer({
      name: 'docs',
      command: 'node ./fake-docs-server.js',
    });

    await expect(connection.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'search' }),
    ]);
    await expect(connection.callTool('search', { q: 'prompt cache' })).resolves.toBe('docs:prompt cache');

    connection.dispose();

    const shell = resolvePluginShellCommand('node ./fake-docs-server.js');
    expect(startMcpServerProcessMock).toHaveBeenCalledWith(shell.command, shell.args);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('connects to a declared LSP server over the shared stdio transport', async () => {
    const child = createMockChildProcess();
    child.stdin.on('data', (chunk) => {
      const request = parseFramedPayload(String(chunk));
      if (request.method === 'initialize') {
        child.stdout.write(encodeLspMessage({
          jsonrpc: '2.0',
          id: Number(request.id),
          result: { capabilities: {} },
        }));
        child.stdout.write(encodeLspMessage({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: {
            uri: 'file:///repo/src/app.ts',
            diagnostics: [{ severity: 1, message: 'Type error' }],
          },
        }));
      }
    });

    startLspServerProcessMock.mockReturnValue({
      child,
      dispose: () => child.kill(),
    });

    const { connectDeclaredLspServer } = await import('../../../src/platform/plugins/runtime.js');
    const manager = createLspManager();
    const connection = await connectDeclaredLspServer(
      { name: 'ts', command: 'node ./fake-lsp-server.js' },
      manager,
      'file:///repo',
    );

    await expect(connection.didOpenDocument({
      uri: 'file:///repo/src/app.ts',
      languageId: 'typescript',
      text: 'const x: string = 1;',
    })).resolves.toBeUndefined();

    expect(manager.getSummary()).toContain('Type error');

    connection.dispose();

    const shell = resolvePluginShellCommand('node ./fake-lsp-server.js');
    expect(startLspServerProcessMock).toHaveBeenCalledWith(shell.command, shell.args);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('disposes the MCP child process when initialization fails', async () => {
    const child = createMockChildProcess();
    startMcpServerProcessMock.mockReturnValue({
      child,
      dispose: () => child.kill(),
    });

    const { connectDeclaredMcpServer } = await import('../../../src/platform/plugins/runtime.js');
    const pending = connectDeclaredMcpServer({
      name: 'docs',
      command: 'node ./broken-docs-server.js',
    });

    child.emit('exit', 1);

    await expect(pending).rejects.toThrow('MCP server process exited before responding');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('disposes the LSP child process when initialization fails', async () => {
    const child = createMockChildProcess();
    startLspServerProcessMock.mockReturnValue({
      child,
      dispose: () => child.kill(),
    });

    const { connectDeclaredLspServer } = await import('../../../src/platform/plugins/runtime.js');
    const manager = createLspManager();
    const pending = connectDeclaredLspServer(
      { name: 'ts', command: 'node ./broken-lsp-server.js' },
      manager,
      'file:///repo',
    );

    child.emit('exit', 1);

    await expect(pending).rejects.toThrow('LSP server process exited before responding');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
