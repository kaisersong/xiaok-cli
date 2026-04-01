import { describe, expect, it } from 'vitest';
import { createWebFetchTool } from '../../../src/ai/tools/web-fetch.js';

describe('webFetchTool', () => {
  it('fetches html and converts it to plain text', async () => {
    const tool = createWebFetchTool({
      fetchFn: async () => new Response('<html><body><h1>Hello</h1><p>web world</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    });

    const result = await tool.execute({ url: 'https://example.com/' });

    expect(result).toContain('Hello web world');
  });

  it('respects max_chars for long responses', async () => {
    const tool = createWebFetchTool({
      fetchFn: async () => new Response('x'.repeat(200), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    });

    const result = await tool.execute({ url: 'https://example.com/', max_chars: 40 });

    expect(result).toContain('已截断');
  });
});
