import { type ValidationMaterialDraft, type ValidationMaterialAuthorizationClient, type AuthorizedProductValidationMaterials } from '../runtime/verification/product-material-authorization.js';
/** CLI host callback for an actual pending validation. Paths come exclusively
 * from repeated user --validation-material arguments, never model tool input. */
export declare function authorizeCliValidationMaterials(input: {
    requestSource: 'user' | 'agent' | 'scheduler';
    selectedPaths: readonly string[];
    cwd: string;
    operation: Omit<ValidationMaterialDraft, 'materials'>;
    client: ValidationMaterialAuthorizationClient;
    writeReview(text: string): void;
    assertCurrent(): void;
    signal?: AbortSignal;
}): Promise<AuthorizedProductValidationMaterials>;
