import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { encodeLspMessage } from '../../../src/platform/lsp/client.js';
import { createStdioLspTransport } from '../../../src/platform/lsp/server-process.js';

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

describe('lsp server process transport', () => {
  it('resolves request responses over stdio transport', async () => {
    const child = createMockChildProcess();
    const writes: string[] = [];
    child.stdin.on('data', (chunk) => {
      writes.push(String(chunk));
    });

    const transport = createStdioLspTransport(child as never);
    const pending = transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { rootUri: 'file:///repo' },
    });

    child.stdout.write(encodeLspMessage({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: {} },
    }));

    await expect(pending).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: {} },
    });
    expect(writes[0]).toContain('Content-Length:');
    expect(writes[0]).toContain('"method":"initialize"');
  });

  it('forwards notifications to registered listeners', () => {
    const child = createMockChildProcess();
    const received: Array<{ method?: string }> = [];
    const transport = createStdioLspTransport(child as never);
    const unsubscribe = transport.onMessage((message) => {
      received.push({ method: message.method });
    });

    child.stdout.write(encodeLspMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [],
      },
    }));

    unsubscribe();
    expect(received).toEqual([{ method: 'textDocument/publishDiagnostics' }]);
  });

  it('disposes transport listeners and kills the process', () => {
    const child = createMockChildProcess();
    const transport = createStdioLspTransport(child as never);

    transport.dispose();

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects pending requests when the LSP server process exits before replying', async () => {
    const child = createMockChildProcess();
    const transport = createStdioLspTransport(child as never);
    let outcome = 'pending';

    transport.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: { rootUri: 'file:///repo' },
    }).catch((error: Error) => {
      outcome = error.message;
      return undefined;
    });

    child.emit('exit', 1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(outcome).toBe('LSP server process exited before responding');
  });
});
