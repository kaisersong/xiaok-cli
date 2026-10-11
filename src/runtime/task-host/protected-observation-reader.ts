import {createHash} from 'node:crypto';
import {computeSessionHistoryDigest,toDurableSessionSnapshot,type PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import {mergeProtectedObservationClosures,type ProtectedObservationClosure} from '../../ai/runtime/protected-observation-closure.js';

export function desktopObservationSessionId(taskId: string): string {
  if (!taskId || typeof taskId !== 'string') throw new Error('SOL_PI_DESKTOP_TASK_ID_INVALID');
  return `desktop-observation-${createHash('sha256').update(taskId).digest('hex')}`;
}
export function assertInitializedSnapshot(snapshot: PersistedSessionSnapshot): void {
  if (snapshot.executionProtected !== true || !Number.isSafeInteger(snapshot.storeRevision) || snapshot.storeRevision! < 1
    || snapshot.historyDigest !== computeSessionHistoryDigest(snapshot)) throw Error('SOL_PI_DESKTOP_INITIALIZATION_REQUIRED');
  toDurableSessionSnapshot(snapshot);
}
/** Main-created readonly ports carry durable facts, never a writer or authority. */
export interface DesktopTaskProtectionReadPorts {
  loadAlias(taskId:string): {snapshot:PersistedSessionSnapshot}|null;
  loadSession(sessionId:string):Promise<PersistedSessionSnapshot|null>;
}
export async function readDesktopTaskProtection(taskId:string,ports:DesktopTaskProtectionReadPorts):Promise<{closure?:ProtectedObservationClosure;executionProtected?:true}> {
    try {
      const snapshot = ports.loadAlias(taskId)?.snapshot ?? await ports.loadSession(desktopObservationSessionId(taskId));
      if (snapshot && (!snapshot.protectedObservationClosure || snapshot.executionProtected !== undefined)) assertInitializedSnapshot(snapshot);
      return { closure: mergeProtectedObservationClosures(undefined, snapshot?.protectedObservationClosure),
        ...(snapshot?.executionProtected ? { executionProtected: true as const } : {}) };
    } catch (cause) { throw Object.assign(new Error('SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE', { cause }), { code: 'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE' }); }
}
