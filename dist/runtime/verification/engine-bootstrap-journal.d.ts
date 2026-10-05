import type { Database } from 'better-sqlite3';
export interface EngineBootstrapProposal {
    deploymentHash: string;
    configHash: string;
    creationNonce: string;
    vmName: 'xiaok-engine';
}
export interface EngineBootstrapObservation {
    machineId: string;
    bootId: string;
    engineId: string;
    effectiveConfigHash: string;
    creationNonce: string;
    processUid: number;
    processStartIdentity: string;
}
export type EngineVmObservation = Omit<EngineBootstrapObservation, 'engineId'>;
export type EngineBootstrapPhase = 'copy-engine' | 'install-engine' | 'load-worker';
/** Private durable intent only. Neither rows nor observations are qualification
 * capabilities. Installed code must collect kernel/VM/engine evidence separately. */
export declare function createEngineBootstrapJournal(db: Database): Readonly<{
    read(): {
        state: string;
        proposal: EngineBootstrapProposal;
        observation?: EngineBootstrapObservation;
        vm?: EngineVmObservation;
        phases?: Partial<Record<EngineBootstrapPhase, {
            digest: string;
            state: "started" | "complete";
        }>>;
    } | undefined;
    prepare(raw: EngineBootstrapProposal): void;
    beginCreate(raw: EngineBootstrapProposal): void;
    recordVm(raw: EngineBootstrapProposal, input: EngineVmObservation): void;
    phase(raw: EngineBootstrapProposal, name: EngineBootstrapPhase, digest: string, complete?: boolean): void;
    recordObservation(raw: EngineBootstrapProposal, input: EngineBootstrapObservation): void;
}>;
/** Read-only maintenance view. Unlike creating the journal, this never changes
 * the original lifetime state or creates a missing table. Not an engine grant. */
export declare function readExistingEngineBootstrap(db: Database): Readonly<{
    proposal: EngineBootstrapProposal;
    observation: EngineBootstrapObservation;
    vm: {
        machineId: string;
        bootId: string;
        effectiveConfigHash: string;
        creationNonce: string;
        processUid: number;
        processStartIdentity: string;
    };
    phases: Partial<Record<EngineBootstrapPhase, {
        digest: string;
        state: "started" | "complete";
    }>>;
    state: "observed" | "unknown";
}>;
