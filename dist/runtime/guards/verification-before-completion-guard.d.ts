import type { TraceBundleV1 } from '../trace/schema.js';
import { type ExecutionScope, type GuardDecision } from './policy.js';
export declare function evaluateVerificationBeforeCompletionGuard(input: {
    scope: ExecutionScope;
    bundle: TraceBundleV1;
}): GuardDecision;
