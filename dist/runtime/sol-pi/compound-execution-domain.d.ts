import { type ObservationSessionOwner } from './observation-session-owner.js';
import { type SessionExecutionLease, type SessionExecutionAuthority } from '../../ai/runtime/session-store/execution-authority.js';
import { type CompoundSourceInventory } from './compound-source-inventory.js';
export { COMPOUND_DOMAIN_RESERVED_BYTES } from './compound-domain-budget.js';
export interface CompoundExecutionDomainBinding {
    readonly version: 1;
    readonly sourceRoots: readonly string[];
    readonly sourceInventoryDigest: string;
    readonly authorityId: string;
    readonly profileRoot: string;
    readonly canonicalSessionId: string;
    readonly storeRoot: string;
    readonly workspaceRoot: string;
    readonly storeIdentity: string;
    readonly executionLockIdentity: string;
    readonly generation: number;
    readonly state: 'active' | 'retiring' | 'retired';
    readonly initializationId: string;
}
export declare function getCompoundExecutionDomainBinding(domain: ReturnType<typeof openCompoundExecutionDomain>): Readonly<CompoundExecutionDomainBinding>;
/** Metadata registration only. Actual factories must also validate live policy,
 * branch admission and final tool permission. This is not an OS isolation issuer.
 * The actual ObservationService already holds its exclusive profile owner lock. */
export declare function openCompoundExecutionDomain(input: {
    owner: ObservationSessionOwner;
    storeRoot: string;
    lease: SessionExecutionLease;
    inventory?: CompoundSourceInventory;
}): Readonly<{
    getBinding(): Readonly<CompoundExecutionDomainBinding>;
    assertCurrent: () => void;
    retiredSessionIdentities(lease: SessionExecutionLease): readonly string[];
    beginRetirement(lease: SessionExecutionLease): void;
    /** Called only by the host fresh-task/explicit retirement path. The real
     * owner transport is cancelled and drained outside the shared effects lock;
     * durable terminal tree facts are checked under that lock before retirement. */
    retire({ authority }: {
        authority: SessionExecutionAuthority;
    }): Promise<Readonly<CompoundExecutionDomainBinding>>;
    /** Confirms metadata only. Caller still owes independent native/provider drain. */
    close(lease: SessionExecutionLease): void;
    assertForEffect(lease: SessionExecutionLease): void;
}>;
