import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import type { Message, MessageBlock } from '../../../src/types.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
const image: MessageBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'SYNTHETIC_IMAGE_DATA' } };

async function capture(messages: Message[], model = 'GLM-5.3', flags: string[] = [], override?: boolean) {
  let request: any;
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      request = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const adapter = new OpenAIAdapter({ apiKey: 'synthetic-test-key', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'test', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: baseUrl,
      wireModel: model, capabilities: flags },
    flags: resolveKimiHarnessFeatureFlags({}),
    ...(override !== undefined ? { capabilityOverrides: { supportsImageInput: override } } : {}),
  }) });
  for await (const _ of adapter.stream(messages, [], 'synthetic system')) { /* real SDK HTTP dispatch */ }
  return request.messages as Array<Record<string, any>>;
}

describe('OpenAI request projection for retained image history', () => {
  it.each(['GLM-5.3', 'unknown-text-model'])('sends text placeholders to %s without changing history', async model => {
    const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'Retain this question.' }, image] }];
    const original = structuredClone(messages);
    const wire = await capture(messages, model);
    expect(wire[1].content).toEqual(expect.stringContaining('Retain this question.'));
    expect(wire[1].content).toEqual(expect.stringContaining('does not support image input'));
    expect(JSON.stringify(wire)).not.toContain('image_url');
    expect(JSON.stringify(wire)).not.toContain('SYNTHETIC_IMAGE_DATA');
    expect(messages).toEqual(original);
  });

  it('keeps image-only user messages visible as nonempty text', async () => {
    const wire = await capture([{ role: 'user', content: [image] }]);
    expect(wire[1]).toMatchObject({ role: 'user', content: expect.stringContaining('Original image retained') });
  });

  it('preserves paired tool replies and accompanying text with an image placeholder', async () => {
    const wire = await capture([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'read_probe', name: 'read', input: { file_path: 'screen.png' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read_probe', content: 'read finished' },
        { type: 'text', text: 'Interpret the retained screen.' }, image] },
    ]);
    expect(wire[1].tool_calls[0].id).toBe('read_probe');
    expect(wire[2]).toEqual({ role: 'tool', tool_call_id: 'read_probe', content: 'read finished' });
    expect(wire[3]).toMatchObject({ role: 'user', content: expect.stringContaining('Interpret the retained screen.') });
    expect(JSON.stringify(wire)).not.toContain('image_url');
  });

  it.each([
    ['gpt-4o', []], ['deepseek-v4-flash-vision-exp', []], ['glm-5.3-flash', ['tools', 'image_in']],
  ])('preserves image payloads for capable model %s', async (model, flags) => {
    const wire = await capture([{ role: 'user', content: [image] }], model as string, flags as string[]);
    expect(wire[1].content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,SYNTHETIC_IMAGE_DATA' } }]);
  });

  it('honors an explicit false override on a normally visual model', async () => {
    const wire = await capture([{ role: 'user', content: [image] }], 'gpt-4o', [], false);
    expect(typeof wire[1].content).toBe('string');
    expect(JSON.stringify(wire)).not.toContain('image_url');
  });

  it('honors an explicit true override on an otherwise unknown model', async () => {
    const wire = await capture([{ role: 'user', content: [image] }], 'custom-vision', [], true);
    expect(wire[1].content[0].type).toBe('image_url');
  });

  it('retains original images when the same history is later sent to a visual model', async () => {
    const messages: Message[] = [{ role: 'user', content: [image] }];
    const text = await capture(messages);
    const vision = await capture(messages, 'gpt-4o');
    expect(typeof text[1].content).toBe('string');
    expect(vision[1].content[0].image_url.url).toContain('SYNTHETIC_IMAGE_DATA');
    expect(messages[0].content).toEqual([image]);
  });
});
