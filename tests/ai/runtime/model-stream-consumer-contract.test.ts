import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { findUnauthorizedStreamConsumers } from '../../support/model-stream-consumers.js';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopLoopLLMPort } from '../../../desktop/electron/loop-llm-port-impl.js';
import { DesktopExecutionCoordinator } from '../../../desktop/electron/desktop-execution-coordinator.js';
import type { StreamChunk } from '../../../src/types.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';

const provider = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../../../src/utils/config.js', () => ({ loadConfig: async () => ({ provider: 'test' }) }));
vi.mock('../../../src/ai/models.js', () => ({ createAdapter: () => provider }));

const completionInput = {
  model: 'fast' as const,
  systemPrompt: 'return text',
  userMessage: 'test input',
  maxTokens: 100,
  temperature: 0,
};

const PRODUCTION_ROOTS = ['src', join('desktop', 'electron')];

function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((entry) => {
      const path = join(root, entry);
      return statSync(path).isDirectory()
        ? listTypeScriptFiles(path)
        : (/\.(?:ts|tsx)$/.test(entry) ? [path] : []);
    });
}

function findAdapterStreamConsumers(): string[] {
  return findUnauthorizedStreamConsumers(PRODUCTION_ROOTS.flatMap(listTypeScriptFiles));
}

describe('production ModelAdapter.stream consumer contract', () => {
  beforeEach(() => { provider.stream.mockReset(); });

  it('distinguishes the authorized method from raw adapters, including aliases and bracket calls', () => {
    const root = mkdtempSync(join(tmpdir(), 'stream-contract-'));
    const path = join(root, 'probe.ts');
    try {
      writeFileSync(path, `
        import type { ProjectAgentModel } from ${JSON.stringify(resolve('desktop/electron/project-agent-model.ts'))};
        import type { ModelAdapter } from ${JSON.stringify(resolve('src/types.ts'))};
        async function probe(project: ProjectAgentModel, adapter: ModelAdapter, input: any) {
          for await (const chunk of project.stream(input)) {}
          const approvedAlias = project;
          for await (const chunk of approvedAlias['stream'](input)) {}
          for await (const chunk of adapter.stream([], [], '')) {}
          const rawAlias = adapter;
          for await (const chunk of (rawAlias['stream']([], [], ''))) {}
          for await (const chunk of (input.flag ? project.stream(input) : adapter.stream([], [], ''))) {}
          for await (const chunk of (input.flag ? project.stream : adapter.stream)(input)) {}
          const iterator = adapter.stream([], [], '');
          for await (const chunk of iterator) {}
          const method = adapter.stream;
          for await (const chunk of method.call(adapter, [], [], '')) {}
          async function* delegated() { yield* adapter.stream([], [], ''); }
          const approvedMethod = project.stream;
          approvedMethod.call(project, input);
          const metadata: {stream: string} = {stream: 'stdout'};
          metadata.stream;
          const key = 'stream';
          adapter[key]([], [], '');
        }
      `);
      expect(findUnauthorizedStreamConsumers([path])).toHaveLength(8);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20_000);

  it('permits only the audited owner and deny functions, rejecting same-file siblings and nested functions', () => {
    const root = mkdtempSync(join(tmpdir(), 'stream-authority-'));
    try {
      const owner = join(root, 'src/ai/runtime/provider-conversation-authorization.ts');
      const smoke = join(root, 'desktop/electron/kimi-packaged-smoke.ts');
      mkdirSync(dirname(owner), {recursive: true}); mkdirSync(dirname(smoke), {recursive: true});
      writeFileSync(owner, `
        function streamOwnedProviderConversation(input: any) {
          input.adapter.stream([], [], '');
          const nested = () => input.adapter.stream([], [], '');
        }
        function sibling(input: any) { return input.adapter.stream([], [], ''); }
      `);
      writeFileSync(smoke, `
        function verifyAuthorizationDeny(adapter: any) { adapter.stream([], [], ''); }
        function sibling(adapter: any) { return adapter.stream([], [], ''); }
      `);
      expect(findUnauthorizedStreamConsumers([owner, smoke], root)).toHaveLength(3);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });

  it('rejects an unrelated stream method in the wrapper file instead of granting the whole file', () => {
    const root = mkdtempSync(join(tmpdir(), 'stream-wrapper-'));
    try {
      const wrapper = join(root, 'desktop/electron/project-agent-model.ts');
      const probe = join(root, 'probe.ts');
      mkdirSync(dirname(wrapper), {recursive: true});
      writeFileSync(wrapper, `
        export async function createProjectAgentModel() { return {async *stream() {}}; }
        export class Unrelated { stream() {} }
      `);
      writeFileSync(probe, `
        import { createProjectAgentModel, Unrelated } from './desktop/electron/project-agent-model';
        async function check() {
          const model = await createProjectAgentModel();
          model.stream();
          new Unrelated().stream();
        }
      `);
      expect(findUnauthorizedStreamConsumers([wrapper, probe], root)).toHaveLength(1);
    } finally {rmSync(root, {recursive: true, force: true});}
  });

  it('keeps every production async stream consumer behind the authorization owner', () => {
    expect(findAdapterStreamConsumers()).toEqual([]);
  }, 30_000);

  it('consumes text across usage chunks and closes the provider iterator at done', async () => {
    const closed = vi.fn();
    const afterDone = vi.fn();
    provider.stream.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      try {
        yield { type: 'text', delta: 'before ' };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } };
        yield { type: 'text', delta: 'after usage' };
        yield { type: 'done' };
        afterDone();
        yield { type: 'text', delta: 'must not be consumed' };
      } finally {
        closed();
      }
    });

    await expect(createDesktopLoopLLMPort().complete(completionInput))
      .resolves.toEqual({ text: 'before after usage' });
    expect(afterDone).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('allows output exactly at the local budget without cancelling the provider', async () => {
    provider.stream.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', delta: 'x'.repeat(400) };
      yield { type: 'done' };
    });

    await expect(createDesktopLoopLLMPort().complete(completionInput))
      .resolves.toEqual({ text: 'x'.repeat(400) });
    const options = provider.stream.mock.calls[0][3] as StreamOptions;
    expect(options.signal?.aborted).toBe(false);
  });

  it('rejects cumulative output overflow, cancels the provider and releases the execution lease', async () => {
    const closed = vi.fn();
    const afterOverflow = vi.fn();
    provider.stream.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      try {
        yield { type: 'text', delta: 'x'.repeat(400) };
        yield { type: 'text', delta: 'y' };
        afterOverflow();
        yield { type: 'done' };
      } finally {
        closed();
      }
    });
    const coordinator = new DesktopExecutionCoordinator({ capacity: 1, backgroundCapacity: 1 });
    const port = createDesktopLoopLLMPort(coordinator);

    await expect(port.complete(completionInput)).rejects.toThrow('loop_llm_output_limit');
    const options = provider.stream.mock.calls[0][3] as StreamOptions;
    expect(options.signal?.aborted).toBe(true);
    expect(options.signal?.reason).toMatchObject({ message: 'loop_llm_output_limit' });
    expect(afterOverflow).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()).toEqual({ active: 0, waiting: 0, capacity: 2 });

    provider.stream.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', delta: 'next task' };
      yield { type: 'done' };
    });
    await expect(port.complete(completionInput)).resolves.toEqual({ text: 'next task' });
  });

  it('does not add logging of cache affinity state at its production ownership seams', () => {
    const affinityOwnerPaths = [
      'src/ai/runtime/prompt-cache-affinity.ts',
      'src/ai/runtime/runtime-facade.ts',
      'src/ai/runtime/agent-runtime.ts',
      'src/ai/adapters/openai.ts',
      'desktop/electron/desktop-services.ts',
    ];
    const unsafeLogCalls: string[] = [];

    for (const path of affinityOwnerPaths) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      for (const match of source.matchAll(/\b(?:console|logger)\.(?:debug|info|warn|error|log)\s*\(/g)) {
        const call = source.slice(match.index, source.indexOf(');', match.index) + 2);
        if (/\b(?:cacheKey|invocationOptions)\b/.test(call)) {
          unsafeLogCalls.push(`${path}: ${call}`);
        }
      }
    }

    expect(unsafeLogCalls).toEqual([]);
  });
});
