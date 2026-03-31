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
export declare class InMemoryTeamStore {
    private readonly teams;
    private readonly messages;
    private nextTeamId;
    private nextMessageId;
    createTeam(input: Omit<TeamRecord, 'teamId' | 'createdAt' | 'updatedAt'>): TeamRecord;
    getTeam(teamId: string): TeamRecord | undefined;
    deleteTeam(teamId: string): void;
    listTeams(): TeamRecord[];
    appendMessage(input: Omit<TeamMessageRecord, 'messageId' | 'createdAt'>): TeamMessageRecord;
    listMessages(teamId: string): TeamMessageRecord[];
}
