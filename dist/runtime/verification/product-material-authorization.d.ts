import { type MaterialPrepareResult } from './material-request.js';
export interface ValidationMaterialInvocation {
    sessionIdentity: string;
    compoundOperationId: string;
    validationInvocationId: string;
}
export interface ValidationMaterialDraft {
    purpose: 'isolated-validation' | 'isolated-command';
    invocation: ValidationMaterialInvocation;
    materials: Array<{
        path: string;
        byteLimit: number;
    }>;
    exactCommand: {
        argv: string[];
        cwdRelative: string;
    };
    editedFile?: {
        path: string;
        afterHash: string;
    };
    expiresAt: number;
}
export interface ValidationMaterialReview extends Omit<ValidationMaterialDraft, 'materials'> {
    materials: Array<{
        path: string;
        byteLimit: number;
        sha256: string;
        size: number;
    }>;
    engineBinding: {
        engineId: string;
        incarnation: string;
    };
    scopeDigest: string;
}
export interface PrivateMaterialHandle {
    id: string;
    secret: string;
}
export interface PreparedValidationMaterials {
    mountPlanHandle: PrivateMaterialHandle;
    command: ValidationMaterialDraft['exactCommand'];
    scopeDigest: string;
    invocation: ValidationMaterialInvocation;
}
/** Installed controller owns OS caller authentication, metadata access, native
 * authorization and material opens. An implementation returning DTOs is not an
 * OS qualification; clients must come from the fixed installed-service factory. */
export interface ValidationMaterialAuthorizationClient {
    prepareMaterialAuthorizationRequest?(input: {
        requestId: string;
        draft: Readonly<ValidationMaterialDraft>;
    }, options: {
        signal: AbortSignal;
    }): Promise<MaterialPrepareResult>;
    prepareMaterialAuthorization(draft: Readonly<ValidationMaterialDraft>, options: {
        signal: AbortSignal;
    }): Promise<{
        challengeId: string;
        canonicalReview: ValidationMaterialReview;
    }>;
    authorizeMaterialChallenge(challengeId: string, options: {
        signal: AbortSignal;
    }): Promise<PrivateMaterialHandle>;
    prepareValidationInput(input: {
        grantHandle: PrivateMaterialHandle;
        invocation: ValidationMaterialInvocation;
    }, options: {
        signal: AbortSignal;
    }): Promise<PreparedValidationMaterials>;
}
export interface ValidationMaterialRequestStep {
    readonly requestId: string;
    readonly phase: 'prepare' | 'authorize' | 'stage';
    readonly draft: Readonly<ValidationMaterialDraft>;
    readonly challengeId?: string;
}
export interface ValidationMaterialRequestJournal {
    requestId: string;
    beforeStep(step: Readonly<ValidationMaterialRequestStep>): Promise<void>;
}
export interface AuthorizedProductValidationMaterials {
    readonly publicReceipt: Readonly<{
        authorizationId: string;
        scopeDigest: string;
        invocation: ValidationMaterialInvocation;
    }>;
}
type AuthorizationBinding = Pick<ValidationMaterialDraft, 'purpose' | 'invocation' | 'exactCommand' | 'editedFile'>;
export declare function parseValidationMaterialDraft(value: unknown, now: number): ValidationMaterialDraft;
/** Product main/CLI only. Review displays facts; only the installed service's OS
 * authorization may issue a grant. No approved boolean exists in this protocol. */
export declare function authorizeProductValidationMaterials(input: {
    requestSource: 'user' | 'agent' | 'scheduler';
    draft: unknown;
    client: ValidationMaterialAuthorizationClient;
    request?: ValidationMaterialRequestJournal;
    review(value: Readonly<ValidationMaterialReview>): Promise<void>;
    assertCurrent(): void;
    signal?: AbortSignal;
}): Promise<AuthorizedProductValidationMaterials>;
/** Consumed once by the installed execution client; never serialize into model history or renderer IPC. */
export declare function consumeProductValidationMaterials(value: AuthorizedProductValidationMaterials, expectedAuthorization?: AuthorizationBinding): PreparedValidationMaterials;
export {};
