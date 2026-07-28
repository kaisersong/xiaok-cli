import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runOpenAINativeCompactionSmoke,
} from '../../../src/ai/evals/openai-native-compaction-smoke.js';
import { createHash } from 'node:crypto';

const INITIAL_INPUT = [
  {
    role: 'system',
    content: [
      {
        type: 'input_text',
        text: 'This isolated smoke uses synthetic, declassified data only.',
      },
    ],
  },
  {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: 'Call synthetic_lookup for the fixed synthetic record.',
      },
    ],
  },
];

const SYNTHETIC_TOOLS = [
  {
    type: 'function',
    name: 'synthetic_lookup',
    description: 'Returns a fixed synthetic value without external execution.',
    parameters: {
      type: 'object',
      properties: {
        record: { type: 'string' },
      },
      required: ['record'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const NEXT_USER_ITEM = {
  role: 'user',
  content: [
    {
      type: 'input_text',
      text: 'Confirm the synthetic sequence is complete in one sentence.',
    },
  ],
};

const FIRST_OUTPUT = [
  {
    type: 'reasoning',
    id: 'reasoning_1',
    encrypted_content: 'opaque-first-reasoning',
  },
  {
    type: 'message',
    id: 'message_1',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'opaque-first-message' }],
  },
  {
    type: 'function_call',
    id: 'function_1',
    call_id: 'call_synthetic_1',
    name: 'synthetic_lookup',
    arguments: '{"record":"synthetic-1"}',
  },
];

const PAIRED_TOOL_OUTPUT = {
  type: 'function_call_output',
  call_id: 'call_synthetic_1',
  output: '{"status":"ok","value":"synthetic-caller-fixed-value"}',
};

const COMPACT_OUTPUT = [
  {
    type: 'reasoning',
    id: 'reasoning_compact',
    encrypted_content: 'opaque-compact-reasoning',
  },
  {
    type: 'compaction',
    id: 'compaction_1',
    encrypted_content: 'opaque-canonical-context',
  },
  {
    type: 'message',
    id: 'message_compact',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'opaque-compact-message' }],
  },
];

const SMOKE_FIXTURE = {
  initialInput: INITIAL_INPUT,
  tools: SYNTHETIC_TOOLS,
  fixedToolOutputs: {
    synthetic_lookup: PAIRED_TOOL_OUTPUT.output,
  },
  nextUserItem: NEXT_USER_ITEM,
};

const ACCOUNT_PROJECT_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function responsePayload(input: {
  id: string;
  object?: 'response' | 'response.compaction';
  createdAt: number;
  output: Array<Record<string, unknown>>;
  inputTokens: number;
  outputTokens: number;
}): Response {
  return new Response(JSON.stringify({
    id: input.id,
    object: input.object ?? 'response',
    created_at: input.createdAt,
    output: input.output,
    usage: {
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      total_tokens: input.inputTokens + input.outputTokens,
      input_tokens_details: { cached_tokens: 0 },
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runOpenAINativeCompactionSmoke', () => {
  it('uses the exact three-request synthetic ledger and preserves raw output order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responsePayload({
        id: 'resp_initial',
        createdAt: 1,
        output: FIRST_OUTPUT,
        inputTokens: 10,
        outputTokens: 4,
      }))
      .mockResolvedValueOnce(responsePayload({
        id: 'resp_compact',
        object: 'response.compaction',
        createdAt: 2,
        output: COMPACT_OUTPUT,
        inputTokens: 14,
        outputTokens: 2,
      }))
      .mockResolvedValueOnce(responsePayload({
        id: 'resp_continuation',
        createdAt: 3,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'opaque-final-message' }],
          },
        ],
        inputTokens: 8,
        outputTokens: 3,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: 'sk-live-secret-must-not-leak',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
      accountProjectFingerprint: ACCOUNT_PROJECT_FINGERPRINT,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/responses/compact',
      'https://api.openai.com/v1/responses',
    ]);

    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
      model: 'gpt-synthetic-test',
      input: INITIAL_INPUT,
      tools: SYNTHETIC_TOOLS,
      store: false,
    });
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({
      model: 'gpt-synthetic-test',
      input: [
        ...INITIAL_INPUT,
        ...FIRST_OUTPUT,
        PAIRED_TOOL_OUTPUT,
      ],
    });
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({
      model: 'gpt-synthetic-test',
      input: [
        ...COMPACT_OUTPUT,
        NEXT_USER_ITEM,
      ],
      tools: SYNTHETIC_TOOLS,
      store: false,
    });
    expect(evidence.status).toBe('passed');
    expect(evidence.requests.map((request) => request.responseId)).toEqual([
      'resp_initial',
      'resp_compact',
      'resp_continuation',
    ]);
  });

  it('returns a versioned safe evidence artifact without secrets or opaque content', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responsePayload({
        id: 'resp_initial',
        createdAt: 1,
        output: FIRST_OUTPUT,
        inputTokens: 10,
        outputTokens: 4,
      }))
      .mockResolvedValueOnce(responsePayload({
        id: 'resp_compact',
        object: 'response.compaction',
        createdAt: 2,
        output: COMPACT_OUTPUT,
        inputTokens: 14,
        outputTokens: 2,
      }))
      .mockResolvedValueOnce(responsePayload({
        id: 'resp_continuation',
        createdAt: 3,
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'opaque-final-message' }] }],
        inputTokens: 8,
        outputTokens: 3,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: 'sk-live-secret-must-not-leak',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
      accountProjectFingerprint: ACCOUNT_PROJECT_FINGERPRINT,
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      suiteVersion: 'openai-native-compaction-smoke-v1',
      status: 'passed',
      generatedAt: expect.any(String),
      modelFingerprint: fingerprint('gpt-synthetic-test'),
      originFingerprint: fingerprint('https://api.openai.com/v1'),
      accountProjectFingerprint: ACCOUNT_PROJECT_FINGERPRINT,
      requests: [
        {
          phase: 'initial',
          responseId: 'resp_initial',
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          elapsedMs: expect.any(Number),
        },
        {
          phase: 'compact',
          responseId: 'resp_compact',
          usage: { inputTokens: 14, outputTokens: 2, totalTokens: 16 },
          elapsedMs: expect.any(Number),
        },
        {
          phase: 'continuation',
          responseId: 'resp_continuation',
          usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
          elapsedMs: expect.any(Number),
        },
      ],
      totalUsage: {
        inputTokens: 32,
        outputTokens: 9,
        totalTokens: 41,
      },
      elapsedMs: expect.any(Number),
    });
    expect(serialized).not.toContain('sk-live-secret-must-not-leak');
    expect(serialized).not.toContain('opaque-');
    expect(serialized).not.toContain('synthetic-caller-fixed-value');
    expect(serialized).not.toContain('{"record":"synthetic-1"}');
  });

  it('reports missing live capability without probing local auth or making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: undefined,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
    });

    expect(evidence).toEqual({
      schemaVersion: 1,
      suiteVersion: 'openai-native-compaction-smoke-v1',
      status: 'live_capability_smoke_missing',
      generatedAt: expect.any(String),
      modelFingerprint: fingerprint('gpt-synthetic-test'),
      originFingerprint: fingerprint('https://api.openai.com/v1'),
      accountProjectFingerprint: undefined,
      requests: [],
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      elapsedMs: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not run a live smoke without an irreversible account/project identity', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: 'sk-live-secret-must-not-leak',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
    });

    expect(evidence.status).toBe('live_capability_smoke_missing');
    expect(evidence.accountProjectFingerprint).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized failed artifact when a live phase fails', async () => {
    const fetchMock = vi.fn(async () => new Response(
      'opaque-provider-error-containing-sk-live-secret-must-not-leak',
      { status: 429 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: 'sk-live-secret-must-not-leak',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
      accountProjectFingerprint: ACCOUNT_PROJECT_FINGERPRINT,
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      status: 'failed',
      failureClass: 'http_429',
      requests: [],
    });
    expect(serialized).not.toContain('opaque-provider-error');
    expect(serialized).not.toContain('sk-live-secret-must-not-leak');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('classifies transport timeouts separately from caller aborts', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: 'sk-live-secret-must-not-leak',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
      accountProjectFingerprint: ACCOUNT_PROJECT_FINGERPRINT,
    });

    expect(evidence).toMatchObject({
      status: 'failed',
      failureClass: 'timeout',
      failurePhase: 'initial',
      requests: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not treat inherited object properties as caller-provided fixed outputs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(responsePayload({
      id: 'resp_initial',
      createdAt: 1,
      output: [
        {
          type: 'function_call',
          call_id: 'call_inherited',
          name: 'toString',
          arguments: '{}',
        },
      ],
      inputTokens: 5,
      outputTokens: 1,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const evidence = await runOpenAINativeCompactionSmoke({
      apiKey: 'sk-live-secret-must-not-leak',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-synthetic-test',
      fixture: SMOKE_FIXTURE,
      accountProjectFingerprint: ACCOUNT_PROJECT_FINGERPRINT,
    });

    expect(evidence).toMatchObject({
      status: 'failed',
      failureClass: 'synthetic_fixture_unexpected_tool',
      failurePhase: 'initial',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
