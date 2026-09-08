import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function findAdapterStreamConsumers(): string[] {
  const consumerPattern = /for\s+await\s*\([\s\S]{0,180}?\bof\b[\s\S]{0,220}?\.stream\s*\(/g;
  const consumers: string[] = [];

  for (const root of PRODUCTION_ROOTS) {
    for (const path of listTypeScriptFiles(root)) {
      const source = readFileSync(path, 'utf8');
      const count = [...source.matchAll(consumerPattern)].length;
      for (let occurrence = 1; occurrence <= count; occurrence += 1) {
        consumers.push(`${normalizePath(relative(process.cwd(), path))}#${occurrence}`);
      }
    }
  }

  return consumers.sort();
}

describe('production ModelAdapter.stream consumer contract', () => {
  beforeEach(() => { provider.stream.mockReset(); });

  it('keeps every production async stream consumer behind the authorization owner', () => {
    expect(findAdapterStreamConsumers()).toEqual([]);
  });

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
