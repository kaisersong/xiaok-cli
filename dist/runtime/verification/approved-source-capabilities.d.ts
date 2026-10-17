import type { Database } from 'better-sqlite3';
import { type createVerificationCompletionComposition } from './completion-composition.js';
import type { VerificationOwner } from './proof-authority.js';
import type { DiagnosticCoverageSource } from './independent-recipes.js';
import { type MaterialDeadline } from './material-deadline.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ValidationMaterialInvocation } from './product-material-authorization.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
export declare function assertApprovedSourceCapabilitiesDatabase(caps: object, database: Database): void;
type Host = ReturnType<typeof createVerificationCompletionComposition>['privateHost'];
type SourceFacts = {
    ownerKey: string;
    sourceRunId: string;
    runNonce: string;
    archiveHash: string;
    scope: string;
};
/** Private source read capabilities. Native committed exact entries authorize old
 * archives; candidate material grants do not. Never expose the issuer on RPC. */
export declare function createApprovedSourceCapabilities(input: {
    database: Database;
    completion: Host;
    clock(): ReceiverClockEvidence;
    wallNow?(): number;
}): Readonly<{
    issueStart(raw: {
        owner: VerificationOwner;
        obligationId: string;
        peer: ControllerPeer;
        invocation: ValidationMaterialInvocation;
        deadline: Readonly<MaterialDeadline>;
    }): Readonly<{}>;
    assertStart(proposal: {
        ownerKey: string;
        rootInvocation: object;
    }, authorization: object): void;
    issueRead(raw: {
        owner: VerificationOwner;
        obligationId: string;
        source: DiagnosticCoverageSource;
        deadline: Readonly<MaterialDeadline>;
    }): Readonly<{}>;
    assertRead(facts: Readonly<SourceFacts>, authorization: object): void;
    close(): void;
}>;
export {};
