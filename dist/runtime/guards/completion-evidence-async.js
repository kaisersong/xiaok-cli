import { access, open, stat, realpath, lstat } from 'node:fs/promises';
import { validateArtifactBytes } from '../../quality/artifact-structure.js';
import { completionEvidenceFlow } from './completion-evidence.js';
export function throwEvidenceAbort(signal) {
    if (signal.aborted)
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
export function assertEvidenceActive(options) {
    throwEvidenceAbort(options.signal);
    options.assertActive?.();
    throwEvidenceAbort(options.signal);
}
export async function validateCompletionEvidenceAsync(input, options) {
    assertEvidenceActive(options);
    const flow = completionEvidenceFlow(input);
    let step = flow.next();
    while (!step.done) {
        assertEvidenceActive(options);
        let value;
        try {
            value = await executeEffect(step.value, options);
        }
        catch (error) {
            // Cancellation must not enter the ordinary missing-file/fail-open catches.
            assertEvidenceActive(options);
            step = flow.throw(error);
            continue;
        }
        assertEvidenceActive(options);
        step = flow.next(value);
    }
    assertEvidenceActive(options);
    return step.value;
}
async function executeEffect(effect, options) {
    switch (effect.kind) {
        case 'exists':
            try {
                await raw(access(effect.path), options);
                return true;
            }
            catch {
                assertEvidenceActive(options);
                return false;
            }
        case 'realpath': return raw(realpath(effect.path), options);
        case 'lstat': return raw(lstat(effect.path), options);
        case 'structure': return validateStructureAsync(effect.path, effect.structuralKind, options);
    }
}
function raw(promise, options) {
    options.trackPending(promise);
    return promise;
}
async function validateStructureAsync(path, kind, options) {
    try {
        assertEvidenceActive(options);
        // Await the original open even after abort: a late FileHandle must be closed.
        const handle = await raw(open(path, 'r'), options);
        try {
            assertEvidenceActive(options);
            let readLength = 5;
            if (kind === 'pptx') {
                const info = await raw(stat(path), options);
                assertEvidenceActive(options);
                readLength = Math.min(65536, info.size);
            }
            const buffer = Buffer.alloc(readLength);
            const { bytesRead } = await raw(handle.read(buffer, 0, readLength, 0), options);
            assertEvidenceActive(options);
            return validateArtifactBytes(kind, buffer, bytesRead);
        }
        finally {
            // No abort wrapper, no early release: close is itself a tracked raw effect.
            await raw(handle.close(), options);
        }
    }
    catch {
        assertEvidenceActive(options);
        return { ok: true }; // Preserve the synchronous structural check's fail-open.
    }
}
