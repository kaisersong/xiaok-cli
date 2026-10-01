import { describe, expect, it } from 'vitest';
import { createSystemOneAdapter } from '../src/ai/models.js';
import { probeApiKey } from '../src/ai/providers/key-probe.js';
import type { Config } from '../src/types.js';

/**
 * 对真实 TypeSafe System One 端点（api.typesafe.ai）的联机验收。
 *
 * 默认整组跳过：只有在环境中显式提供 XIAOK_TYPESAFE_API_KEY（或 TYPESAFE_API_KEY）
 * 时才执行，避免 CI 依赖外网与真实额度。
 *
 *   XIAOK_TYPESAFE_API_KEY=... npm run test:sandbox:build
 *   XIAOK_TYPESAFE_API_KEY=... npm run test:sandbox:run -- .test-dist/tests/jev-live.test.js
 */
const liveKey = process.env.XIAOK_TYPESAFE_API_KEY ?? process.env.TYPESAFE_API_KEY ?? '';

function liveConfig(): Config {
  return {
    schemaVersion: 2,
    defaultProvider: 'anthropic',
    defaultModelId: 'anthropic-default',
    providers: {},
    models: {},
    defaultMode: 'interactive',
    channels: {},
    systemOne: { apiKey: liveKey },
  };
}

async function collect(it: AsyncIterable<unknown>): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of it) chunks.push(chunk as Record<string, unknown>);
  return chunks;
}

describe.skipIf(!liveKey)('Jev live endpoint', () => {
  it('probes the real key as valid', async () => {
    const result = await probeApiKey('system_one', undefined, liveKey);
    expect(result, `probe detail: ${result.detail ?? ''}`).toMatchObject({ status: 'valid' });
  }, 30_000);

  it('rejects a bogus key as invalid instead of reporting a network error', async () => {
    const result = await probeApiKey('system_one', undefined, 'apikey_bogus_000000000000000000000000000000000000_0000000000000000000000000000000000000000000000000000000000000000');
    expect(result.status).toBe('invalid');
    expect(result.httpStatus).toBe(401);
  }, 30_000);

  it('drives a real tool choice into a tool_use chunk', async () => {
    const adapter = createSystemOneAdapter(liveConfig());
    const chunks = await collect(adapter.stream(
      [{ role: 'user', content: [{ type: 'text', text: '读取 package.json 并报告 version 字段' }] }],
      [
        { name: 'read_file', description: 'Read the contents of a file from disk', inputSchema: { type: 'object' } },
        { name: 'bash', description: 'Run a shell command', inputSchema: { type: 'object' } },
      ],
      'You are a coding agent.',
    ));

    const toolUse = chunks.find((c) => c.type === 'tool_use');
    expect(toolUse).toMatchObject({ type: 'tool_use', name: 'read_file' });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    expect(chunks.some((c) => c.type === 'usage')).toBe(true);
  }, 60_000);

  it('renders a real noul answer as a text delta', async () => {
    const adapter = createSystemOneAdapter(liveConfig());
    const chunks = await collect(adapter.stream(
      [{ role: 'user', content: [{ type: 'text', text: 'Is this a probe request?' }] }],
      [],
      'Answer with the System One protocol.',
    ));

    expect(chunks[0]).toMatchObject({ type: 'text' });
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(false);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  }, 60_000);
});
