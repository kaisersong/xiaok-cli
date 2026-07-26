import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  it('inventories every production async stream consumer', () => {
    expect(findAdapterStreamConsumers()).toEqual([
      'desktop/electron/context-manager.ts#1',
      'desktop/electron/desktop-services.ts#1',
      'desktop/electron/desktop-services.ts#2',
      'desktop/electron/desktop-services.ts#3',
      'desktop/electron/loop-llm-port-impl.ts#1',
      'src/ai/intent-delegation/llm-boundary-classifier.ts#1',
      'src/ai/memory/layered-store.ts#1',
      'src/ai/runtime/agent-runtime.ts#1',
      'src/ai/runtime/compact-runner.ts#1',
    ]);
  });

  it('preserves the loop LLM consumer intentional clean-done and local-limit exits', () => {
    const source = readFileSync(
      join(process.cwd(), 'desktop/electron/loop-llm-port-impl.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /text\.length >= input\.maxTokens \* 4[\s\S]*?controller\.abort\(\);[\s\S]*?break;/,
    );
    expect(source).toMatch(
      /chunk\.type === 'done'[\s\S]*?break;/,
    );
    expect(source).not.toMatch(
      /chunk\.type === 'usage'[\s\S]{0,120}?(?:break|return)/,
    );
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
