import { createServer } from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebFetchTool } from '../../../src/ai/tools/web-fetch.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('webFetchTool', () => {
  it('fetches html and converts it to plain text', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><body><h1>Hello</h1><p>web world</p></body></html>');
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: `http://127.0.0.1:${port}/` });

    expect(result).toContain('Hello web world');
  });

  it('respects max_chars for long responses', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('x'.repeat(200));
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: `http://127.0.0.1:${port}/`, max_chars: 40 });

    expect(result).toContain('已截断');
  });
});
