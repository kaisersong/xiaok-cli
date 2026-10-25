export interface FrozenDeepSeekCounter {
    readonly opaqueFrozenDeepSeekCounter: never;
}
export interface DeepSeekRecipeEnvironment {
    pythonExecutable: string;
    sitePackages: string;
    tokenizerPath: string;
    wheelPath: string;
}
interface Entry {
    path: string;
    sha256: string;
}
export interface DeepSeekRecipeManifest {
    sha256: string;
    recipeVersion: '0.1.1';
    recipeSourceReference: string;
    platform: string;
    osVersion: string;
    pythonExecutable: string;
    stdlib: string;
    sitePackages: string;
    tokenizerPath: string;
    wheelPath: string;
    files: Entry[];
    directories: Array<{
        path: string;
        names: string[];
    }>;
    systemLibraries: string[];
    helperSha256: string;
    links: Array<{
        path: string;
        target: string;
    }>;
    absentPaths: string[];
}
/** HOST inspection only: produce a deployment snapshot for explicit host freeze.
 * No automatic install, network access, config acceptance or qualification. */
export declare function inspectDeepSeekRecipeEnvironment(input: DeepSeekRecipeEnvironment): DeepSeekRecipeManifest;
export declare function freezeDeepSeekRecipeCounter(input: DeepSeekRecipeEnvironment & {
    environmentManifest: DeepSeekRecipeManifest;
}): FrozenDeepSeekCounter;
export declare function isFrozenDeepSeekCounter(value: unknown): value is FrozenDeepSeekCounter;
export declare function countDeepSeekSerializedRequest(counter: FrozenDeepSeekCounter, body: string): number;
export {};
