import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemOneAdapter } from '../src/ai/models.js';
import { getProviderProfile, listProviderProfiles } from '../src/ai/providers/registry.js';
import { probeApiKey } from '../src/ai/providers/key-probe.js';
import {
  resolveSystemOneConfig,
  setSystemOneConfig,
  systemOneEndpointUrl,
  SYSTEM_ONE_DEFAULT_BASE_URL,
  SYSTEM_ONE_DEFAULT_MODEL,
} from '../src/ai/providers/system-one-config.js';
import type { Config } from '../src/types.js';

/**
 * Jev 是辅助决策模型，不是推理模型 —— 它不参与 config.models / defaultModelId，
 * 只从独立的 config.systemOne 块读取。这些测试同时守住「它没有被混回推理注册表」。
 */

const EMPTY_ENV: NodeJS.ProcessEnv = {};

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    schemaVersion: 2,
    defaultProvider: 'anthropic',
    defaultModelId: 'anthropic-default',
    providers: {},
    models: {},
    defaultMode: 'interactive',
    channels: {},
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function collect(it: AsyncIterable<unknown>): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of it) chunks.push(chunk as Record<string, unknown>);
  return chunks;
}

function userState(): Array<{ role: 'user'; content: Array<{ type: 'text'; text: string }> }> {
  return [{ role: 'user', content: [{ type: 'text', text: 'state' }] }];
}

describe('System One config resolution', () => {
  it('falls back to documented defaults when nothing is configured', () => {
    const resolved = resolveSystemOneConfig(baseConfig(), EMPTY_ENV);
    expect(resolved.configured).toBe(false);
    expect(resolved.apiKey).toBeNull();
    expect(resolved.keySource).toBe('none');
    expect(resolved.keyEnvVar).toBeNull();
    expect(resolved.baseUrl).toBe(SYSTEM_ONE_DEFAULT_BASE_URL);
    expect(resolved.model).toBe(SYSTEM_ONE_DEFAULT_MODEL);
  });

  it('prefers the stored config key over environment variables', () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-stored' });

    const resolved = resolveSystemOneConfig(config, { TYPESAFE_API_KEY: 'k-env' });
    expect(resolved.apiKey).toBe('k-stored');
    expect(resolved.keySource).toBe('config');
    expect(resolved.keyEnvVar).toBeNull();
  });

  it('falls back to XIAOK_TYPESAFE_API_KEY then TYPESAFE_API_KEY and names the hit variable', () => {
    const first = resolveSystemOneConfig(baseConfig(), {
      XIAOK_TYPESAFE_API_KEY: 'k-xiaok',
      TYPESAFE_API_KEY: 'k-plain',
    });
    expect(first.apiKey).toBe('k-xiaok');
    expect(first.keySource).toBe('env');
    expect(first.keyEnvVar).toBe('XIAOK_TYPESAFE_API_KEY');

    const second = resolveSystemOneConfig(baseConfig(), { TYPESAFE_API_KEY: 'k-plain' });
    expect(second.apiKey).toBe('k-plain');
    expect(second.keyEnvVar).toBe('TYPESAFE_API_KEY');
  });

  it('treats blank strings as unset rather than as a configured key', () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: '   ', baseUrl: '  ', model: '' });

    expect(config.systemOne).toBeUndefined();
    const resolved = resolveSystemOneConfig(config, { TYPESAFE_API_KEY: 'k-env' });
    expect(resolved.keySource).toBe('env');
    expect(resolved.baseUrl).toBe(SYSTEM_ONE_DEFAULT_BASE_URL);
    expect(resolved.model).toBe(SYSTEM_ONE_DEFAULT_MODEL);
  });

  it('overrides baseUrl and model, trimming and stripping trailing slashes', () => {
    const config = baseConfig();
    setSystemOneConfig(config, {
      baseUrl: ' https://proxy.example.com/ ',
      model: ' jev-1.13.0 ',
    });

    const resolved = resolveSystemOneConfig(config, EMPTY_ENV);
    expect(resolved.baseUrl).toBe('https://proxy.example.com');
    expect(resolved.model).toBe('jev-1.13.0');
    expect(systemOneEndpointUrl(resolved.baseUrl)).toBe('https://proxy.example.com/v1/systemone');
  });

  it('clears a single field without dropping the others, and removes the block when empty', () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-1', model: 'jev-1.12.1' });
    expect(config.systemOne).toEqual({ apiKey: 'k-1', model: 'jev-1.12.1' });

    setSystemOneConfig(config, { apiKey: '' });
    expect(config.systemOne).toEqual({ model: 'jev-1.12.1' });

    setSystemOneConfig(config, { model: '' });
    expect(config.systemOne).toBeUndefined();
  });

  it('leaves untouched fields alone when the patch omits them', () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-1', baseUrl: 'https://a.example.com' });
    setSystemOneConfig(config, { model: 'jev-1.13.0' });

    expect(config.systemOne).toEqual({
      apiKey: 'k-1',
      baseUrl: 'https://a.example.com',
      model: 'jev-1.13.0',
    });
  });
});

describe('Jev stays out of the inference model registry', () => {
  it('is not a first-party provider, so it cannot be picked as a chat model', () => {
    expect(getProviderProfile('jev')).toBeUndefined();
    expect(listProviderProfiles().map((profile) => profile.id)).not.toContain('jev');
  });
});

describe('System One adapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('refuses to build without a key and names the env vars to set', () => {
    expect(() => createSystemOneAdapter(baseConfig(), EMPTY_ENV)).toThrow(/TYPESAFE_API_KEY/);
  });

  it('uses the configured model and the documented 64k context window', () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-jev' });

    const adapter = createSystemOneAdapter(config, EMPTY_ENV);
    expect(adapter.getModelName()).toBe(SYSTEM_ONE_DEFAULT_MODEL);
    expect(adapter.getCapabilities().contextLimit).toBe(64_000);
  });

  it('accepts an environment key when the config block is absent', () => {
    const adapter = createSystemOneAdapter(baseConfig(), { TYPESAFE_API_KEY: 'k-env' });
    expect(adapter.getModelName()).toBe(SYSTEM_ONE_DEFAULT_MODEL);
  });

  it('maps a chosen tool to a tool_use chunk and reports usage', async () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-jev' });
    const adapter = createSystemOneAdapter(config, EMPTY_ENV);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        model: string;
        state: string;
        questions: Record<string, Record<string, unknown>>;
      };
      expect(body.model).toBe(SYSTEM_ONE_DEFAULT_MODEL);
      expect(body.state).toBe('state');
      expect(body.questions.next.type).toBe('choice');
      return jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          next: {
            type: 'choice',
            choice: 'read',
            confidence: 0.96,
            probabilities: { read: 0.97, bash: 0.03 },
          },
        },
        usage: { input_tokens: 330, output_tokens: 41 },
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const chunks = await collect(adapter.stream(
      userState(),
      [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }],
      'sys',
    ));

    expect(fetchMock.mock.calls[0][0]).toBe(`${SYSTEM_ONE_DEFAULT_BASE_URL}/v1/systemone`);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k-jev');

    const toolUse = chunks.find((c) => c.type === 'tool_use');
    expect(toolUse).toMatchObject({ type: 'tool_use', name: 'read', input: {} });
    expect(String(toolUse?.id)).toMatch(/^so-/);
    expect(chunks.find((c) => c.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 330, outputTokens: 41 },
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('renders a noul answer as text and emits no tool_use', async () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-jev' });
    const adapter = createSystemOneAdapter(config, EMPTY_ENV);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        questions: Record<string, Record<string, unknown>>;
      };
      expect(body.questions.answer.type).toBe('noul');
      return jsonResponse({
        answers: { answer: { type: 'noul', noul: 0.5 } },
        usage: { input_tokens: 273, output_tokens: 20 },
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const chunks = await collect(adapter.stream(userState(), [], 'sys'));

    expect(chunks[0]).toEqual({ type: 'text', delta: 'answer: noul=0.5' });
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(false);
  });

  it('surfaces a non-ok systemone response as an error', async () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-jev' });
    const adapter = createSystemOneAdapter(config, EMPTY_ENV);

    global.fetch = vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

    await expect(collect(adapter.stream(userState(), [], 'sys'))).rejects.toThrow(/401/);
  });

  it('propagates a caller abort, both pre-aborted and mid-flight', async () => {
    const config = baseConfig();
    setSystemOneConfig(config, { apiKey: 'k-jev' });
    const adapter = createSystemOneAdapter(config, EMPTY_ENV);

    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    global.fetch = vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      if (signal.aborted) return Promise.reject(signal.reason);
      markStarted();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }) as unknown as typeof fetch;

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(collect(adapter.stream(userState(), [], 'sys', { signal: preAborted.signal })))
      .rejects.toThrow();

    const inFlight = new AbortController();
    const pending = collect(adapter.stream(userState(), [], 'sys', { signal: inFlight.signal }));
    await started;
    inFlight.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe('System One key probe', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('probes the system_one protocol through the systemone endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      answers: { probe: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 273, output_tokens: 20 },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await probeApiKey('system_one', undefined, 'k-jev');
    expect(result.status).toBe('valid');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SYSTEM_ONE_DEFAULT_BASE_URL}/v1/systemone`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k-jev');
    expect(JSON.parse(String(init.body)).model).toBe(SYSTEM_ONE_DEFAULT_MODEL);
  });

  it('reports a rejected key as invalid and a custom base url as network_error', async () => {
    // 合约与其它协议一致：只看 HTTP 状态码，不解析响应体。
    global.fetch = vi.fn(async () => jsonResponse(
      { detail: { error_type: 'authentication_error', message: 'Cannot authenticate with the server.' } },
      401,
    )) as unknown as typeof fetch;

    const rejected = await probeApiKey('system_one', undefined, 'k-bad');
    expect(rejected.status).toBe('invalid');
    expect(rejected.httpStatus).toBe(401);

    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await probeApiKey('system_one', 'https://proxy.example.com/', 'k-jev');
    expect(result.status).toBe('network_error');
    expect(result.httpStatus).toBe(500);
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/systemone');
  });
});
