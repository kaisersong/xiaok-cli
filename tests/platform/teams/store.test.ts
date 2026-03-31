import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTeamStore, InMemoryTeamStore } from '../../../src/platform/teams/store.js';

describe('team store', () => {
  it('stores teams and messages in memory', () => {
    const store = new InMemoryTeamStore();
    const team = store.createTeam({
      name: 'platform',
      owner: 'lead',
      members: ['lead', 'worker'],
    });

    store.appendMessage({
      teamId: team.teamId,
      from: 'lead',
      to: 'worker',
      body: 'check diagnostics',
    });

    expect(store.listTeams()).toHaveLength(1);
    expect(store.listMessages(team.teamId)[0]).toMatchObject({
      body: 'check diagnostics',
    });
  });

  it('persists teams and messages across store instances', () => {
    const root = join(tmpdir(), `xiaok-team-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'teams.json');

    try {
      const store = new FileTeamStore(filePath);
      const team = store.createTeam({
        name: 'platform',
        owner: 'lead',
        members: ['lead', 'worker'],
      });
      store.appendMessage({
        teamId: team.teamId,
        from: 'lead',
        to: 'worker',
        body: 'persist this',
      });

      const reloaded = new FileTeamStore(filePath);
      expect(reloaded.getTeam(team.teamId)).toMatchObject({
        name: 'platform',
        owner: 'lead',
      });
      expect(reloaded.listMessages(team.teamId)[0]).toMatchObject({
        body: 'persist this',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
