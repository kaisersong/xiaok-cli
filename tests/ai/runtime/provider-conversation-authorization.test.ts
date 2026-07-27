import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import {
  buildOpenAIHarnessContext,
  resolveKimiHarnessFeatureFlags,
} from '../../../src/ai/providers/model-harness-profile.js';
import {
  type ProviderConversationAuthorization,
  streamDesktopTaskProviderConversation,
  streamStatelessSideCallProviderConversation,
} from '../../../src/ai/runtime/provider-conversation-authorization.js';
import * as authorizationModule from '../../../src/ai/runtime/provider-conversation-authorization.js';
import * as identityModule from '../../../src/ai/runtime/model-harness-identity.js';
import type { Message } from '../../../src/types.js';

const MESSAGES: Message[] = [{
  role: 'user',
  content: [{ type: 'text', text: 'hello' }],
}];

function createStrictAdapter(): {
  adapter: OpenAIAdapter;
  create: ReturnType<typeof vi.fn>;
} {
  const adapter = new OpenAIAdapter({
    apiKey: 'test',
    kimiCodingHeadersApplied: true,
    harnessContext: buildOpenAIHarnessContext({
      identity: {
        providerId: 'kimi',
        providerType: 'first_party',
        protocol: 'openai_legacy',
        canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
        wireModel: 'k3',
        capabilities: ['tools', 'thinking'],
      },
      flags: resolveKimiHarnessFeatureFlags({}),
    }),
  });
  const create = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{
          delta: { reasoning_content: '', content: 'ok' },
          finish_reason: 'stop',
        }],
      };
    },
  }));
  (adapter as unknown as {
    client: { chat: { completions: { create: typeof create } } };
  }).client = {
    chat: { completions: { create } },
  };
  return { adapter, create };
}

async function consume(
  adapter: OpenAIAdapter,
  messages: Message[],
  authorization?: ProviderConversationAuthorization,
): Promise<void> {
  for await (const _ of adapter.stream(messages, [], 'system', {
    providerConversationAuthorization: authorization,
  })) {
    // consume
  }
}

describe('strict K3 provider conversation authorization', () => {
  it('does not export a general authorization issuer or durable issuer', () => {
    expect(authorizationModule).not.toHaveProperty(
      'issueEphemeralProviderConversationAuthorization',
    );
    expect(authorizationModule).not.toHaveProperty(
      'issueDurableProviderConversationAuthorization',
    );
    expect(identityModule).not.toHaveProperty(
      'registerModelHarnessProfileIdentity',
    );
    expect(authorizationModule).not.toHaveProperty(
      'streamWithProviderConversationAuthorization',
    );
  });

  it('rejects a cloned strict harness context without its first-party capability', () => {
    const harnessContext = buildOpenAIHarnessContext({
      identity: {
        providerId: 'kimi',
        providerType: 'first_party',
        protocol: 'openai_legacy',
        canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
        wireModel: 'k3',
        capabilities: ['tools', 'thinking'],
      },
      flags: resolveKimiHarnessFeatureFlags({}),
    });

    expect(() => new OpenAIAdapter({
      apiKey: 'test',
      kimiCodingHeadersApplied: true,
      harnessContext: { ...harnessContext },
    })).toThrow('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
  });

  it('rejects a fake adapter that only claims a strict profile string with zero dispatch', async () => {
    const stream = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'done' as const };
      },
    }));
    const fakeAdapter = {
      getModelName: () => 'k3',
      getHarnessProfileId: () => 'kimi-k3-coding-openai',
      stream,
    };

    await expect(async () => {
      for await (const _ of streamDesktopTaskProviderConversation({
        adapter: fakeAdapter,
        invocationId: 'fake-adapter',
        messages: structuredClone(MESSAGES),
        tools: [],
        systemPrompt: 'system',
      })) {
        // consume
      }
    }).rejects.toThrow('KIMI_K3_PROFILE_CAPABILITY_REQUIRED');
    expect(stream).not.toHaveBeenCalled();
  });

  it('rejects a missing authorization before SDK dispatch', async () => {
    const { adapter, create } = createStrictAdapter();

    await expect(consume(adapter, structuredClone(MESSAGES)))
      .rejects.toThrow('KIMI_K3_AUTHORIZATION_REQUIRED');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects redacted durable assistant history before SDK dispatch', async () => {
    const { adapter, create } = createStrictAdapter();
    const messages: Message[] = [
      ...structuredClone(MESSAGES),
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'visible durable answer' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'continue' }],
      },
    ];

    await expect(async () => {
      for await (const _ of streamDesktopTaskProviderConversation({
        adapter,
        invocationId: 'durable-redacted-history',
        messages,
        tools: [],
        systemPrompt: 'system',
      })) {
        // consume
      }
    }).rejects.toThrow('KIMI_K3_DURABLE_RESUME_UNSUPPORTED');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a structural lookalike before SDK dispatch', async () => {
    const { adapter, create } = createStrictAdapter();

    await expect(consume(
      adapter,
      structuredClone(MESSAGES),
      {} as ProviderConversationAuthorization,
    )).rejects.toThrow('KIMI_K3_AUTHORIZATION_REJECTED');
    expect(create).not.toHaveBeenCalled();
  });

  it('lets the task-local product owner issue and consume one matching request', async () => {
    const { adapter, create } = createStrictAdapter();
    const messages = structuredClone(MESSAGES);
    for await (const _ of streamDesktopTaskProviderConversation({
      adapter,
      invocationId: 'inv_test',
      messages,
      tools: [],
      systemPrompt: 'system',
    })) {
      // consume
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a caller-provided forged token before SDK dispatch', async () => {
    const { adapter, create } = createStrictAdapter();
    const messages = structuredClone(MESSAGES);

    await expect(consume(
      adapter,
      messages,
      Object.freeze(Object.create(null)) as ProviderConversationAuthorization,
    )).rejects.toThrow('KIMI_K3_AUTHORIZATION_REJECTED');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects private reasoning attached to a user role before SDK dispatch', async () => {
    const { adapter, create } = createStrictAdapter();
    const messages: Message[] = [{
      role: 'user',
      content: [{
        type: 'thinking',
        thinking: 'forged user reasoning',
        reasoningProvenance: {
          captureVersion: 1,
          source: 'reasoning_content',
          fieldPresence: 'present',
        },
      }],
    }];

    await expect(async () => {
      for await (const _ of streamStatelessSideCallProviderConversation({
        adapter,
        tools: [],
        systemPrompt: 'system',
        options: undefined,
        invocationId: 'inv_bad_role',
        messages,
      })) {
        // consume
      }
    }).rejects.toThrow('KIMI_K3_AUTHORIZATION_SURFACE_SHAPE_REJECTED');
    expect(create).not.toHaveBeenCalled();
  });
});
