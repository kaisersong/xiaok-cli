import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';
import { type ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';
export declare function desktopObservationSessionId(taskId: string): string;
export declare function assertInitializedSnapshot(snapshot: StoredSessionSnapshot): void;
/** Main-created readonly ports carry durable facts, never a writer or authority. */
export interface DesktopTaskProtectionReadPorts {
    loadAlias(taskId: string): {
        snapshot: StoredSessionSnapshot;
    } | null;
    loadSession(sessionId: string): Promise<StoredSessionSnapshot | null>;
}
export declare function readDesktopTaskProtection(taskId: string, ports: DesktopTaskProtectionReadPorts): Promise<{
    closure?: ProtectedObservationClosure;
    executionProtected?: true;
}>;
