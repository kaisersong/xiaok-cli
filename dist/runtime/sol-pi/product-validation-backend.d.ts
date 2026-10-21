import type { CompoundValidationBackend } from './compound-validation.js';
import type { IsolatedExecutionPort, HostIssuedMountPlan } from '../isolated-execution/execution-port.js';
import { type ValidationMaterialDraft, type ValidationMaterialAuthorizationClient, type AuthorizedProductValidationMaterials, type PreparedValidationMaterials } from '../verification/product-material-authorization.js';
export interface InstalledProductVerificationClient {
    materialAuthorization: ValidationMaterialAuthorizationClient;
    execution: IsolatedExecutionPort;
    wrapPreparedValidationInput(prepared: PreparedValidationMaterials): HostIssuedMountPlan;
}
/** Wiring only: obtain client from the fixed installed controller factory and
 * probe actual qualification before enabling the registry. No qualification is minted here. */
export declare function createProductValidationBackend(options: {
    workspaceRoot: string;
    expiresAt: number;
    client: InstalledProductVerificationClient;
    assertCurrent(): void;
    authorize(input: {
        workspaceRoot: string;
        operation: Omit<ValidationMaterialDraft, 'materials'>;
        client: ValidationMaterialAuthorizationClient;
        signal?: AbortSignal;
        assertCurrent(): void;
    }): Promise<AuthorizedProductValidationMaterials | null>;
}): CompoundValidationBackend;
