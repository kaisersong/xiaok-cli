import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat runtime integration boundary', () => {
  it('keeps chat on the Agent facade and routes turns through RuntimeFacade', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from '../ai/agent.js'");
    expect(source).toContain("from '../ai/runtime/runtime-facade.js'");
    expect(source).not.toContain('AgentRuntime');
    expect(source).not.toContain("from '../ai/runtime/agent-runtime.js'");
  });
});
