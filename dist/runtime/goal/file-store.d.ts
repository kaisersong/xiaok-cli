import { type AtomicWriteFile } from '../../utils/atomic-file.js';
import { type GoalCommitInput, type GoalDocument, type GoalStore } from './types.js';
import { type GoalCompletionIntent, type GoalCompletionIntentUpdate } from './completion-intent.js';
import { type GoalPublicationAttempt, type GoalPublicationAttemptUpdate } from './publication-attempt.js';
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
    loadCompletionIntent(sessionId: string, intentId: string): Promise<GoalCompletionIntent | null>;
    listCompletionAttempts(sessionId: string, intentId: string): Promise<GoalPublicationAttempt[]>;
    updateCompletionAttempt(sessionId: string, update: GoalPublicationAttemptUpdate): Promise<void>;
    finalizeCompletionAttempt(sessionId: string, attemptId: string): Promise<GoalCompletionIntent>;
    private editCompletionJournal;
    updateCompletionIntent(sessionId: string, update: GoalCompletionIntentUpdate): Promise<void>;
    private withQueue;
    private commitLocked;
    private readRaw;
    private remember;
    private filePath;
}
/** Untrusted declarations from one captured container. Registration and
 * cross-source relationships remain the full collector's responsibility. */
export declare function readCapturedGoalSessions(raw: string, sessionId: string): Readonly<{
    kind: "captured-source-declarations";
    containerSessionId: string;
    goalAssociations: {
        goalId: string;
        logicalContainerId: string;
        completionTasks: Array<{
            intentId: string;
            taskId: string;
            epoch: number;
            originalPath: string;
        }>;
        evidenceOwners: Array<GoalDocument["evidence"][number]["record"] & {
            epoch: number;
            goalTurnId: string;
            evidenceId: string;
            originalPath: string;
            recordedAt: number;
        }>;
    }[];
    publication: {
        intents: GoalCompletionIntent[];
        attempts: GoalPublicationAttempt[];
    };
    declaredGoalIds: readonly string[];
    declaredTaskIds: readonly string[];
    referencedOwners: readonly {
        ownerKind: GoalDocument["evidence"][number]["record"]["ownerKind"];
        ownerId: string;
    }[];
    forkedFromGoalId: string | null;
}>;
