export declare class FileCompleter {
    private cwd;
    private cache;
    constructor(cwd: string);
    private scan;
    getCompletions(partial: string): Promise<Array<{
        cmd: string;
        desc: string;
    }>>;
    invalidate(): void;
}
export declare function resolveFileReferences(text: string, cwd: string): Promise<string>;
