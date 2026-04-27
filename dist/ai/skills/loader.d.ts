import type { TaskSkillHints } from '../intent-delegation/types.js';
export type SkillExecutionContext = 'inline' | 'fork';
export interface SkillMeta {
    name: string;
    aliases?: string[];
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
    taskHints: TaskSkillHints;
}
export interface SkillLoadOptions {
    builtinRoots?: string[];
    extraRoots?: string[];
}
export interface ResolvedSkillRoots {
    builtinRoots: string[];
    globalSkillsDir: string;
    projectSkillsDir: string;
}
export interface SkillCatalog {
    reload(): Promise<SkillMeta[]>;
    list(): SkillMeta[];
    get(name: string): SkillMeta | undefined;
    resolve(names: string[]): SkillMeta[];
}
export interface ParsedFrontmatter {
    name: string;
    description: string;
    content: string;
    allowedTools: string[];
    executionContext: SkillExecutionContext;
    agent?: string;
    model?: string;
    effort?: string;
    dependsOn: string[];
    userInvocable?: boolean;
    whenToUse?: string;
    taskGoals: string[];
    inputKinds: string[];
    outputKinds: string[];
    examples: string[];
}
export declare function parseFrontmatter(raw: string): ParsedFrontmatter | null;
export declare function resolveSkillRoots(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): ResolvedSkillRoots;
export declare function discoverSkills(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): Promise<SkillMeta[]>;
export declare function loadSkills(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): Promise<SkillMeta[]>;
export declare function createSkillCatalog(xiaokConfigDir?: string, cwd?: string, options?: SkillLoadOptions): SkillCatalog;
export declare function formatSkillEntry(skill: SkillMeta): string;
export declare function formatSkillsContext(skills: SkillMeta[]): string;
export declare function toSkillEntries(skills: SkillMeta[]): Array<{
    name: string;
    listing: string;
}>;
export declare function getSkillCommandNames(skill: SkillMeta): string[];
export declare function findSkillByCommandName(skills: SkillMeta[], name: string): SkillMeta | undefined;
export declare function parseSlashCommand(input: string): {
    skillName: string;
    rest: string;
} | null;
