export interface CustomAgentDef {
    name: string;
    systemPrompt: string;
    allowedTools?: string[];
    model?: string;
    maxIterations?: number;
    background?: boolean;
    isolation?: 'shared' | 'worktree';
    cleanup?: 'keep' | 'delete';
    team?: string;
    source?: 'global' | 'project';
}
export declare function parseAgentFile(name: string, raw: string): CustomAgentDef;
export declare function loadCustomAgents(xiaokConfigDir?: string, cwd?: string, extraDirs?: string[]): Promise<CustomAgentDef[]>;
