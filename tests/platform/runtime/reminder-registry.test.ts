import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelAdapter } from '../../../src/types.js';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';

async function* doneOnly() {
  yield { type: 'done' } as const;
}

describe('platform reminder registry', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers reminder tools for chat sessions', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    const adapter: ModelAdapter = {
      getModelName: () => 'base-model',
      stream: () => doneOnly(),
    };
    const factory = createPlatformRegistryFactory({
      platform: context,
      source: 'chat',
      sessionId: 'sess_registry',
      adapter: () => adapter,
      buildSystemPrompt: async () => 'system',
    });
    const registry = factory.createRegistry(cwd);
    const toolNames = registry.getToolDefinitions().map((tool) => tool.name);

    expect(toolNames).toContain('reminder_create');
    expect(toolNames).toContain('reminder_list');
    expect(toolNames).toContain('reminder_cancel');

    await context.dispose();
  });
});
