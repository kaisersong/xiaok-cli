import { type AtomicWriteFile } from '../../utils/atomic-file.js';
import type { GoalCommitInput, GoalDocument, GoalStore } from './types.js';
export declare class GoalTamperDetectedError extends Error {
    constructor(sessionId: string);
}
export declare class FileGoalStore implements GoalStore {
    private readonly rootDir;
    private readonly atomicWrite;
    private readonly digests;
    private queue;
    constructor(rootDir: string, atomicWrite?: AtomicWriteFile);
    load(sessionId: string): Promise<GoalDocument | null>;
    commit(input: GoalCommitInput): Promise<void>;
    private commitLocked;
    private readRaw;
    private filePath;
}
