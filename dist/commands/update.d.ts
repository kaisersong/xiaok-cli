import type { Command } from 'commander';
export interface UpdateProcessInvocation {
    command: string;
    args: string[];
    shell: boolean;
    stdio: 'pipe' | 'inherit';
}
export interface UpdateProcessResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export type UpdateProcessRunner = (invocation: UpdateProcessInvocation) => Promise<UpdateProcessResult>;
interface UpdateDependencies {
    run?: UpdateProcessRunner;
    log?: (message: string) => void;
    platform?: NodeJS.Platform;
}
export type UpdateResult = {
    status: 'current' | 'newer' | 'updated';
    currentVersion: string;
    latestVersion: string;
};
export declare function compareSemver(left: string, right: string): number;
export declare function parseLatestVersion(output: string): string;
export declare function buildNpmUpdateInvocation(kind: 'view' | 'install', platform?: NodeJS.Platform): UpdateProcessInvocation;
export declare function runUpdateCommand(currentVersion: string, dependencies?: UpdateDependencies): Promise<UpdateResult>;
export declare function registerUpdateCommand(program: Command, currentVersion: string, dependencies?: UpdateDependencies): void;
export {};
