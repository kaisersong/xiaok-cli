import { resolve } from 'node:path';
import { guardEvent } from './policy.js';
export function evaluateProtectedOutputGuard(input) {
    const protectedArtifact = input.protectedArtifacts.find((artifact) => samePath(artifact.path, input.targetPath));
    if (!protectedArtifact || input.operation === 'write') {
        return { ok: true, mode: 'pass', events: [guardEvent({ guardId: 'protected-output', mode: 'passed', target: input.targetPath, category: 'protected_output' })] };
    }
    if (input.override?.actor && input.override.reason.trim()) {
        return {
            ok: true,
            mode: 'pass',
            events: [guardEvent({
                    guardId: 'protected-output',
                    mode: 'override',
                    target: input.targetPath,
                    artifactId: protectedArtifact.artifactId,
                    category: 'protected_output',
                    override: input.override,
                })],
        };
    }
    const reason = `Attempted to ${input.operation} protected delivered artifact ${protectedArtifact.artifactId}.`;
    return {
        ok: false,
        mode: 'block',
        reason,
        action: 'Ask the user to confirm the overwrite/delete and record the reason.',
        allowOverride: true,
        events: [guardEvent({
                guardId: 'protected-output',
                mode: 'blocked',
                target: input.targetPath,
                artifactId: protectedArtifact.artifactId,
                category: 'protected_output',
                reason,
            })],
    };
}
function samePath(a, b) {
    return resolve(a) === resolve(b);
}
