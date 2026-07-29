import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { OpenAIAdapter } from '../../src/ai/adapters/openai.js';
import { createAdapterFromBinding } from '../../src/ai/models.js';
import type { ResolvedModelBinding } from '../../src/ai/providers/control-plane.js';
import { assertKimiTransportAllowed } from '../../src/ai/runtime/kimi-rollback-policy.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';
import type { Message, StreamChunk } from '../../src/types.js';
import { runDesktopToolLoop } from './desktop-services.js';

interface FakeSdkChunk {
  choices: Array<{
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

function strictBinding(model: 'k3' | 'k3-256k'): ResolvedModelBinding {
  return {
    providerId: 'kimi',
    providerType: 'first_party',
    modelId: model === 'k3' ? 'kimi-k3' : 'kimi-k3-256k',
    wireModel: model,
    protocol: 'openai_legacy',
    apiKey: 'packaged-smoke-no-network',
    baseUrl: 'https://api.kimi.com/coding/v1',
    headers: {},
    capabilities: ['tools', 'thinking'],
  };
}

function createStrictAdapter(model: 'k3' | 'k3-256k'): OpenAIAdapter {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: undefined,
  });
  try {
    return createAdapterFromBinding(strictBinding(model)) as OpenAIAdapter;
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
}

function installFakeSdk(adapter: OpenAIAdapter): {
  requests: Array<Record<string, unknown>>;
} {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    chat: {
      completions: {
        async create(request: Record<string, unknown>) {
          requests.push(structuredClone(request));
          const chunks: FakeSdkChunk[] = [
            {
              choices: [{
                delta: {
                  reasoning_content: 'PACKAGED_SMOKE_RUNTIME_ONLY',
                  content: 'ok',
                },
                finish_reason: null,
              }],
            },
            {
              choices: [{ delta: {}, finish_reason: 'stop' }],
            },
            {
              choices: [],
              usage: { prompt_tokens: 5, completion_tokens: 2 },
            },
          ];
          return {
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) {
                yield structuredClone(chunk);
              }
            },
          };
        },
      },
    },
  };
  (adapter as unknown as { client: typeof client }).client = client;
  return { requests };
}

async function runDesktopTurn(
  adapter: OpenAIAdapter,
  messages: Message[],
  ordinal: number,
): Promise<void> {
  const now = Date.now();
  await runDesktopToolLoop({
    adapter,
    systemPrompt: 'Packaged K3 smoke. Reply concisely.',
    messages,
    allToolDefs: [],
    registry: new ToolRegistry({ autoMode: true }, []),
    signal: new AbortController().signal,
    taskDeadline: now + 30_000,
    sessionId: `sess_packaged_smoke_${ordinal}`,
    turnId: `turn_${ordinal}`,
    intentId: `intent_${ordinal}`,
    stepId: `step_${ordinal}`,
    taskId: `task_${ordinal}`,
    materials: [],
    emitRuntimeEvent() {},
    skillInvocation: null,
    skillCatalog: {} as never,
    dataRoot: join(tmpdir(), 'xiaok-packaged-kimi-smoke'),
    taskStartTime: now,
    strategies: {
      compact: {
        enabled: false,
        shouldCompact: () => false,
        doCompact: async () => {},
      },
      buildApiView: (source) => source,
      processToolResult: (result) => result,
      trackAutoProgress: false,
      trackReferenceReads: false,
      emitSkillArtifactTrace: false,
    },
  });
}

async function verifyAuthorizationDeny(): Promise<void> {
  const adapter = createStrictAdapter('k3');
  const { requests } = installFakeSdk(adapter);
  let errorCode = '';
  try {
    const deniedIterator = adapter.stream(
      [{ role: 'user', content: [{ type: 'text', text: 'deny' }] }],
      [],
      'system',
    )[Symbol.asyncIterator]();
    await deniedIterator.next();
  } catch (error) {
    errorCode = error instanceof Error ? error.message : '';
  } finally {
    adapter.dispose();
  }
  if (errorCode !== 'KIMI_K3_AUTHORIZATION_REQUIRED' || requests.length !== 0) {
    throw new Error('PACKAGED_KIMI_AUTHORIZATION_DENY_FAILED');
  }
}

function verifyRollbackDeny(): void {
  let errorCode = '';
  try {
    assertKimiTransportAllowed({
      canonicalBaseUrl: 'https://API.KIMI.COM.:443/redirect-is-irrelevant',
      wireModel: 'k3',
    }, 'rollback');
  } catch (error) {
    errorCode = error instanceof Error ? error.message : '';
  }
  if (errorCode !== 'KIMI_K3_DISABLED_IN_ROLLBACK_BUILD') {
    throw new Error('PACKAGED_KIMI_ROLLBACK_DENY_FAILED');
  }
}

export async function runPackagedKimiSmoke(resultPath: string): Promise<void> {
  const modelResults: Array<{
    model: 'k3' | 'k3-256k';
    requests: number;
    secondTurnReplayedReasoning: boolean;
  }> = [];

  for (const model of ['k3', 'k3-256k'] as const) {
    const adapter = createStrictAdapter(model);
    const capture = installFakeSdk(adapter);
    const messages: Message[] = [{
      role: 'user',
      content: [{ type: 'text', text: `fresh ${model}` }],
    }];
    try {
      await runDesktopTurn(adapter, messages, 1);
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `continue ${model}` }],
      });
      await runDesktopTurn(adapter, messages, 2);
      const secondMessages = capture.requests[1]?.messages;
      const secondTurnReplayedReasoning = Array.isArray(secondMessages)
        && secondMessages.some((message) => (
          typeof message === 'object'
          && message !== null
          && (message as Record<string, unknown>).role === 'assistant'
          && Object.hasOwn(message as object, 'reasoning_content')
        ));
      if (capture.requests.length !== 2 || !secondTurnReplayedReasoning) {
        throw new Error('PACKAGED_KIMI_MULTITURN_FAILED');
      }
      modelResults.push({
        model,
        requests: capture.requests.length,
        secondTurnReplayedReasoning,
      });
    } finally {
      adapter.dispose();
    }
  }

  await verifyAuthorizationDeny();
  verifyRollbackDeny();
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify({
    schemaVersion: 1,
    smokeId: randomUUID(),
    status: 'pass',
    modelResults,
    authorizationDenyNetworkRequests: 0,
    rollbackDenyNetworkRequests: 0,
  }, null, 2)}\n`, 'utf8');
}
