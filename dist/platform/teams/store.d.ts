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
export declare class InMemoryTeamStore implements TeamStore {
    protected readonly teams: Map<string, TeamRecord>;
    protected readonly messages: Map<string, TeamMessageRecord[]>;
    protected nextTeamId: number;
    protected nextMessageId: number;
    createTeam(input: Omit<TeamRecord, 'teamId' | 'createdAt' | 'updatedAt'>): TeamRecord;
    getTeam(teamId: string): TeamRecord | undefined;
    deleteTeam(teamId: string): void;
    listTeams(): TeamRecord[];
    appendMessage(input: Omit<TeamMessageRecord, 'messageId' | 'createdAt'>): TeamMessageRecord;
    listMessages(teamId: string): TeamMessageRecord[];
}
export declare class FileTeamStore extends InMemoryTeamStore {
    private readonly filePath;
    constructor(filePath: string);
    createTeam(input: Omit<TeamRecord, 'teamId' | 'createdAt' | 'updatedAt'>): TeamRecord;
    deleteTeam(teamId: string): void;
    appendMessage(input: Omit<TeamMessageRecord, 'messageId' | 'createdAt'>): TeamMessageRecord;
    private load;
    private restore;
    private persist;
}
