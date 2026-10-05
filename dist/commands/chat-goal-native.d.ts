import { FileGoalNativeJournal, type GoalNativeMutation } from '../runtime/goal/native-mutation-journal.js';
import type { GoalInput, GoalOwnershipPort, GoalState, GoalStore } from '../runtime/goal/types.js';
/** Read the explicitly selected original contract once, before any native work. */
export declare function readGoalVerificationFile(path: string): Readonly<import("../runtime/goal/verification-definition.js").GoalVerificationDefinition>;
interface Options {
    store: GoalStore;
    journal: FileGoalNativeJournal;
    ownership: GoalOwnershipPort;
    sessionId: string;
    instanceId: string;
}
interface Result {
    mutation: GoalNativeMutation;
    goal: GoalState | null;
}
/** Owns in-flight native work, never terminal input, activation, or SDK calls.
 * The CLI retains the session lease/heartbeat until each operation settles. */
export declare class CliGoalNativeHost {
    private readonly options;
    private generation;
    private closed;
    private readonly work;
    private readonly signals;
    private closeDrain?;
    private readonly writerFailures;
    private readonly cancellationReasons;
    constructor(options: Options);
    latest(): GoalNativeMutation | null;
    get busy(): boolean;
    assertNoPending(): void;
    invalidate(): void;
    close(): Promise<void>;
    waitForClosedResources(): Promise<void>;
    private run;
    private context;
    private advance;
    create(kind: 'create' | 'replace', rawInput: GoalInput, rawDefinition: unknown): Promise<Result>;
    reserveFork(sourceSessionId: string): Promise<Result>;
    continue(): Promise<Result>;
    recover(): Promise<Result>;
    private resume;
    cancel(): Promise<Result>;
}
export {};
