import type { Command } from 'commander';
import type { VerificationOwner } from '../runtime/verification/proof-authority.js';
interface DiagnosisRequest {
    requestSource: 'user' | 'agent' | 'scheduler';
    ownerKind: VerificationOwner['ownerKind'];
    ownerId: string;
    cursor: string | null;
    limit: number;
}
/** Fixed installed read-only diagnosis. No engine initialization, source read,
 * registration, migration retry or deletion is exposed by this command. */
export declare function diagnoseProtectedController(raw: DiagnosisRequest, signal: AbortSignal): Promise<any>;
export declare function registerProtectedControllerCommands(program: Command): void;
export {};
