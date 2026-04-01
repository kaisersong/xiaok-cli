import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createStdioMcpTransport,
  decodeMcpFrames,
  encodeMcpMessage,
} from '../../../../src/ai/mcp/runtime/server-process.js';

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => undefined;
  return child;
}

describe('mcp server process transport', () => {
  it('encodes a Content-Length framed MCP message', () => {
    const payload = encodeMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });

    expect(payload).toContain('Content-Length:');
    expect(payload).toContain('"method":"initialize"');
  });

  it('decodes framed MCP messages from a byte stream', () => {
    const frame = encodeMcpMessage({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [{ name: 'search' }],
      },
    });

    expect(decodeMcpFrames(frame)).toEqual([
      expect.objectContaining({
        id: 2,
        result: { tools: [{ name: 'search' }] },
      }),
    ]);
  });

  it('sends framed requests and resolves the matching response over stdio transport', async () => {
    const child = createMockChildProcess();
    const writes: string[] = [];
    child.stdin.on('data', (chunk) => {
      writes.push(String(chunk));
    });

    const transport = createStdioMcpTransport(child as never);
    const pending = transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    child.stdout.write(encodeMcpMessage({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'search' }] },
    }));

    await expect(pending).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'search' }] },
    });
    expect(writes[0]).toContain('Content-Length:');
    expect(writes[0]).toContain('"method":"tools/list"');
  });

  it('rejects pending requests when the MCP server process exits before replying', async () => {
    const child = createMockChildProcess();
    const transport = createStdioMcpTransport(child as never);
    let outcome = 'pending';

    transport.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: {},
    }).catch((error: Error) => {
      outcome = error.message;
      return undefined;
    });

    child.emit('exit', 1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(outcome).toBe('MCP server process exited before responding');
  });
});
