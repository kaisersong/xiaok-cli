import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { streamDesktopTaskProviderConversation } from '../../../src/ai/runtime/provider-conversation-authorization.js';
import type { ToolDefinition } from '../../../src/types.js';

const baseUrl = 'http://127.0.0.1:11434/v1';
const model = 'test-local-model';
const setting = (override: Record<string, unknown> = {}) => JSON.stringify({ baseUrl, model, order: 'name', ...override });
const tools: ToolDefinition[] = ['z_tool', 'a_tool', 'Z_tool'].map(name => Object.freeze({ name, description: name, inputSchema: Object.freeze({ type: 'object' }) }));
Object.freeze(tools);

function adapter(options: { url?: string; model?: string; strict?: boolean; providerId?: string; protocol?: 'openai_legacy' | 'openai_responses' } = {}) {
  return new OpenAIAdapter({ apiKey: 'fixture', kimiCodingHeadersApplied: Boolean(options.strict),
    harnessContext: buildOpenAIHarnessContext({
      identity: { providerId: options.providerId ?? (options.strict ? 'kimi' : 'test'), providerType: options.strict ? 'first_party' : 'custom', protocol: options.protocol ?? 'openai_legacy',
        canonicalBaseUrl: options.url ?? baseUrl, wireModel: options.model ?? model, capabilities: ['tools'] },
      flags: resolveKimiHarnessFeatureFlags({}),
    }),
  });
}

async function outgoing(instance: OpenAIAdapter, input: ToolDefinition[] = tools, strict = false) {
  const create = vi.spyOn(instance.client.chat.completions, 'create').mockResolvedValue({ async *[Symbol.asyncIterator]() {
    yield { choices: [{ index: 0, delta: { content: 'done', reasoning_content: '' }, finish_reason: 'stop' }] };
  } } as never);
  const stream = strict ? streamDesktopTaskProviderConversation({ adapter: instance, messages: [], tools: input, systemPrompt: 'fixed', invocationId: 'tool-order-test' }) : instance.stream([], input, 'fixed');
  for await (const _ of stream) { /* real adapter request construction */ }
  const request = create.mock.calls.at(-1)?.[0];
  expect(request).toBeDefined();
  return request as { tools?: Array<{ function: { name: string; description: string } }>; messages: unknown[] };
}
const names = (r: Awaited<ReturnType<typeof outgoing>>) => r.tools?.map(t => t.function.name);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('experimental tool order at actual outgoing adapter boundary', () => {
  it('defaults to registration order and sorts only when the selected target is explicitly enabled', async () => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', '');
    const off = await outgoing(adapter());
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting());
    const on = await outgoing(adapter());
    expect(names(off)).toEqual(['z_tool', 'a_tool', 'Z_tool']);
    expect(names(on)).toEqual(['Z_tool', 'a_tool', 'z_tool']);
    expect(on.messages).toEqual(off.messages);
    expect(tools.map(t => t.name)).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });

  it.each(['', '0', '1', 'true', '{', 'null', '[]', setting({ order: 'registration' }), setting({ extra: true }), setting({ model: '' }), setting({ baseUrl: 'http://secret@127.0.0.1:11434/v1' }), setting({ baseUrl: baseUrl + '?x=1' }), setting({ baseUrl: baseUrl + '#x' }), 'x'.repeat(8193)])('invalid/off setting keeps original order without breaking startup (%#)', async raw => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', raw);
    expect(names(await outgoing(adapter()))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });

  it('normalizes URL spelling but keeps other endpoint/model bindings unchanged', async () => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting({ baseUrl: 'http://LOCALHOST:80/v1/' }));
    expect(names(await outgoing(adapter({ url: 'http://localhost/v1' })))).toEqual(['Z_tool', 'a_tool', 'z_tool']);
    expect(names(await outgoing(adapter({ url: 'https://api.example.test/v1' })))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting());
    expect(names(await outgoing(adapter({ model: 'other-model' })))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
    const changedClient = adapter(); changedClient.client.baseURL = 'https://api.example.test/v1';
    expect(names(await outgoing(changedClient))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });

  it.each(['http://@127.0.0.1:11434/v1', 'http://:@127.0.0.1:11434/v1'])('rejects even empty URL userinfo (%#)', async url => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting({ baseUrl: url }));
    expect(names(await outgoing(adapter()))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });

  it('retains one snapshot for the adapter and same-model clones, but does not sort other-model clones', async () => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting()); const original = adapter();
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', '0');
    expect(names(await outgoing(original))).toEqual(['Z_tool', 'a_tool', 'z_tool']);
    expect(names(await outgoing(original.cloneWithModel(model)))).toEqual(['Z_tool', 'a_tool', 'z_tool']);
    expect(names(await outgoing(original.cloneWithModel('other-model')))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
    expect(names(await outgoing(adapter()))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });

  it('uses each current tool set; removals, schema changes and empty sets do not reuse stale snapshots', async () => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting()); const instance = adapter();
    expect(names(await outgoing(instance))).toEqual(['Z_tool', 'a_tool', 'z_tool']);
    const changed = [{ ...tools[0]!, description: 'updated' }, { ...tools[1]!, name: 'b_new' }];
    const request = await outgoing(instance, changed);
    expect(names(request)).toEqual(['b_new', 'z_tool']);
    expect(request.tools?.[1]?.function.description).toBe('updated');
    expect(changed.map(t => t.name)).toEqual(['z_tool', 'b_new']);
    expect((await outgoing(instance, [])).tools).toBeUndefined();
  });

  it('does not sort the strict Kimi profile even with an exact target setting', async () => {
    const url = 'https://api.kimi.com/coding/v1';
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting({ baseUrl: url, model: 'k3' }));
    expect(names(await outgoing(adapter({ url, model: 'k3', strict: true }), tools, true))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });

  it('does not sort a generic Kimi binding or a non-chat protocol even with the exact target', async () => {
    vi.stubEnv('XIAOK_EXPERIMENTAL_TOOL_ORDER', setting());
    expect(names(await outgoing(adapter({ providerId: 'kimi' })))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
    expect(names(await outgoing(adapter({ protocol: 'openai_responses' })))).toEqual(['z_tool', 'a_tool', 'Z_tool']);
  });
});
