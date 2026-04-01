import { describe, expect, it } from 'vitest';
import { InMemoryTeamStore } from '../../../src/platform/teams/store.js';
import { createTeamService } from '../../../src/platform/teams/service.js';

describe('team service', () => {
  it('creates and deletes teams', () => {
    const service = createTeamService({ store: new InMemoryTeamStore() });

    const team = service.createTeam({
      name: 'platform',
      members: ['agent-a', 'agent-b'],
      owner: 'agent-a',
    });

    expect(team.teamId).toBe('team_1');
    expect(service.getTeam(team.teamId)?.members).toEqual(['agent-a', 'agent-b']);

    service.deleteTeam(team.teamId);
    expect(service.getTeam(team.teamId)).toBeUndefined();
  });

  it('routes messages to the target team mailbox', () => {
    const service = createTeamService({ store: new InMemoryTeamStore() });
    const team = service.createTeam({
      name: 'platform',
      members: ['agent-a', 'agent-b'],
      owner: 'agent-a',
    });

    const message = service.sendMessage({
      teamId: team.teamId,
      from: 'agent-a',
      to: 'agent-b',
      body: 'please review the branch',
    });

    expect(message.messageId).toBe('msg_1');
    expect(service.listMessages(team.teamId)).toEqual([
      expect.objectContaining({
        teamId: team.teamId,
        from: 'agent-a',
        to: 'agent-b',
        body: 'please review the branch',
      }),
    ]);
  });

  it('finds teams by member', () => {
    const service = createTeamService({ store: new InMemoryTeamStore() });
    const team1 = service.createTeam({
      name: 'platform',
      members: ['agent-a', 'agent-b'],
      owner: 'agent-a',
    });
    service.createTeam({
      name: 'reviewers',
      members: ['agent-c'],
      owner: 'agent-c',
    });

    expect(service.findTeamsByMember('agent-b').map((team) => team.teamId)).toEqual([team1.teamId]);
  });

  it('finds teams by name', () => {
    const service = createTeamService({ store: new InMemoryTeamStore() });
    const team = service.createTeam({
      name: 'platform',
      members: ['agent-a'],
      owner: 'agent-a',
    });

    expect(service.findTeamByName('platform')?.teamId).toBe(team.teamId);
  });
});
