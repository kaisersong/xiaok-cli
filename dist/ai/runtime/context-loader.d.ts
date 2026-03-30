declare const PROMPT_DOC_NAMES: readonly ["AGENTS.md", "CLAUDE.md"];
export interface LoadedContextDoc {
    name: (typeof PROMPT_DOC_NAMES)[number];
    path: string;
    content: string;
    truncated: boolean;
}
export interface LoadedGitContext {
    branch: string;
    isDirty: boolean;
    recentCommits: string[];
}
export interface LoadedContext {
    docs: LoadedContextDoc[];
    git: LoadedGitContext | null;
}
export interface GitContextProvider {
    getBranch(cwd: string): Promise<string>;
    isDirty(cwd: string): Promise<boolean>;
    getRecentCommits(cwd: string, limit: number): Promise<string[]>;
}
export interface LoadAutoContextOptions {
    cwd: string;
    maxChars?: number;
    git?: GitContextProvider;
}
export declare function loadAutoContext(options: LoadAutoContextOptions): Promise<LoadedContext>;
export declare function formatLoadedContext(context: LoadedContext): string;
export {};
