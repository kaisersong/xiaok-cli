import { describe, expect, it } from 'vitest';
import { createPlatformRuntimeContext } from '../../../../src/platform/runtime/context.js';

describe('platform runtime context', () => {
  it('reports a stable summary when no plugin capabilities are declared', async () => {
    const context = await createPlatformRuntimeContext({
      cwd: process.cwd(),
      builtinCommands: ['chat', 'yzj'],
    });

    expect(context.health.hasDegradedCapabilities()).toBe(false);
    expect(context.health.summary()).toBe('capabilities: none declared');

    await context.dispose();
  });
});
