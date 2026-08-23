import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeApiKey, probeCandidates } from '../../../src/ai/providers/key-probe.js';

describe('probeApiKey', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns valid when the anthropic models endpoint responds 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await probeApiKey('anthropic', undefined, 'sk-test');

    expect(result.status).toBe('valid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBeTruthy();
  });

  it('uses a custom baseUrl when provided, stripping trailing slashes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await probeApiKey('anthropic', 'https://proxy.example.com/', 'sk-test');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proxy.example.com/v1/models?limit=1');
  });

  it('builds an OpenAI-compatible request with Bearer auth for openai_legacy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await probeApiKey('openai_legacy', 'https://api.deepseek.com/v1', 'sk-deepseek');

    expect(result.status).toBe('valid');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-deepseek');
  });

  it('builds a request for openai_responses using the /models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await probeApiKey('openai_responses', 'https://generativelanguage.googleapis.com/v1beta/openai', 'sk-gemini');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
  });

  it('returns invalid on 401 responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

    const result = await probeApiKey('openai_legacy', 'https://api.openai.com/v1', 'sk-bad');

    expect(result.status).toBe('invalid');
    expect(result.httpStatus).toBe(401);
  });

  it('returns invalid on 403 responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })) as unknown as typeof fetch;

    const result = await probeApiKey('anthropic', undefined, 'sk-bad');

    expect(result.status).toBe('invalid');
    expect(result.httpStatus).toBe(403);
  });

  it('returns network_error on other non-ok statuses', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('server error', { status: 500 })) as unknown as typeof fetch;

    const result = await probeApiKey('openai_legacy', 'https://api.openai.com/v1', 'sk-test');

    expect(result.status).toBe('network_error');
    expect(result.httpStatus).toBe(500);
  });

  it('returns network_error when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const result = await probeApiKey('openai_legacy', 'https://api.openai.com/v1', 'sk-test');

    expect(result.status).toBe('network_error');
    expect(result.detail).toContain('fetch failed');
  });

  it('returns unknown_protocol for unsupported protocols without making a request', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await probeApiKey('not_a_real_protocol' as never, undefined, 'sk-test');

    expect(result.status).toBe('unknown_protocol');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('probeCandidates', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('probes each candidate independently and preserves order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await probeCandidates('anthropic', undefined, [
      { source: 'xiaok_env', envVarName: 'XIAOK_ANTHROPIC_API_KEY', apiKey: 'sk-bad' },
      { source: 'standard_env', envVarName: 'ANTHROPIC_API_KEY', apiKey: 'sk-good' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].result.status).toBe('invalid');
    expect(results[1].result.status).toBe('valid');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
