import { type GuardDecision } from './policy.js';
export declare function evaluateProtectedOutputGuard(input: {
    operation: 'write' | 'overwrite' | 'delete';
    targetPath: string;
    protectedArtifacts: Array<{
        artifactId: string;
        path: string;
    }>;
    override?: {
        actor: string;
        reason: string;
    };
}): GuardDecision;
