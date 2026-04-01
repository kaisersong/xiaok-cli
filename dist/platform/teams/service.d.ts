import type { TeamMessageRecord, TeamRecord, TeamStore } from './store.js';
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
    store: TeamStore;
}
export interface TeamService {
    createTeam(input: CreateTeamInput): TeamRecord;
    getTeam(teamId: string): TeamRecord | undefined;
    findTeamByName(name: string): TeamRecord | undefined;
    deleteTeam(teamId: string): void;
    sendMessage(input: SendTeamMessageInput): TeamMessageRecord;
    listMessages(teamId: string): TeamMessageRecord[];
    findTeamsByMember(member: string): TeamRecord[];
}
export declare function createTeamService(options: TeamServiceOptions): TeamService;
