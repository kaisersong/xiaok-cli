import { describe, expect, it } from 'vitest';
import type { Tool } from '../../../src/types.js';
import { filterWorkflowToolsForAgent } from '../../../src/platform/runtime/registry-factory.js';

const tool = (name: string): Tool => ({
  permission: 'safe',
  definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
  async execute() { return 'ok'; },
});

describe('Goal tool registry boundary', () => {
  it('keeps Goal tools on the root runtime only', () => {
    const tools = [tool('goal_get'), tool('goal_request_complete'), tool('ask_user')];
    expect(filterWorkflowToolsForAgent(tools, 'main').map(item => item.definition.name)).toEqual([
      'goal_get', 'goal_request_complete', 'ask_user',
    ]);
    expect(filterWorkflowToolsForAgent(tools, 'worker').map(item => item.definition.name)).toEqual([
      'ask_user',
    ]);
  });
});
