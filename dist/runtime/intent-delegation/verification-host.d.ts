import { type IntentVerificationExecution } from './verification-execution-journal.js';
import { type ValidationMaterialReview, type ValidationMaterialDraft } from '../verification/product-material-authorization.js';
import type { SessionStore } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionAuthority } from '../../ai/runtime/session-store/execution-authority.js';
/** Fixed product host. Native enrollment is real; durable rows never grant business completion. */
export declare function createIntentVerificationHost(options: {
    store: SessionStore;
    authority: SessionExecutionAuthority;
    sessionId: string;
    instanceId: string;
    workspaceRoot: string;
    assertAdmission(): void;
    reviewMaterials?: (review: Readonly<ValidationMaterialReview>) => Promise<void>;
    now?: () => number;
}): Readonly<{
    get: (id: string) => IntentVerificationExecution;
    list(candidateId: string): readonly IntentVerificationExecution[];
    reserve(raw: {
        candidateId: string;
        obligationId: string;
        exactCommand: ValidationMaterialDraft["exactCommand"];
        materials: ValidationMaterialDraft["materials"];
        expiresAt: number;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentVerificationExecution>;
    execute(raw: {
        id: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentVerificationExecution>;
    advance(raw: {
        id: string;
        requestSource: "user";
        signal?: AbortSignal;
    }): Promise<IntentVerificationExecution>;
    recover(raw: {
        id: string;
        requestSource: "user" | "scheduler";
        signal?: AbortSignal;
    }): Promise<IntentVerificationExecution>;
    close(): Promise<void>;
    waitForClosedResources(): Promise<void>;
}>;
