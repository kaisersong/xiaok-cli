import type { CapacityWriteContext, PreparedCapacityCommandFacts } from '../verification/capacity-command.js';
export declare function inspectArtifactPrepareCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts> | undefined;
export declare function executeArtifactPrepareCommand(command: object, context: CapacityWriteContext): boolean;
/** Parses untrusted Docker archive bytes. The qualified engine adapter must also
 * reject symlink ancestors with its actual HEAD/no-follow protocol; TAR alone
 * cannot attest which container path produced these bytes. No archive is extracted to disk.
 */
export declare function extractSingleArtifact(input: Buffer, relativePath: string): Buffer;
import type { Database } from 'better-sqlite3';
import { type createVerificationBlobBudget, type BlobReservationProposal } from '../verification/blob-budget.js';
import type { QuiescenceAuthority, PhysicalQuiescenceReceipt, QuiescenceExpectation } from './physical-quiescence.js';
type Source = 'user' | 'agent' | 'scheduler';
interface ExportFact {
    ownerKey: string;
    expected: QuiescenceExpectation;
    paths: readonly string[];
}
interface ArtifactFact {
    path: string;
    sha256: string;
    size: number;
    index: number;
}
interface Batch {
    resourceId: string;
    facts: ExportFact;
    artifacts: readonly ArtifactFact[];
    reservation: BlobReservationProposal;
}
/** Private protected-service exporter. Opaque output binding and source authority
 * are verified by the actual runner/access owner, not by a container-id DTO.
 * Prepared failures retain their reservation until explicit authenticated cleanup.
 */
export declare function createArtifactExporter(options: {
    root: string;
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    assertCurrent(): void;
    quiescence: Pick<QuiescenceAuthority, 'assertQuiescent'>;
    readArchive(output: object, relativePath: string, options: {
        expected: QuiescenceExpectation;
        signal?: AbortSignal;
    }): Promise<Buffer>;
    access: {
        assertExport(facts: ExportFact, output: object, requestSource: Source): void;
        assertRead(facts: Batch, authorization: object): void;
        assertDelete(facts: Batch, authorization: object, requestSource: Source): void;
    };
}): Readonly<{
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, resource: Readonly<BlobReservationProposal>): void;
    }>;
    exportArtifacts(input: {
        requestSource: Source;
        ownerKey: string;
        output: object;
        expected: QuiescenceExpectation;
        receipt: PhysicalQuiescenceReceipt;
        paths: readonly string[];
        signal?: AbortSignal;
    }): Promise<Readonly<{
        resourceId: string;
        artifacts: readonly Omit<ArtifactFact, "index">[];
    }>>;
    openArtifact(resourceId: string, path: string, authorization: object): object;
    readArtifact(token: object): Buffer;
    deleteBatch(resourceId: string, context: {
        requestSource: Source;
        authorization: object;
    }): void;
    close(): void;
}>;
export {};
