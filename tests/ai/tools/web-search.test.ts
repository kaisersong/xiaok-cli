import { describe, expect, it } from 'vitest';
import { createWebSearchTool } from '../../../src/ai/tools/web-search.js';

describe('webSearchTool', () => {
  it('formats parsed search results into a compact list', async () => {
    const tool = createWebSearchTool({
      fetchFn: async () => new Response(`
        <html><body>
          <a class="result__a" href="https://example.com/1">Example One</a>
          <div class="result__snippet">First snippet</div>
          <a class="result__a" href="https://example.com/2">Example Two</a>
          <div class="result__snippet">Second snippet</div>
        </body></html>
      `, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    });

    const result = await tool.execute({ query: 'example', count: 2 });

    expect(result).toContain('1. Example One');
    expect(result).toContain('URL: https://example.com/1');
    expect(result).toContain('Snippet: First snippet');
    expect(result).toContain('2. Example Two');
  });

  it('returns an empty message when no search results are found', async () => {
    const tool = createWebSearchTool({
      fetchFn: async () => new Response('<html><body>none</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    });

    const result = await tool.execute({ query: 'missing' });

    expect(result).toContain('无搜索结果');
  });
});
