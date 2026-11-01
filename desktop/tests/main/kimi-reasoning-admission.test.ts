// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapter } from '../../../src/ai/models.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('strict Kimi admission through the real SDK and Desktop loop', () => {
  it('retries only the bad provider response and never repeats a completed tool', async () => {
    const originalFetch = globalThis.fetch; const requests: unknown[] = []; const executed: string[] = [];
    const server = createServer((request, response) => {
      let body = ''; request.on('data', data => { body += data; }); request.on('end', () => {
        requests.push(JSON.parse(body)); const turn = requests.length;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const delta = (value: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'test-response', object: 'chat.completion.chunk', created: 1, model: 'k3', choices: [{ index: 0, delta: value, finish_reason: finish }] }) + '\n\n');
        if (turn !== 2) delta({ reasoning_content: '' });
        if (turn < 4) {
          const label = turn === 1 ? 'completed' : turn === 2 ? 'discarded' : 'fresh';
          if (turn === 2) delta({ content: 'UNADMITTED_PRIVATE_CANARY' });
          delta({ tool_calls: [{ index: 0, id: 'call-' + turn, type: 'function', function: { name: 'record', arguments: JSON.stringify({ label }) } }] }, 'tool_calls');
        } else delta({ content: 'done after safe recovery' }, 'stop');
        response.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw Error('test_server_address');
    vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => originalFetch(`http://127.0.0.1:${address.port}/chat/completions`, init));
    const root = mkdtempSync(join(tmpdir(), 'kimi-admission-sdk-'));
    const registry = new ToolRegistry({ autoMode: true }, [{ definition: { name: 'record', description: 'Save a fictional test label', inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
      async execute(input: Record<string, unknown>) { const label = String(input.label); executed.push(label); return 'saved:' + label; } }]);
    try {
      const adapter = createAdapter({ schemaVersion: 2, defaultProvider: 'kimi', defaultModelId: 'kimi-k3', providers: { kimi: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'test-only', baseUrl: 'https://api.kimi.com/coding/v1' } }, models: { 'kimi-k3': { provider: 'kimi', model: 'k3', label: 'K3' } } });
      const events: unknown[] = [];
      const result = await runDesktopToolLoop({ adapter, registry, allToolDefs: registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: 'Finish the fictional test' }] }],
        systemPrompt: '', signal: new AbortController().signal, taskDeadline: Date.now() + 30_000, sessionId: 'session', turnId: 'turn', taskId: 'task', intentId: 'intent', stepId: 'step',
        materials: [], emitRuntimeEvent: async event => { events.push(event); }, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(),
        strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: messages => messages, processToolResult: result => result,
          trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
      expect(result.reply).toContain('done after safe recovery'); expect(requests).toHaveLength(4);
      expect(executed).toEqual(['completed', 'fresh']); expect(requests[1]).toEqual(requests[2]);
      expect(JSON.stringify(requests[2])).toContain('saved:completed');
      expect(JSON.stringify(events)).not.toMatch(/UNADMITTED_PRIVATE_CANARY|discarded/);
    } finally {
      registry.dispose(); vi.unstubAllGlobals(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true });
    }
  });
});
