import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { QuiescenceAuthority } from '../isolated-execution/physical-quiescence.js';
import type { Database } from 'better-sqlite3';
import { type ArchiveOperationReview, type ArchiveResourceReview } from './archive-operation-review.js';
import { type createVerificationCompletionComposition } from './completion-composition.js';
import { type createExecutionTranscriptStore, type ExecutionTranscriptManifest } from './execution-transcripts.js';
import { type createProtectedRunLedger, type Facts, type RunDeletionFacts } from './protected-run-ledger.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
/** User-native archive access; deletion also requires actual physical and reference gates. */
export declare function createUserArchiveOperations(input: {
    database: Database;
    raw: ReturnType<typeof createDockerRunner>;
    quiescence: QuiescenceAuthority;
    authorityId: string;
    completion: ReturnType<typeof createVerificationCompletionComposition>;
    transcripts: ReturnType<typeof createExecutionTranscriptStore>;
    runs: ReturnType<typeof createProtectedRunLedger>;
    clock(): Readonly<ReceiverClockEvidence>;
    assertCurrent(): void;
    ensureQualified(signal: AbortSignal): Promise<void>;
    resolvePrincipal(peer: ControllerPeer): {
        uid: number;
        gid: number;
        auditSessionId: number;
        accountGeneration: string;
        source: 'macos-local-generateduid';
    };
    approve(review: Readonly<ArchiveOperationReview>, signal: AbortSignal): Promise<{
        uid: number;
        auditSessionId: number;
        reviewHash: string;
    }>;
}): Readonly<{
    assertTranscriptDelete(manifest: Readonly<ExecutionTranscriptManifest>, cap: object): void;
    assertRunDelete(facts: Readonly<RunDeletionFacts>, cap: object): void;
    assertTranscriptRead(manifest: Readonly<ExecutionTranscriptManifest>, cap: object): void;
    assertRunRead(facts: Readonly<Facts>, cap: object): void;
    isReadCapability(cap: object): boolean;
    list(raw: unknown, rawPeer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        items: readonly Readonly<{
            id: string;
            kind: any;
            state: string;
        }>[];
        nextCursor: string | null;
    }>>;
    prepare(raw: unknown, rawPeer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        challengeId: string;
        validUntil: number;
        resourceKind: "transcript" | "protected-run";
    }>>;
    authorize(raw: unknown, rawPeer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        handle: string;
        resource: ArchiveResourceReview;
        validUntil: number;
    }>>;
    deleteArchive(rawInput: unknown, rawPeer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        deleted: true;
    }>>;
    read(raw: unknown, rawPeer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        complete?: boolean | undefined;
        truncated?: boolean | undefined;
        stream: string;
        offset: any;
        totalBytes: number;
        contentHash: string;
        bytes: string;
        eof: boolean;
        scope: "protected-execution-run" | "isolated-execution";
    }>>;
    closeHandle(raw: unknown, peer: ControllerPeer): void;
    close(): Promise<void>;
}>;
