import { createHash } from 'node:crypto';
import { computeSessionHistoryDigest, toDurableSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import { mergeProtectedObservationClosures } from '../../ai/runtime/protected-observation-closure.js';
export function desktopObservationSessionId(taskId) {
    if (!taskId || typeof taskId !== 'string')
        throw new Error('SOL_PI_DESKTOP_TASK_ID_INVALID');
    return `desktop-observation-${createHash('sha256').update(taskId).digest('hex')}`;
}
export function assertInitializedSnapshot(snapshot) {
    if (snapshot.executionProtected !== true || !Number.isSafeInteger(snapshot.storeRevision) || snapshot.storeRevision < 1
        || snapshot.historyDigest !== computeSessionHistoryDigest(snapshot))
        throw Error('SOL_PI_DESKTOP_INITIALIZATION_REQUIRED');
    toDurableSessionSnapshot(snapshot);
}
export async function readDesktopTaskProtection(taskId, ports) {
    try {
        const snapshot = ports.loadAlias(taskId)?.snapshot ?? await ports.loadSession(desktopObservationSessionId(taskId));
        if (snapshot && (!snapshot.protectedObservationClosure || snapshot.executionProtected !== undefined))
            assertInitializedSnapshot(snapshot);
        return { closure: mergeProtectedObservationClosures(undefined, snapshot?.protectedObservationClosure),
            ...(snapshot?.executionProtected ? { executionProtected: true } : {}) };
    }
    catch (cause) {
        throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE', { cause }), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' });
    }
}
