export interface TeamRecord {
  teamId: string;
  name: string;
  owner: string;
  members: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TeamMessageRecord {
  messageId: string;
  teamId: string;
  from: string;
  to: string;
  body: string;
  createdAt: number;
}

export class InMemoryTeamStore {
  private readonly teams = new Map<string, TeamRecord>();
  private readonly messages = new Map<string, TeamMessageRecord[]>();
  private nextTeamId = 1;
  private nextMessageId = 1;

  createTeam(input: Omit<TeamRecord, 'teamId' | 'createdAt' | 'updatedAt'>): TeamRecord {
    const now = Date.now();
    const team: TeamRecord = {
      ...input,
      teamId: `team_${this.nextTeamId++}`,
      createdAt: now,
      updatedAt: now,
    };
    this.teams.set(team.teamId, team);
    return team;
  }

  getTeam(teamId: string): TeamRecord | undefined {
    return this.teams.get(teamId);
  }

  deleteTeam(teamId: string): void {
    this.teams.delete(teamId);
    this.messages.delete(teamId);
  }

  listTeams(): TeamRecord[] {
    return [...this.teams.values()];
  }

  appendMessage(input: Omit<TeamMessageRecord, 'messageId' | 'createdAt'>): TeamMessageRecord {
    const message: TeamMessageRecord = {
      ...input,
      messageId: `msg_${this.nextMessageId++}`,
      createdAt: Date.now(),
    };
    const existing = this.messages.get(input.teamId) ?? [];
    existing.push(message);
    this.messages.set(input.teamId, existing);
    return message;
  }

  listMessages(teamId: string): TeamMessageRecord[] {
    return [...(this.messages.get(teamId) ?? [])];
  }
}
