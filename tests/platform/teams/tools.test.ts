import { describe, expect, it } from 'vitest';
import { createTeamTools } from '../../../src/platform/teams/tools.js';
import { InMemoryTeamStore } from '../../../src/platform/teams/store.js';
import { createTeamService } from '../../../src/platform/teams/service.js';

describe('team tools', () => {
  it('creates teams and sends messages through safe runtime tools', async () => {
    const service = createTeamService({ store: new InMemoryTeamStore() });
    const tools = createTeamTools(service);
    const createTool = tools.find((tool) => tool.definition.name === 'team_create');
    const messageTool = tools.find((tool) => tool.definition.name === 'team_message');
    const listTool = tools.find((tool) => tool.definition.name === 'team_list_messages');

    const created = await createTool?.execute({
      name: 'platform',
      owner: 'lead',
      members: ['lead', 'worker'],
    });
    const teamId = created?.match(/team_\d+/)?.[0];

    expect(teamId).toBeTruthy();

    const messageResult = await messageTool?.execute({
      team_id: teamId,
      from: 'lead',
      to: 'worker',
      body: 'check diagnostics',
    });
    const listed = await listTool?.execute({ team_id: teamId });

    expect(messageResult).toContain('msg_1');
    expect(listed).toContain('check diagnostics');
  });
});
