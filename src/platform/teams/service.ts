import { InMemoryTeamStore, type TeamMessageRecord, type TeamRecord } from './store.js';

export interface CreateTeamInput {
  name: string;
  owner: string;
  members: string[];
}

export interface SendTeamMessageInput {
  teamId: string;
  from: string;
  to: string;
  body: string;
}

export interface TeamServiceOptions {
  store: InMemoryTeamStore;
}

export interface TeamService {
  createTeam(input: CreateTeamInput): TeamRecord;
  getTeam(teamId: string): TeamRecord | undefined;
  deleteTeam(teamId: string): void;
  sendMessage(input: SendTeamMessageInput): TeamMessageRecord;
  listMessages(teamId: string): TeamMessageRecord[];
  findTeamsByMember(member: string): TeamRecord[];
}

export function createTeamService(options: TeamServiceOptions): TeamService {
  const { store } = options;

  return {
    createTeam(input) {
      return store.createTeam({
        name: input.name,
        owner: input.owner,
        members: [...input.members],
      });
    },

    getTeam(teamId) {
      return store.getTeam(teamId);
    },

    deleteTeam(teamId) {
      store.deleteTeam(teamId);
    },

    sendMessage(input) {
      const team = store.getTeam(input.teamId);
      if (!team) {
        throw new Error(`team not found: ${input.teamId}`);
      }

      return store.appendMessage({
        teamId: input.teamId,
        from: input.from,
        to: input.to,
        body: input.body,
      });
    },

    listMessages(teamId) {
      return store.listMessages(teamId);
    },

    findTeamsByMember(member) {
      return store.listTeams().filter((team) => team.members.includes(member));
    },
  };
}
