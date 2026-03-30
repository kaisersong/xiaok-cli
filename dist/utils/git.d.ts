export declare function getCurrentBranch(cwd: string): Promise<string>;
export declare function isGitDirty(cwd: string): Promise<boolean>;
export declare function getRecentCommitSubjects(cwd: string, limit?: number): Promise<string[]>;
