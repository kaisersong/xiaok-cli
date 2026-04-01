export type SkillExecutionContext = 'inline' | 'fork';
export interface SkillMeta {
    name: string;
    description: string;
    content: string;
    path: string;
    source: 'builtin' | 'global' | 'project';
    tier: 'system' | 'user' | 'project';
    allowedTools: string[];
    executionContext: SkillExecutionContext;
    agent?: string;
    model?: string;
    effort?: string;
    dependsOn: string[];
    userInvocable: boolean;
    whenToUse?: string;
}
export interface SkillLoadOptions {
    builtinRoots?: string[];
    extraRoots?: string[];
}
export interface SkillCatalog {
    reload(): Promise<SkillMeta[]>;
    list(): SkillMeta[];
    get(name: string): SkillMeta | undefined;
    resolve(names: string[]): SkillMeta[];
}
export declare function loadSkills(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): Promise<SkillMeta[]>;
export declare function createSkillCatalog(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): SkillCatalog;
export declare function formatSkillsContext(skills: SkillMeta[]): string;
export declare function parseSlashCommand(input: string): {
    skillName: string;
    rest: string;
} | null;
