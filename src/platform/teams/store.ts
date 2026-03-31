import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

export interface TeamStore {
  createTeam(input: Omit<TeamRecord, 'teamId' | 'createdAt' | 'updatedAt'>): TeamRecord;
  getTeam(teamId: string): TeamRecord | undefined;
  deleteTeam(teamId: string): void;
  listTeams(): TeamRecord[];
  appendMessage(input: Omit<TeamMessageRecord, 'messageId' | 'createdAt'>): TeamMessageRecord;
  listMessages(teamId: string): TeamMessageRecord[];
}

interface TeamStoreState {
  teams: TeamRecord[];
  messages: TeamMessageRecord[];
  nextTeamId: number;
  nextMessageId: number;
}

interface TeamStoreDocument {
  schemaVersion: 1;
  teams: TeamRecord[];
  messages: TeamMessageRecord[];
}

export class InMemoryTeamStore implements TeamStore {
  protected readonly teams = new Map<string, TeamRecord>();
  protected readonly messages = new Map<string, TeamMessageRecord[]>();
  protected nextTeamId = 1;
  protected nextMessageId = 1;

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

export class FileTeamStore extends InMemoryTeamStore {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  override createTeam(input: Omit<TeamRecord, 'teamId' | 'createdAt' | 'updatedAt'>): TeamRecord {
    const team = super.createTeam(input);
    this.persist();
    return team;
  }

  override deleteTeam(teamId: string): void {
    super.deleteTeam(teamId);
    this.persist();
  }

  override appendMessage(input: Omit<TeamMessageRecord, 'messageId' | 'createdAt'>): TeamMessageRecord {
    const message = super.appendMessage(input);
    this.persist();
    return message;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as TeamStoreDocument;
      if (parsed.schemaVersion !== 1) {
        return;
      }

      this.restore({
        teams: Array.isArray(parsed.teams) ? parsed.teams : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        nextTeamId: 1,
        nextMessageId: 1,
      });
    } catch {
      return;
    }
  }

  private restore(state: TeamStoreState): void {
    this.teams.clear();
    this.messages.clear();
    let maxTeamId = 0;
    let maxMessageId = 0;

    for (const team of state.teams) {
      if (!team?.teamId) {
        continue;
      }
      this.teams.set(team.teamId, team);
      maxTeamId = Math.max(maxTeamId, extractSequence(team.teamId, 'team_'));
    }

    for (const message of state.messages) {
      if (!message?.messageId || !message.teamId) {
        continue;
      }
      const existing = this.messages.get(message.teamId) ?? [];
      existing.push(message);
      this.messages.set(message.teamId, existing);
      maxMessageId = Math.max(maxMessageId, extractSequence(message.messageId, 'msg_'));
    }

    this.nextTeamId = Math.max(state.nextTeamId, maxTeamId + 1);
    this.nextMessageId = Math.max(state.nextMessageId, maxMessageId + 1);
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const messages = [...this.messages.values()].flat().sort((a, b) => a.createdAt - b.createdAt);
    const doc: TeamStoreDocument = {
      schemaVersion: 1,
      teams: this.listTeams(),
      messages,
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}

function extractSequence(value: string, prefix: string): number {
  if (!value.startsWith(prefix)) {
    return 0;
  }

  const parsed = Number(value.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : 0;
}
