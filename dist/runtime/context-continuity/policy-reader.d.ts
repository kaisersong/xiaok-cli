/** Reads committed main policy only. Never migrates, creates, repairs, or caches allow. */
export declare class ContinuityPolicyReader {
    private readonly options;
    constructor(options: {
        dataRoot: string;
        profileId: string;
        scope(id: string): 'readable' | 'blocked' | 'deleted';
    });
    assertTaskReadable(taskId: string): void;
    assertTasksReadable(taskIds: readonly string[]): void;
}
