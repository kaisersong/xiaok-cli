import type { Database } from 'better-sqlite3';
export declare function assertInstalledMacEngineHandle(value: object): void;
export declare function assertInstalledEngineDatabase(value: object, database: Database): void;
export declare function inspectInstalledMacEngineHandle(value: object): Promise<void>;
/** Installed service only: fixed package/DB/VM. No injected executor or qualification flag.
 * Result is inspected installation facts; the qualified runner must still perform
 * actual escape/resource probes and bind its own engine lifetime. */
export declare function initializeInstalledMacEngine(input: {
    database: Database;
    signal?: AbortSignal;
    recovery?: 'explicit';
}): Promise<Readonly<{
    observation: Readonly<import("./engine-bootstrap-journal.js").EngineBootstrapObservation>;
    hostSocket: string;
    imageDigest: string;
    assertCurrent: () => void;
    inspect: () => Promise<{
        engineId: string;
        machineId: string;
        bootId: string;
        effectiveConfigHash: string;
        creationNonce: string;
        processUid: number;
        processStartIdentity: string;
    }>;
    qualified: false;
}>>;
